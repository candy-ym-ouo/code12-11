/**
 * 样线调查 · 对齐引擎（纯函数，不依赖数据库，便于单测与复核）
 *
 * 每条录入是「里程 × 时间」二维矩形：
 *   - 沿固定路线的里程区间 [startM, endM)
 *   - 观测时间区间 [startAt, endAt]（瞬时记录两端相等）
 *
 * 引擎做三件事：
 *   1. 用同物种所有矩形的边界（外加分段边界）切出网格，合并相邻且录入集合
 *      相同的格子，得到一张「互不重叠、并集等于全部录入」的统一时间线；
 *   2. 用面积权重 + 最大余数法，把每条录入的整数数量守恒地分摊到它覆盖的片段；
 *   3. 找出相交矩形对（现场重叠 / 事后补录落入既有区间），供复核流程处理。
 *
 * 重新录入或补录只影响网格切分，原始录入永不修改；
 * 冲突的处理决定持久化在 TransectConflict 中，重算时依然生效。
 */

// 瞬时记录与精确点位在几何上退化为点，统一展开成极小窗口，保证半开区间语义一致。
export const TIME_EPS_MS = 1; // 1 毫秒
export const M_EPS = 0.001; // 1 毫米

export interface AlignmentEntry {
  id: string;
  speciesName: string;
  speciesId: string | null;
  category: string | null;
  startAt: number; // epoch ms
  endAt: number;
  startM: number;
  endM: number;
  count: number;
  source: string;
  observer: string | null;
  notes: string | null;
  segmentId: string | null;
  observedAt: number;
  recordedAt: number;
  createdAt: number;
}

export type ConflictResolution = "PENDING" | "KEEP_A" | "KEEP_B" | "SUM" | "DUPLICATE";

export interface ResolutionInput {
  id: string;
  entryAId: string;
  entryBId: string;
  resolution: ConflictResolution;
}

export interface SliceShare {
  entryId: string;
  count: number;
}

export interface TimelineSlice {
  key: string;
  speciesName: string;
  /** 由 service 根据片段中点所属分段填充 */
  segmentId: string | null;
  startM: number;
  endM: number;
  startAt: number;
  endAt: number;
  shares: SliceShare[];
  /** 未经冲突处理的数量合计 */
  totalRaw: number;
  /** 应用复核决定后的数量合计（未处理的重叠保持合计并标记 pending） */
  totalResolved: number;
  conflictIds: string[];
  pending: boolean;
  /** 片段是否包含事后补录 */
  source: string;
  observer: string | null;
  notes: string | null;
}

export interface Overlap {
  entryAId: string;
  entryBId: string;
  startM: number;
  endM: number;
  startAt: number;
  endAt: number;
}

interface Box {
  entry: AlignmentEntry;
  m0: number;
  m1: number;
  t0: number;
  t1: number;
}

interface Rect {
  m0: number;
  m1: number;
  t0: number;
  t1: number;
  cover: string[]; // entry ids，确定性排序
  coverKey: string;
  /** 所属分段标签；相邻格子即使录入集合相同，跨分段也不合并 */
  segmentLabel: string;
}

export interface SegmentRange {
  id: string;
  orderIndex: number;
  startM: number;
  endM: number;
}

function segmentLabelAt(midM: number, segments: SegmentRange[]): string {
  const hit = segments.find((s) => midM >= s.startM - 1e-9 && midM < s.endM + 1e-9);
  return hit ? hit.id : `__none_${Math.round(midM * 1e6)}`;
}

function toBox(entry: AlignmentEntry): Box {
  return {
    entry,
    m0: entry.startM,
    m1: entry.endM > entry.startM ? entry.endM : entry.startM + M_EPS,
    t0: entry.startAt,
    t1: entry.endAt > entry.startAt ? entry.endAt : entry.startAt + TIME_EPS_MS,
  };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
}

/** 瞬时/点窗口在输出时坍缩回单点。 */
function emitStartM(rect: Rect): number {
  return rect.m0;
}
function emitEndM(rect: Rect): number {
  return rect.m1 - rect.m0 <= M_EPS * 1.5 ? rect.m0 : rect.m1;
}
function emitStartAt(rect: Rect): number {
  return rect.t0;
}
function emitEndAt(rect: Rect): number {
  return rect.t1 - rect.t0 <= TIME_EPS_MS * 1.5 ? rect.t0 : rect.t1;
}

function rectKey(r: Rect): string {
  return `${r.m0}|${r.m1}|${r.t0}|${r.t1}|${r.coverKey}`;
}

/** 里程上额外插入分段边界，保证片段不跨分段，便于按段复核与统计。 */
export function buildTimeline(
  entries: AlignmentEntry[],
  resolutions: ResolutionInput[] = [],
  segments: SegmentRange[] = [],
): TimelineSlice[] {
  if (entries.length === 0) return [];
  const segmentCuts = segments.flatMap((s) => [s.startM, s.endM]);

  const bySpecies = new Map<string, AlignmentEntry[]>();
  for (const entry of entries) {
    const list = bySpecies.get(entry.speciesName) ?? [];
    list.push(entry);
    bySpecies.set(entry.speciesName, list);
  }

  const resolutionByPair = new Map<string, ResolutionInput>();
  for (const r of resolutions) resolutionByPair.set(pairKey(r.entryAId, r.entryBId), r);

  const slices: TimelineSlice[] = [];
  for (const [speciesName, group] of bySpecies) {
    const boxes = group.map(toBox);
    const boxById = new Map(boxes.map((b) => [b.entry.id, b]));

    const mCuts = uniqueSorted([
      ...boxes.flatMap((b) => [b.m0, b.m1]),
      ...segmentCuts,
    ]);
    const tCuts = uniqueSorted(boxes.flatMap((b) => [b.t0, b.t1]));

    // 1) 构造网格矩形并记录覆盖集合
    const rects: Rect[] = [];
    for (let mi = 0; mi < mCuts.length - 1; mi++) {
      for (let ti = 0; ti < tCuts.length - 1; ti++) {
        const m0 = mCuts[mi];
        const m1 = mCuts[mi + 1];
        const rect: Rect = {
          m0,
          m1,
          t0: tCuts[ti],
          t1: tCuts[ti + 1],
          cover: [],
          coverKey: "",
          segmentLabel: segmentLabelAt((m0 + m1) / 2, segments),
        };
        for (const box of boxes) {
          if (
            rect.m0 >= box.m0 - 1e-9 &&
            rect.m1 <= box.m1 + 1e-9 &&
            rect.t0 >= box.t0 - 1e-6 &&
            rect.t1 <= box.t1 + 1e-6
          ) {
            rect.cover.push(box.entry.id);
          }
        }
        if (rect.cover.length === 0) continue;
        rect.cover.sort();
        rect.coverKey = rect.cover.join("+");
        rects.push(rect);
      }
    }

    // 2) 合并相邻且覆盖集合相同的矩形，得到最大片段
    const merged = mergeAdjacent(rects);

    // 3) 每条录入按「里程长度 × 时间跨度」权重，用最大余数法分摊整数数量
    const apportionment = new Map<string, Map<string, number>>();
    for (const box of boxes) {
      const targets = merged.filter((r) => r.cover.includes(box.entry.id));
      const weights = targets.map(
        (r) => Math.max(r.m1 - r.m0, 0) * Math.max(r.t1 - r.t0, 1),
      );
      const counts = apportionInteger(box.entry.count, weights);
      const map = new Map<string, number>();
      targets.forEach((r, i) => map.set(rectKey(r), counts[i]));
      apportionment.set(box.entry.id, map);
    }

    // 4) 相交录入对决定每个片段的冲突状态
    const overlaps = detectOverlaps(boxes);
    const overlapByPair = new Map(overlaps.map((o) => [pairKey(o.entryAId, o.entryBId), o]));

    merged.forEach((rect, index) => {
      const shares: SliceShare[] = rect.cover.map((entryId) => ({
        entryId,
        count: apportionment.get(entryId)!.get(rectKey(rect)) ?? 0,
      }));

      const coveringPairKeys: string[] = [];
      for (let i = 0; i < rect.cover.length; i++) {
        for (let j = i + 1; j < rect.cover.length; j++) {
          coveringPairKeys.push(pairKey(rect.cover[i], rect.cover[j]));
        }
      }
      const coveringConflicts = coveringPairKeys
        .map((key) => resolutionByPair.get(key) ?? pendingSynthetic(key, overlapByPair.get(key)))
        .filter((r): r is ResolutionInput => r !== null);

      const dropped = new Set<string>();
      for (const conflict of coveringConflicts) {
        if (conflict.resolution === "KEEP_A") dropped.add(conflict.entryBId);
        else if (conflict.resolution === "KEEP_B") dropped.add(conflict.entryAId);
        else if (conflict.resolution === "DUPLICATE") {
          // 同一批动物被记两次：该片段保留分摊数量较大者；相等则保留先录入者
          const shareA = shares.find((s) => s.entryId === conflict.entryAId)?.count ?? 0;
          const shareB = shares.find((s) => s.entryId === conflict.entryBId)?.count ?? 0;
          if (shareA === shareB) {
            const a = boxById.get(conflict.entryAId)!;
            const b = boxById.get(conflict.entryBId)!;
            const aFirst =
              a.entry.recordedAt < b.entry.recordedAt ||
              (a.entry.recordedAt === b.entry.recordedAt && a.entry.createdAt <= b.entry.createdAt);
            dropped.add(aFirst ? conflict.entryBId : conflict.entryAId);
          } else {
            dropped.add(shareA > shareB ? conflict.entryBId : conflict.entryAId);
          }
        }
      }

      const totalRaw = shares.reduce((sum, s) => sum + s.count, 0);
      const totalResolved = shares
        .filter((s) => !dropped.has(s.entryId))
        .reduce((sum, s) => sum + s.count, 0);
      const pending = coveringConflicts.some((c) => c.resolution === "PENDING");
      const source = rect.cover.some((id) => boxById.get(id)?.entry.source === "BACKFILL")
        ? "BACKFILL"
        : "MANUAL";
      const observers = uniqueStrings(
        rect.cover.map((id) => boxById.get(id)?.entry.observer ?? null),
      );
      const notesList = rect.cover
        .map((id) => boxById.get(id)?.entry.notes ?? null)
        .filter((n): n is string => !!n);

      slices.push({
        key: `${speciesName}-${index}`,
        speciesName,
        segmentId: rect.segmentLabel.startsWith("__none_") ? null : rect.segmentLabel,
        startM: emitStartM(rect),
        endM: emitEndM(rect),
        startAt: emitStartAt(rect),
        endAt: emitEndAt(rect),
        shares,
        totalRaw,
        totalResolved,
        conflictIds: coveringConflicts.map((c) => c.id),
        pending,
        source,
        observer: observers.length > 0 ? observers.join("、") : null,
        notes: notesList.length > 0 ? notesList.join(" / ") : null,
      });
    });
  }

  slices.sort(
    (a, b) =>
      a.startAt - b.startAt || a.startM - b.startM || a.speciesName.localeCompare(b.speciesName),
  );
  return slices;
}

/** 检测同物种矩形两两相交，按录入先后确定 A（先）/ B（后）。 */
export function detectOverlaps(boxesInput: AlignmentEntry[] | Box[]): Overlap[] {
  const boxes = boxesInput.map((b) =>
    "entry" in b ? (b as Box) : toBox(b as AlignmentEntry),
  );
  const ordered = [...boxes].sort(
    (a, b) =>
      a.entry.recordedAt - b.entry.recordedAt ||
      a.entry.createdAt - b.entry.createdAt ||
      a.entry.id.localeCompare(b.entry.id),
  );
  const overlaps: Overlap[] = [];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      const m0 = Math.max(a.m0, b.m0);
      const m1 = Math.min(a.m1, b.m1);
      const t0 = Math.max(a.t0, b.t0);
      const t1 = Math.min(a.t1, b.t1);
      if (m1 <= m0 + 1e-9 || t1 <= t0 + 1e-6) continue;
      overlaps.push({
        entryAId: a.entry.id,
        entryBId: b.entry.id,
        startM: m0,
        endM: m1 - m0 <= M_EPS * 1.5 ? m0 : m1,
        startAt: t0,
        endAt: t1 - t0 <= TIME_EPS_MS * 1.5 ? t0 : t1,
      });
    }
  }
  return overlaps;
}

/**
 * 最大余数法把整数 total 按 weights 比例分摊：
 * 先按比例取整，再把余数按小数部分从大到小补齐，保证分摊之和恒等于 total。
 */
export function apportionInteger(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (total === 0) return new Array(n).fill(0);

  const weightSum = weights.reduce((a, b) => a + b, 0);
  const raw =
    weightSum <= 0
      ? new Array(n).fill(total / n)
      : weights.map((w) => (total * w) / weightSum);

  const floors = raw.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

// ---- 内部工具 ----

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}

function pendingSynthetic(key: string, overlap: Overlap | undefined): ResolutionInput | null {
  if (!overlap) return null;
  const [a, b] = key.split("::");
  return { id: `pending:${key}`, entryAId: a, entryBId: b, resolution: "PENDING" };
}

function uniqueStrings(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

function mergeAdjacent(rects: Rect[]): Rect[] {
  const parent = rects.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rects[i].coverKey !== rects[j].coverKey) continue;
      if (rects[i].segmentLabel !== rects[j].segmentLabel) continue;
      const a = rects[i];
      const b = rects[j];
      // 沿里程相邻要求时间区间完全重合；沿时间相邻要求里程区间完全重合
      const sameTimeSpan = Math.abs(a.t0 - b.t0) <= 1e-6 && Math.abs(a.t1 - b.t1) <= 1e-6;
      const sameSpaceSpan = Math.abs(a.m0 - b.m0) <= 1e-9 && Math.abs(a.m1 - b.m1) <= 1e-9;
      const adjacentM =
        sameTimeSpan && (Math.abs(a.m1 - b.m0) <= 1e-9 || Math.abs(b.m1 - a.m0) <= 1e-9);
      const adjacentT =
        sameSpaceSpan && (Math.abs(a.t1 - b.t0) <= 1e-6 || Math.abs(b.t1 - a.t0) <= 1e-6);
      if (adjacentM || adjacentT) union(i, j);
    }
  }

  const groups = new Map<number, Rect[]>();
  rects.forEach((r, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(r);
    groups.set(root, list);
  });

  return [...groups.values()].map((list) => ({
    m0: Math.min(...list.map((r) => r.m0)),
    m1: Math.max(...list.map((r) => r.m1)),
    t0: Math.min(...list.map((r) => r.t0)),
    t1: Math.max(...list.map((r) => r.t1)),
    cover: list[0].cover,
    coverKey: list[0].coverKey,
    segmentLabel: list[0].segmentLabel,
  }));
}

// ---- service 层辅助：把片段中点映射到分段，与汇总 ----

export interface SegmentRange {
  id: string;
  orderIndex: number;
  startM: number;
  endM: number;
}

/** 根据片段里程中点填充 segmentId（切分时已插入分段边界，中点必然落在唯一段内）。 */
export function assignSegmentIds(slices: TimelineSlice[], segments: SegmentRange[]): void {
  for (const slice of slices) {
    const mid = (slice.startM + slice.endM) / 2;
    const hit = segments.find((s) => mid >= s.startM - 1e-9 && mid < s.endM + 1e-9);
    if (hit) slice.segmentId = hit.id;
  }
}

export interface TimelineSummary {
  totalRaw: number;
  totalResolved: number;
  pendingSlices: number;
  bySpecies: { speciesName: string; totalRaw: number; totalResolved: number; slices: number }[];
  bySegment: { segmentId: string; totalRaw: number; totalResolved: number }[];
}

export function summarizeTimeline(slices: TimelineSlice[]): TimelineSummary {
  const species = new Map<string, { totalRaw: number; totalResolved: number; slices: number }>();
  const segment = new Map<string, { totalRaw: number; totalResolved: number }>();

  for (const s of slices) {
    const speciesEntry = species.get(s.speciesName) ?? { totalRaw: 0, totalResolved: 0, slices: 0 };
    speciesEntry.totalRaw += s.totalRaw;
    speciesEntry.totalResolved += s.totalResolved;
    speciesEntry.slices += 1;
    species.set(s.speciesName, speciesEntry);

    if (s.segmentId) {
      const segEntry = segment.get(s.segmentId) ?? { totalRaw: 0, totalResolved: 0 };
      segEntry.totalRaw += s.totalRaw;
      segEntry.totalResolved += s.totalResolved;
      segment.set(s.segmentId, segEntry);
    }
  }

  return {
    totalRaw: slices.reduce((sum, s) => sum + s.totalRaw, 0),
    totalResolved: slices.reduce((sum, s) => sum + s.totalResolved, 0),
    pendingSlices: slices.filter((s) => s.pending).length,
    bySpecies: [...species.entries()]
      .map(([speciesName, v]) => ({ speciesName, ...v }))
      .sort((a, b) => a.speciesName.localeCompare(b.speciesName)),
    bySegment: [...segment.entries()]
      .map(([segmentId, v]) => ({ segmentId, ...v }))
      .sort((a, b) => a.segmentId.localeCompare(b.segmentId)),
  };
}

/** 校验录入的里程区间落在样线长度内。 */
export function validateRange(startM: number, endM: number, lengthM: number): void {
  if (!Number.isFinite(startM) || !Number.isFinite(endM)) {
    throw new RangeError("里程必须是数字");
  }
  if (startM < 0 || endM < 0) throw new RangeError("里程不能为负");
  if (endM < startM) throw new RangeError("里程上界不能小于下界");
  if (lengthM > 0 && endM > lengthM + 1e-6) {
    throw new RangeError(`里程超出样线长度 ${lengthM} 米`);
  }
}
