import type {
  AtomicInterval,
  Observation,
  Route,
  Segment,
} from "./types.js";
import { lngLatToChainage, routeLengthM } from "./geometry.js";

/** 桩号浮点比较容差（米） */
export const EPS_M = 1e-6;

export function overlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  // 端点接触（长度恰为 0）不算重叠；仅在差值小于 EPS 时视为浮点噪声
  const len = overlapLength(a0, a1, b0, b1);
  return len > EPS_M;
}

function dedupeSorted(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]!) > EPS_M) out.push(v);
  }
  return out;
}

/**
 * 把所有分段（允许跨批次重叠）切成原子分段：
 * 取全部端点排序去重，相邻端点之间的区间所命中的分段集合恒定。
 */
export function buildAtomicIntervals(segments: Segment[]): AtomicInterval[] {
  const boundaries = segments
    .flatMap((s) => [s.fromM, s.toM])
    .sort((a, b) => a - b);
  const unique = dedupeSorted(boundaries);
  const result: AtomicInterval[] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const fromM = unique[i]!;
    const toM = unique[i + 1]!;
    if (toM - fromM <= EPS_M) continue;
    const segmentIds = segments
      .filter((s) => intervalsOverlap(fromM, toM, s.fromM, s.toM))
      .map((s) => s.id);
    result.push({ index: result.length, fromM, toM, segmentIds });
  }
  return result;
}

/** 点落在哪些原子分段（端点处归入右侧区间，避免重复计数） */
export function pointAtomicIndexes(atM: number, intervals: AtomicInterval[]): number[] {
  return intervals
    .filter(
      (iv) =>
        atM >= iv.fromM - EPS_M &&
        atM < iv.toM - EPS_M,
    )
    .map((iv) => iv.index);
}

/** 区间覆盖哪些原子分段 */
export function rangeAtomicIndexes(
  fromM: number,
  toM: number,
  intervals: AtomicInterval[],
): number[] {
  return intervals
    .filter((iv) => intervalsOverlap(iv.fromM, iv.toM, fromM, toM))
    .map((iv) => iv.index);
}

export interface ObservationExtent {
  fromM: number;
  toM: number;
  representativeM: number;
  atomicIndexes: number[];
  segmentIds: string[];
  locatedBy: "atM" | "range" | "segment" | "coordinates" | "none";
  offsetM?: number;
}

/**
 * 确定一条观测的沿线范围与所属分段。
 * 位置优先级：显式桩号/区间 > 坐标投影 > 所属分段兜底。
 * （坐标是比「属于哪一段」更精确的位置信息；声明的分段仅用于校验与审计。）
 */
export function observationExtent(
  obs: Observation,
  route: Route,
  segments: Segment[],
  intervals: AtomicInterval[],
): ObservationExtent {
  const segment = obs.segmentId
    ? segments.find((s) => s.id === obs.segmentId)
    : undefined;

  let fromM: number;
  let toM: number;
  let representativeM: number;
  let locatedBy: ObservationExtent["locatedBy"] = "none";
  let offsetM: number | undefined;

  if (obs.fromM !== undefined && obs.toM !== undefined) {
    fromM = obs.fromM;
    toM = obs.toM;
    representativeM = obs.atM ?? (fromM + toM) / 2;
    locatedBy = "range";
  } else if (obs.atM !== undefined) {
    fromM = obs.atM;
    toM = obs.atM;
    representativeM = obs.atM;
    locatedBy = "atM";
  } else if (obs.lng !== undefined && obs.lat !== undefined) {
    const proj = lngLatToChainage(route, { lng: obs.lng, lat: obs.lat });
    if (proj) {
      fromM = proj.chainage;
      toM = proj.chainage;
      representativeM = proj.chainage;
      locatedBy = "coordinates";
      offsetM = proj.offsetM;
    } else {
      fromM = NaN;
      toM = NaN;
      representativeM = NaN;
    }
  } else if (segment) {
    fromM = segment.fromM;
    toM = segment.toM;
    representativeM = (fromM + toM) / 2;
    locatedBy = "segment";
  } else {
    fromM = NaN;
    toM = NaN;
    representativeM = NaN;
  }

  const atomicIndexes =
    Number.isNaN(fromM) || Number.isNaN(toM)
      ? []
      : fromM === toM
        ? pointAtomicIndexes(fromM, intervals)
        : rangeAtomicIndexes(fromM, toM, intervals);

  const idSet = new Set<string>();
  for (const idx of atomicIndexes) intervals[idx]?.segmentIds.forEach((id) => idSet.add(id));
  if (segment) idSet.add(segment.id);

  return {
    fromM,
    toM,
    representativeM,
    atomicIndexes,
    segmentIds: [...idSet],
    locatedBy,
    offsetM,
  };
}

/** 分段与其他分段的重叠长度 */
export function overlapWithOthers(segment: Segment, segments: Segment[]): number {
  let total = 0;
  for (const iv of buildAtomicIntervals(segments)) {
    if (!iv.segmentIds.includes(segment.id)) continue;
    if (iv.segmentIds.some((id) => id !== segment.id)) {
      total += iv.toM - iv.fromM;
    }
  }
  return total;
}

/** 路线有效长度（桩号 0 到末端） */
export function routeLength(route: Route): number {
  return routeLengthM(route);
}
