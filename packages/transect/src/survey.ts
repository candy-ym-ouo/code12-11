import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  EntryBatch,
  Observation,
  ReviewIssue,
  ReviewReport,
  Route,
  Segment,
  SegmentStat,
  SpeciesTotal,
  SurveyState,
  Timeline,
  Waypoint,
} from "./types.js";
import { resolveWaypoints, routeLengthM } from "./geometry.js";
import {
  buildAtomicIntervals,
  intervalsOverlap,
  observationExtent,
  overlapWithOthers,
} from "./alignment.js";
import { reconcile, type ReconcileOptions } from "./timeline.js";
import { diffMinutes, parseTime } from "./time.js";

let counter = 0;
function nowIso(): string {
  // 便于同刻事件保持确定顺序：毫秒 + 进程内计数器
  const d = new Date();
  const base = d.toISOString();
  counter += 1;
  return base;
}

export interface CreateRouteInput {
  id?: string;
  name: string;
  description?: string;
  waypoints: Waypoint[];
  createdAt?: string;
}

export interface AddBatchInput {
  source: "field" | "retroactive";
  enteredAt?: string;
  recorder: string;
  note?: string;
}

export interface AddSegmentInput {
  id?: string;
  label: string;
  fromM: number;
  toM: number;
  startedAt?: string;
  endedAt?: string;
  retroactive?: boolean;
  note?: string;
}

export interface AddObservationInput {
  observedAt: string;
  speciesCode: string;
  speciesName: string;
  count: number;
  minCount?: number;
  maxCount?: number;
  atM?: number;
  fromM?: number;
  toM?: number;
  lng?: number;
  lat?: number;
  segmentId?: string;
  observer?: string;
  weather?: string;
  note?: string;
  /** 录入时刻，省略时取批次 enteredAt */
  enteredAt?: string;
  retroactive?: boolean;
}

const pad = (n: number) => String(n).padStart(4, "0");

export class SurveyError extends Error {}

/**
 * 样线调查账本：原始数据只追加，所有派生结果通过 reconcile 确定性重算。
 */
export class SurveyBook {
  readonly state: SurveyState;
  private reconcileOverrides?: Partial<ReconcileOptions>;

  constructor(input: CreateRouteInput | SurveyState, options?: Partial<ReconcileOptions>) {
    this.reconcileOverrides = options;
    if (this.isState(input)) {
      this.state = structuredClone(input);
    } else {
      this.validateWaypoints(input.waypoints);
      const route: Route = {
        id: input.id ?? "R0001",
        name: input.name,
        waypoints: input.waypoints,
        createdAt: input.createdAt ?? nowIso(),
      };
      if (input.description !== undefined) route.description = input.description;
      this.state = { version: 1, route, segments: [], observations: [], batches: [] };
    }
  }

  private isState(input: CreateRouteInput | SurveyState): input is SurveyState {
    return (input as SurveyState).version === 1 && "segments" in input && "batches" in input;
  }

  private validateWaypoints(waypoints: Waypoint[]): void {
    if (waypoints.length < 2) throw new SurveyError("路线至少需要 2 个控制点");
    let prev: number | undefined;
    for (const wp of waypoints) {
      if (!wp.id) throw new SurveyError("控制点必须有 id");
      const chainage = wp.chainage;
      if (chainage !== undefined) {
        if (chainage < 0) throw new SurveyError(`控制点 ${wp.id} 桩号不能为负`);
        if (prev !== undefined && chainage < prev - 1e-6) {
          throw new SurveyError(`控制点 ${wp.id} 桩号必须单调不减`);
        }
        prev = chainage;
      }
    }
    if (routeLengthM({ id: "x", name: "x", waypoints, createdAt: "" }) <= 0) {
      throw new SurveyError("路线长度为 0：请给出坐标或显式递增的 chainage");
    }
  }

  get route(): Route {
    return this.state.route;
  }

  get routeLength(): number {
    return routeLengthM(this.state.route);
  }

  get waypoints() {
    return resolveWaypoints(this.state.route);
  }

  addBatch(input: AddBatchInput): EntryBatch {
    const enteredAt = input.enteredAt ?? nowIso();
    if (input.source === "retroactive") parseTime(enteredAt);
    const batch: EntryBatch = {
      id: `B${pad(this.state.batches.length + 1)}`,
      routeId: this.state.route.id,
      source: input.source,
      enteredAt,
      recorder: input.recorder,
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    this.state.batches.push(batch);
    return batch;
  }

  private batchIdRef(batch: string | EntryBatch): string {
    return typeof batch === "string" ? batch : batch.id;
  }

  addSegment(batch: string | EntryBatch, input: AddSegmentInput): Segment {
    const batchId = this.batchIdRef(batch);
    const found = this.state.batches.find((b) => b.id === batchId);
    if (!found) throw new SurveyError(`批次不存在：${batchId}`);
    if (!(input.toM > input.fromM)) {
      throw new SurveyError(`分段「${input.label}」无效：需满足 toM > fromM`);
    }
    if (input.toM > this.routeLength + 1e-6) {
      // 结构问题记录到复核报告，但不阻止录入（可复核原则：先忠实记录再暴露问题）
    }
    if (
      input.startedAt !== undefined &&
      input.endedAt !== undefined &&
      parseTime(input.endedAt) < parseTime(input.startedAt)
    ) {
      throw new SurveyError(`分段「${input.label}」结束时间早于开始时间`);
    }
    const retroactive = input.retroactive ?? found.source === "retroactive";
    const segment: Segment = {
      id: input.id ?? `SEG${pad(this.state.segments.length + 1)}`,
      routeId: this.state.route.id,
      label: input.label,
      fromM: input.fromM,
      toM: input.toM,
      batchId,
      retroactive,
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    if (this.state.segments.some((s) => s.id === segment.id)) {
      throw new SurveyError(`分段 id 重复：${segment.id}`);
    }
    this.state.segments.push(segment);
    return segment;
  }

  addObservation(batch: string | EntryBatch, input: AddObservationInput): Observation {
    const batchId = this.batchIdRef(batch);
    const foundBatch = this.state.batches.find((b) => b.id === batchId);
    if (!foundBatch) throw new SurveyError(`批次不存在：${batchId}`);
    parseTime(input.observedAt);

    if (input.count < 0) throw new SurveyError("数量不能为负");
    if (
      input.minCount !== undefined &&
      input.maxCount !== undefined &&
      input.minCount > input.maxCount
    ) {
      throw new SurveyError("数量区间无效：minCount 不能大于 maxCount");
    }
    if (input.fromM !== undefined && input.toM !== undefined && input.toM < input.fromM) {
      throw new SurveyError("观察范围无效：toM 不能小于 fromM");
    }
    if (input.segmentId && !this.state.segments.some((s) => s.id === input.segmentId)) {
      throw new SurveyError(`分段不存在：${input.segmentId}`);
    }
    if (
      input.lat !== undefined &&
      (input.lat < -90 || input.lat > 90)
    ) {
      throw new SurveyError("纬度超出 [-90, 90]");
    }
    if (
      input.lng !== undefined &&
      (input.lng < -180 || input.lng > 180)
    ) {
      throw new SurveyError("经度超出 [-180, 180]");
    }

    const enteredAt = input.enteredAt ?? foundBatch.enteredAt;
    const autoRetro =
      diffMinutes(input.observedAt, enteredAt) >
      (this.reconcileOverrides?.retroactiveMinutes ?? 60);
    const retroactive = input.retroactive ?? (foundBatch.source === "retroactive" || autoRetro);

    const obs: Observation = {
      id: `O${pad(this.state.observations.length + 1)}`,
      routeId: this.state.route.id,
      batchId,
      observedAt: input.observedAt,
      enteredAt,
      retroactive,
      speciesCode: input.speciesCode.trim(),
      speciesName: input.speciesName.trim(),
      count: input.count,
      ...(input.minCount !== undefined ? { minCount: input.minCount } : {}),
      ...(input.maxCount !== undefined ? { maxCount: input.maxCount } : {}),
      ...(input.atM !== undefined ? { atM: input.atM } : {}),
      ...(input.fromM !== undefined ? { fromM: input.fromM } : {}),
      ...(input.toM !== undefined ? { toM: input.toM } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
      ...(input.observer !== undefined ? { observer: input.observer } : {}),
      ...(input.weather !== undefined ? { weather: input.weather } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    this.state.observations.push(obs);
    return obs;
  }

  /** 结构性复核问题（分段层面），与时间线问题合并成报告 */
  structuralIssues(): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    const length = this.routeLength;
    const seenIds = new Set<string>();

    for (const seg of this.state.segments) {
      if (seenIds.has(seg.id)) {
        issues.push({
          code: "DUPLICATED_ID",
          severity: "error",
          message: `分段 id 重复：${seg.id}`,
          segmentId: seg.id,
        });
      }
      seenIds.add(seg.id);

      if (seg.toM <= seg.fromM) {
        issues.push({
          code: "SEGMENT_REVERSED",
          severity: "error",
          message: `分段 ${seg.label}（${seg.id}）方向反转或长度为 0`,
          segmentId: seg.id,
          batchId: seg.batchId,
        });
      }
      if (seg.fromM < -1e-6 || seg.toM > length + 1e-6) {
        issues.push({
          code: "SEGMENT_OUTSIDE_ROUTE",
          severity: "error",
          message: `分段 ${seg.label}（${seg.fromM}~${seg.toM}m）超出路线范围（0~${length.toFixed(1)}m）`,
          segmentId: seg.id,
          batchId: seg.batchId,
        });
      }
      const overlap = overlapWithOthers(seg, this.state.segments);
      const segLen = seg.toM - seg.fromM;
      if (overlap > 1e-6) {
        issues.push({
          code: "SEGMENT_OVERLAP",
          severity: "warning",
          message: `分段 ${seg.label} 与其他分段重叠 ${overlap.toFixed(1)}m（占该段 ${(
            (overlap / segLen) *
            100
          ).toFixed(0)}%），已按原子分段对齐`,
          segmentId: seg.id,
          batchId: seg.batchId,
          relatedIds: this.state.segments
            .filter((s) => s.id !== seg.id && intervalsOverlap(seg.fromM, seg.toM, s.fromM, s.toM))
            .map((s) => s.id),
        });
      }
    }

    // 观测层面的结构问题
    const intervals = buildAtomicIntervals(this.state.segments);
    const obsIds = new Set<string>();
    for (const obs of this.state.observations) {
      if (obsIds.has(obs.id)) {
        issues.push({
          code: "DUPLICATED_ID",
          severity: "error",
          message: `观测 id 重复：${obs.id}`,
          observationId: obs.id,
        });
      }
      obsIds.add(obs.id);

      const extent = observationExtent(obs, this.state.route, this.state.segments, intervals);
      if (extent.locatedBy === "none") {
        issues.push({
          code: "MISSING_LOCATION",
          severity: "warning",
          message: `观测 ${obs.id}（${obs.speciesName}）缺少沿线位置（桩号/坐标/所属分段）`,
          observationId: obs.id,
          batchId: obs.batchId,
        });
      } else {
        if (extent.locatedBy === "coordinates" && extent.offsetM !== undefined && extent.offsetM > 100) {
          issues.push({
            code: "OBSERVATION_OUTSIDE_SEGMENT",
            severity: "warning",
            message: `观测 ${obs.id}（${obs.speciesName}）坐标偏离样线 ${extent.offsetM.toFixed(0)}m，请确认坐标或桩号`,
            observationId: obs.id,
            batchId: obs.batchId,
          });
        }
        if (extent.fromM < -1e-6 || extent.toM > length + 1e-6) {
          issues.push({
            code: "OBSERVATION_OUTSIDE_ROUTE",
            severity: "error",
            message: `观测 ${obs.id}（${obs.speciesName}）位置 ${extent.fromM.toFixed(1)}~${extent.toM.toFixed(1)}m 超出路线`,
            observationId: obs.id,
            batchId: obs.batchId,
          });
        }
        const segment = obs.segmentId
          ? this.state.segments.find((s) => s.id === obs.segmentId)
          : undefined;
        if (segment) {
          const inside =
            extent.fromM >= segment.fromM - 1e-6 && extent.toM <= segment.toM + 1e-6;
          if (!inside) {
            issues.push({
              code: "OBSERVATION_OUTSIDE_SEGMENT",
              severity: "warning",
              message: `观测 ${obs.id}（${obs.speciesName}）位置不在其所填分段 ${segment.label} 内`,
              observationId: obs.id,
              segmentId: segment.id,
              batchId: obs.batchId,
            });
          }
        } else if (extent.segmentIds.length === 0 && extent.locatedBy !== "coordinates") {
          issues.push({
            code: "OBSERVATION_OUTSIDE_SEGMENT",
            severity: "info",
            message: `观测 ${obs.id}（${obs.speciesName}）不落在任何已录入分段内`,
            observationId: obs.id,
            batchId: obs.batchId,
          });
        }
      }

      const seg = obs.segmentId
        ? this.state.segments.find((s) => s.id === obs.segmentId)
        : undefined;
      const windowSeg = seg ?? this.state.segments.find((s) =>
        extent.segmentIds.includes(s.id) && s.startedAt && s.endedAt
          ? parseTime(obs.observedAt) >= parseTime(s.startedAt!) &&
            parseTime(obs.observedAt) <= parseTime(s.endedAt!)
          : false,
      );
      const ref = seg ?? windowSeg;
      if (
        ref?.startedAt &&
        ref?.endedAt &&
        (parseTime(obs.observedAt) < parseTime(ref.startedAt) ||
          parseTime(obs.observedAt) > parseTime(ref.endedAt))
      ) {
        issues.push({
          code: "OBSERVATION_TIME_OUTSIDE_WINDOW",
          severity: "warning",
          message: `观测 ${obs.id}（${obs.speciesName}）观察时刻不在分段 ${ref.label} 调查时间窗内`,
          observationId: obs.id,
          segmentId: ref.id,
          batchId: obs.batchId,
        });
      }
    }

    return issues;
  }

  reconcile() {
    return reconcile(
      this.state.route,
      this.state.segments,
      this.state.observations,
      this.structuralIssues(),
      this.reconcileOverrides ?? {},
    );
  }

  timeline(): Timeline {
    return {
      routeId: this.state.route.id,
      generatedAt: new Date().toISOString(),
      sightings: this.reconcile().sightings,
    };
  }

  review(): ReviewReport {
    const { sightings, issues } = this.reconcile();
    return {
      routeId: this.state.route.id,
      generatedAt: new Date().toISOString(),
      totals: {
        segments: this.state.segments.length,
        atomicIntervals: buildAtomicIntervals(this.state.segments).length,
        observations: this.state.observations.length,
        sightings: sightings.length,
        batches: this.state.batches.length,
        retroactiveObservations: this.state.observations.filter((o) => o.retroactive).length,
      },
      issues,
      errorCount: issues.filter((i) => i.severity === "error").length,
      warningCount: issues.filter((i) => i.severity === "warning").length,
    };
  }

  /**
   * 分段统计。口径：一次目击归入其来源观测**各自填报的分段**——
   * 重叠区里同一次目击被两组在各自分段中都记到时，两个分段都计入（反映各自行走的调查结果），
   * 因此各分段合计之和可能大于全样线去重后的物种合计；冲突/待确认目击不计入数量。
   */
  segmentStats(): SegmentStat[] {
    const { sightings } = this.reconcile();
    return this.state.segments.map((seg) => {
      const species: Record<string, number> = {};
      let total = 0;
      for (const s of sightings) {
        if (s.status === "conflict" || s.status === "unresolved") continue;
        const declaredSegs = this.state.observations
          .filter((o) => s.observationIds.includes(o.id))
          .map((o) => o.segmentId)
          .filter((id): id is string => Boolean(id));
        const attributed = new Set(declaredSegs);
        // 没有观测显式填分段时，回退为空间归属（代表点所在分段）
        if (attributed.size === 0) {
          for (const segId of s.segmentIds) {
            const candidate = this.state.segments.find((x) => x.id === segId);
            if (
              candidate &&
              s.representativeM >= candidate.fromM - 1e-6 &&
              s.representativeM < candidate.toM - 1e-6
            ) {
              attributed.add(segId);
            }
          }
        }
        if (!attributed.has(seg.id)) continue;
        species[s.speciesName] = (species[s.speciesName] ?? 0) + s.resolvedCount;
        total += s.resolvedCount;
      }
      const overlap = overlapWithOthers(seg, this.state.segments);
      return {
        segmentId: seg.id,
        label: seg.label,
        fromM: seg.fromM,
        toM: seg.toM,
        lengthM: seg.toM - seg.fromM,
        retroactive: seg.retroactive,
        species,
        total,
        overlapRatio: overlap / (seg.toM - seg.fromM),
      };
    });
  }

  speciesTotals(): SpeciesTotal[] {
    const { sightings } = this.reconcile();
    const map = new Map<string, SpeciesTotal>();
    for (const s of sightings) {
      const entry =
        map.get(s.speciesCode) ??
        {
          speciesCode: s.speciesCode,
          speciesName: s.speciesName,
          count: 0,
          sightings: 0,
          unresolvedCount: 0,
        };
      entry.sightings += 1;
      if (s.status === "conflict" || s.status === "unresolved") {
        entry.unresolvedCount += 1;
      } else {
        entry.count += s.resolvedCount;
      }
      map.set(s.speciesCode, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.speciesName.localeCompare(b.speciesName));
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(tmp, path);
  }

  static load(path: string, options?: Partial<ReconcileOptions>): SurveyBook {
    if (!existsSync(path)) throw new SurveyError(`账本文件不存在：${path}`);
    const state = JSON.parse(readFileSync(path, "utf8")) as SurveyState;
    if (state.version !== 1) throw new SurveyError(`不支持的账本版本：${state.version}`);
    return new SurveyBook(state, options);
  }
}
