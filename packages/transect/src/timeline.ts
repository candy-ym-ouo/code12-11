import type {
  Observation,
  ReviewIssue,
  Route,
  Segment,
  Sighting,
} from "./types.js";
import {
  buildAtomicIntervals,
  intervalsOverlap,
  observationExtent,
  type ObservationExtent,
} from "./alignment.js";
import { diffMinutes, minTime, parseTime } from "./time.js";

export interface ReconcileOptions {
  /** 同一目击允许的最大时间间隔（分钟），默认 15 */
  timeWindowMinutes: number;
  /** 点状观测视为同一位置的距离阈值（米），默认 25 */
  pointProximityM: number;
  /** 一次目击包含多少条观测时给出大簇预警，默认 8 */
  largeClusterSize: number;
  /** 录入时刻晚于观察时刻多少分钟即标记为事后补录，默认 60 */
  retroactiveMinutes: number;
}

export const DEFAULT_RECONCILE_OPTIONS: ReconcileOptions = {
  timeWindowMinutes: 15,
  pointProximityM: 25,
  largeClusterSize: 8,
  retroactiveMinutes: 60,
};

export interface ReconciledResult {
  sightings: Sighting[];
  issues: ReviewIssue[];
  extents: Map<string, ObservationExtent>;
}

class UnionFind {
  private parent = new Map<string, string>();

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: string): string {
    const p = this.parent.get(x) ?? x;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  groups(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      const list = map.get(root) ?? [];
      list.push(x);
      map.set(root, list);
    }
    return map;
  }
}

function isPointExtent(e: ObservationExtent): boolean {
  return Math.abs(e.toM - e.fromM) < 1e-9;
}

function spatiallyClose(a: ObservationExtent, b: ObservationExtent, opts: ReconcileOptions): boolean {
  const aPoint = isPointExtent(a);
  const bPoint = isPointExtent(b);

  if (aPoint && bPoint) {
    // 两个点状观测：共享原子分段还不够（一段可能上千米），必须在距离阈值内
    return Math.abs(a.representativeM - b.representativeM) <= opts.pointProximityM;
  }

  // 至少一个是区间观测：共享原子分段（沿线范围相交）即视为空间相邻
  if (a.atomicIndexes.some((i) => b.atomicIndexes.includes(i))) return true;

  if (!Number.isNaN(a.fromM) && !Number.isNaN(b.fromM)) {
    return intervalsOverlap(a.fromM, a.toM, b.fromM, b.toM);
  }
  return false;
}

function enterOrder(obs: Observation): number {
  // 录入顺序以 enteredAt 为主，同刻按 id（id 自带批次内序号）兜底
  return parseTime(obs.enteredAt).getTime();
}

/**
 * 对齐重算：由原始观测确定性地生成目击时间线。
 *
 * 同物种、时空相邻（共享原子分段或距离阈值内，且观察时刻间隔 ≤ 时窗）的观测归并为一次目击：
 * - 数量一致、范围相容 → 自动合并（重复记录/重叠分段重复计数只算一次）；
 * - 数量冲突或区间相离 → 标记 conflict，导出时不计入已核定数量；
 * - 锚点 = 录入最早的观测，目击编号按锚点排序，事后再补录不会改变既有编号（稳定可复核）。
 */
export function reconcile(
  route: Route,
  segments: Segment[],
  observations: Observation[],
  partialIssues: ReviewIssue[],
  optionsOverrides?: Partial<ReconcileOptions>,
): ReconciledResult {
  const opts = { ...DEFAULT_RECONCILE_OPTIONS, ...optionsOverrides };
  const issues: ReviewIssue[] = [...partialIssues];
  const intervals = buildAtomicIntervals(segments);
  const extents = new Map<string, ObservationExtent>();
  for (const obs of observations) {
    extents.set(obs.id, observationExtent(obs, route, segments, intervals));
  }

  // 仅对可定位观测做空间归并；无法定位的观测各自成簇
  const located = observations.filter((o) => extents.get(o.id)!.locatedBy !== "none");

  const uf = new UnionFind();
  located.forEach((o) => uf.add(o.id));

  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const a = located[i]!;
      const b = located[j]!;
      if (a.routeId !== b.routeId || a.speciesCode !== b.speciesCode) continue;
      const ea = extents.get(a.id)!;
      const eb = extents.get(b.id)!;
      const minutes = Math.abs(diffMinutes(a.observedAt, b.observedAt));
      if (minutes <= opts.timeWindowMinutes && spatiallyClose(ea, eb, opts)) {
        uf.union(a.id, b.id);
      }
    }
  }

  // 锚点（录入最早）决定稳定排序与编号
  const groups = [...uf.groups().values()]
    .map((ids) =>
      ids
        .map((id) => observations.find((o) => o.id === id)!)
        .sort((x, y) => {
          const byEntry = enterOrder(x) - enterOrder(y);
          if (byEntry !== 0) return byEntry;
          return x.id.localeCompare(y.id);
        }),
    )
    .sort((ga, gb) => {
      const a = ga[0]!;
      const b = gb[0]!;
      const byEntry = enterOrder(a) - enterOrder(b);
      if (byEntry !== 0) return byEntry;
      return a.id.localeCompare(b.id);
    });

  const unlocated = observations.filter((o) => extents.get(o.id)!.locatedBy === "none");
  for (const o of unlocated) groups.push([o]);

  const sightings: Sighting[] = [];
  groups.forEach((group, displayIndex) => {
    const anchor = group[0]!;
    const id = `S${String(displayIndex + 1).padStart(4, "0")}`;
    const sortedByTime = [...group].sort(
      (a, b) =>
        parseTime(a.observedAt).getTime() - parseTime(b.observedAt).getTime() ||
        a.id.localeCompare(b.id),
    );

    const locatedExtents = group
      .map((o) => extents.get(o.id)!)
      .filter((e) => e.locatedBy !== "none");
    const fromM = locatedExtents.length ? Math.min(...locatedExtents.map((e) => e.fromM)) : NaN;
    const toM = locatedExtents.length ? Math.max(...locatedExtents.map((e) => e.toM)) : NaN;
    const atomicIndexes = [...new Set(locatedExtents.flatMap((e) => e.atomicIndexes))].sort(
      (a, b) => a - b,
    );
    const segmentIds = [...new Set(locatedExtents.flatMap((e) => e.segmentIds))];
    const representativeM = locatedExtents.length
      ? (Math.min(...locatedExtents.map((e) => e.representativeM)) +
          Math.max(...locatedExtents.map((e) => e.representativeM))) /
        2
      : NaN;

    // 数量核定
    const counts = group.map((o) => o.count);
    const sameCount = counts.every((c) => c === counts[0]);
    const minVals = group.map((o) => o.minCount ?? o.count);
    const maxVals = group.map((o) => o.maxCount ?? o.count);
    const minCount = group.some((o) => o.minCount !== undefined)
      ? Math.max(...minVals)
      : undefined;
    const maxCount = group.some((o) => o.maxCount !== undefined)
      ? Math.min(...maxVals)
      : undefined;

    // 空间相容性：点状观测距离 / 区间相交
    let spatiallyCompatible = true;
    for (let i = 0; i < locatedExtents.length; i++) {
      for (let j = i + 1; j < locatedExtents.length; j++) {
        if (!spatiallyClose(locatedExtents[i]!, locatedExtents[j]!, opts)) {
          spatiallyCompatible = false;
        }
      }
    }

    const sameObserver = new Set(group.map((o) => o.observer).filter(Boolean)).size <= 1;
    const retroactive = group.some((o) => o.retroactive);
    const multipleBatches = new Set(group.map((o) => o.batchId)).size > 1;

    let status: Sighting["status"];
    let conflictReason: string | undefined;
    let resolvedCount: number;

    if (group.length === 1) {
      status = "confirmed";
      resolvedCount = anchor.count;
    } else if (sameCount && spatiallyCompatible && sameObserver) {
      status = "auto-merged";
      resolvedCount = counts[0]!;
    } else if (!sameCount) {
      status = "conflict";
      conflictReason = `数量不一致：${[...new Set(counts)].join(" / ")}`;
      resolvedCount = Math.max(...counts);
    } else if (!spatiallyCompatible) {
      status = "conflict";
      conflictReason = "位置不相容：同一时窗内记录落在不相交的桩号范围";
      resolvedCount = counts.reduce((sum, c) => sum + c, 0);
    } else {
      status = "unresolved";
      conflictReason = "不同记录者对同一目击的重复记录，需人工确认";
      resolvedCount = counts[0]!;
    }

    const observedAt = sortedByTime
      .map((o) => o.observedAt)
      .reduce((acc, t) => minTime(acc, t));

    const sighting: Sighting = {
      id,
      anchorObservationId: anchor.id,
      routeId: anchor.routeId,
      speciesCode: anchor.speciesCode,
      speciesName: anchor.speciesName,
      observedAt,
      observationIds: sortedByTime.map((o) => o.id),
      resolvedCount,
      fromM,
      toM,
      representativeM,
      atomicIndexes,
      segmentIds,
      batchIds: [...new Set(group.map((o) => o.batchId))],
      observers: [...new Set(group.map((o) => o.observer).filter(Boolean))] as string[],
      status,
      retroactive,
      notes: group.map((o) => o.note).filter(Boolean) as string[],
    };
    if (minCount !== undefined && maxCount !== undefined && minCount !== maxCount) {
      sighting.minCount = minCount;
      sighting.maxCount = maxCount;
    }
    if (conflictReason) sighting.conflictReason = conflictReason;
    sightings.push(sighting);

    // —— 复核问题 ——
    if (status === "conflict" || status === "unresolved") {
      issues.push({
        code: "COUNT_MISMATCH",
        severity: "error",
        message: `目击 ${id}（${anchor.speciesName} @${observedAt}）${conflictReason}`,
        sightingId: id,
        relatedIds: sighting.observationIds,
      });
    }
    if (group.length > 1 && segmentIds.length > 1 && status === "auto-merged") {
      issues.push({
        code: "SIGHTING_SPATIALLY_MERGED",
        severity: "info",
        message: `目击 ${id} 跨越重叠分段 ${segmentIds.join("、")}，重复记录已自动去重`,
        sightingId: id,
        relatedIds: segmentIds,
      });
    }
    const timeSpread = Math.abs(
      diffMinutes(
        sortedByTime[0]!.observedAt,
        sortedByTime[sortedByTime.length - 1]!.observedAt,
      ),
    );
    if (group.length > 1 && timeSpread > opts.timeWindowMinutes * 0.8) {
      issues.push({
        code: "SIGHTING_TIME_SPREAD",
        severity: "warning",
        message: `目击 ${id} 合并的记录时间跨度 ${timeSpread.toFixed(0)} 分钟，接近时窗上限，请确认是否为同一只/群`,
        sightingId: id,
      });
    }
    if (retroactive) {
      issues.push({
        code: "RETROACTIVE_ENTRY",
        severity: "info",
        message: `目击 ${id} 含事后补录记录，已按观察时刻对齐到时间线`,
        sightingId: id,
        relatedIds: sighting.batchIds,
      });
    }
    if (group.length >= opts.largeClusterSize) {
      issues.push({
        code: "LARGE_CLUSTER",
        severity: "warning",
        message: `目击 ${id} 由 ${group.length} 条记录归并而成，疑似把多次出现合并为一次`,
        sightingId: id,
      });
    }
    if (locatedExtents.length === 0) {
      issues.push({
        code: "MISSING_LOCATION",
        severity: "warning",
        message: `目击 ${id}（${anchor.speciesName}）缺少可解析的沿线位置，未参与空间对齐`,
        sightingId: id,
        relatedIds: sighting.observationIds,
      });
    }
    if (multipleBatches) {
      issues.push({
        code: "RETROACTIVE_ENTRY",
        severity: "info",
        message: `目击 ${id} 由 ${sighting.batchIds.length} 个批次的记录对齐而成`,
        sightingId: id,
        relatedIds: sighting.batchIds,
      });
    }
  });

  // 时间线输出按观察时刻排序；编号仍保持锚点录入序（稳定）
  sightings.sort(
    (a, b) =>
      parseTime(a.observedAt).getTime() - parseTime(b.observedAt).getTime() ||
      a.representativeM - b.representativeM ||
      a.id.localeCompare(b.id),
  );

  return { sightings, issues, extents };
}
