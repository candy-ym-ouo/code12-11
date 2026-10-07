import type { Prisma, Transect, TransectSegment } from "@prisma/client";
import { getOwnedSite, getOwnedSpecies, getOwnedTransect } from "../../lib/access";
import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import {
  type AlignmentEntry,
  type ConflictResolution,
  type ResolutionInput,
  type TimelineSlice,
  buildTimeline,
  detectOverlaps,
  summarizeTimeline,
  validateRange,
} from "./alignment";
import type {
  CreateEntryInput,
  CreateTransectInput,
  ExportQuery,
  ResolveConflictInput,
  SegmentInput,
  UpdateEntryInput,
  UpdateTransectInput,
} from "./schema";

const EPS = 1e-6;

// ============================================================
// 路线
// ============================================================

export type TransectSummary = Transect & {
  segmentCount: number;
  entryCount: number;
  pendingConflictCount: number;
  lastObservedAt: string | null;
};

async function decorateTransects(userId: string, transects: Transect[]): Promise<TransectSummary[]> {
  if (transects.length === 0) return [];
  const ids = transects.map((t) => t.id);

  const [segments, entries, pending] = await Promise.all([
    prisma.transectSegment.groupBy({ by: ["transectId"], where: { transectId: { in: ids } }, _count: { _all: true } }),
    prisma.transectEntry.groupBy({
      by: ["transectId"],
      where: { transectId: { in: ids } },
      _count: { _all: true },
      _max: { observedAt: true },
    }),
    prisma.transectConflict.groupBy({
      by: ["transectId"],
      where: { transectId: { in: ids }, resolution: "PENDING" },
      _count: { _all: true },
    }),
  ]);

  const segMap = new Map(segments.map((r) => [r.transectId, r._count._all]));
  const entryMap = new Map(entries.map((r) => [r.transectId, { count: r._count._all, last: r._max.observedAt }]));
  const pendingMap = new Map(pending.map((r) => [r.transectId, r._count._all]));

  return transects.map((t) => ({
    ...t,
    segmentCount: segMap.get(t.id) ?? 0,
    entryCount: entryMap.get(t.id)?.count ?? 0,
    pendingConflictCount: pendingMap.get(t.id) ?? 0,
    lastObservedAt: entryMap.get(t.id)?.last?.toISOString() ?? null,
  }));
}

export async function listTransects(
  userId: string,
  includeArchived: boolean,
): Promise<TransectSummary[]> {
  const transects = await prisma.transect.findMany({
    where: { ownerId: userId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: "asc" }, { createdAt: "asc" }],
  });
  return decorateTransects(userId, transects);
}

export async function createTransect(userId: string, input: CreateTransectInput): Promise<TransectSummary> {
  const existing = await prisma.transect.findFirst({ where: { ownerId: userId, name: input.name } });
  if (existing) throw new ApiError(409, "DUPLICATE_RECORD", "已存在同名样线");
  if (input.siteId) await getOwnedSite(userId, input.siteId);

  const transect = await prisma.transect.create({
    data: {
      ownerId: userId,
      name: input.name,
      code: input.code ?? null,
      siteId: input.siteId ?? null,
      description: input.description ?? null,
    },
  });
  return (await decorateTransects(userId, [transect]))[0];
}

export async function getTransect(userId: string, transectId: string): Promise<TransectSummary> {
  const transect = await getOwnedTransect(userId, transectId);
  return (await decorateTransects(userId, [transect]))[0];
}

export async function updateTransect(
  userId: string,
  transectId: string,
  input: UpdateTransectInput,
): Promise<TransectSummary> {
  await getOwnedTransect(userId, transectId);
  if (input.name) {
    const duplicate = await prisma.transect.findFirst({
      where: { ownerId: userId, name: input.name, NOT: { id: transectId } },
    });
    if (duplicate) throw new ApiError(409, "DUPLICATE_RECORD", "已存在同名样线");
  }
  if (input.siteId) await getOwnedSite(userId, input.siteId);

  const transect = await prisma.transect.update({
    where: { id: transectId },
    data: {
      name: input.name,
      code: input.code === undefined ? undefined : input.code ?? null,
      siteId: input.siteId === undefined ? undefined : input.siteId ?? null,
      description: input.description === undefined ? undefined : input.description ?? null,
    },
  });
  return (await decorateTransects(userId, [transect]))[0];
}

export async function setTransectArchived(
  userId: string,
  transectId: string,
  archived: boolean,
): Promise<TransectSummary> {
  await getOwnedTransect(userId, transectId);
  const transect = await prisma.transect.update({
    where: { id: transectId },
    data: { archivedAt: archived ? new Date() : null },
  });
  return (await decorateTransects(userId, [transect]))[0];
}

export async function deleteTransect(userId: string, transectId: string): Promise<void> {
  await getOwnedTransect(userId, transectId);
  await prisma.transect.delete({ where: { id: transectId } });
}

// ============================================================
// 分段
// ============================================================

function serializeSegment(segment: TransectSegment) {
  return {
    ...segment,
    geometry: segment.geometry ? (JSON.parse(segment.geometry) as number[][]) : null,
  };
}

export async function listSegments(userId: string, transectId: string) {
  await getOwnedTransect(userId, transectId);
  const segments = await prisma.transectSegment.findMany({
    where: { transectId },
    orderBy: { orderIndex: "asc" },
  });
  return segments.map(serializeSegment);
}

/**
 * 整体替换分段定义（编辑路线时唯一入口）：
 * 按 orderIndex 必须从 0 连续、里程从 0 起首尾相接、互不重叠；
 * 保留带 id 的分段（录入的 segmentId 不断链），删除未出现的旧段；
 * 若新长度短于既有录入的里程，返回 409 拒绝修改。
 */
export async function replaceSegments(userId: string, transectId: string, input: SegmentInput[]) {
  await getOwnedTransect(userId, transectId);
  const ordered = [...input].sort((a, b) => a.orderIndex - b.orderIndex);

  if (ordered.some((s, i) => s.orderIndex !== i)) {
    throw new ApiError(400, "VALIDATION_ERROR", "分段序号必须从 0 开始且连续");
  }
  if (Math.abs(ordered[0].startM) > EPS) {
    throw new ApiError(400, "VALIDATION_ERROR", "第一个分段必须从里程 0 开始");
  }
  for (let i = 0; i < ordered.length; i++) {
    const seg = ordered[i];
    if (seg.endM <= seg.startM) {
      throw new ApiError(400, "VALIDATION_ERROR", `分段「${seg.name}」长度必须为正`);
    }
    if (i > 0 && Math.abs(seg.startM - ordered[i - 1].endM) > EPS) {
      throw new ApiError(400, "VALIDATION_ERROR", "分段必须首尾相接，不能重叠或留空");
    }
  }
  const newLength = ordered[ordered.length - 1].endM;

  const outside = await prisma.transectEntry.count({
    where: { transectId, endM: { gt: newLength + EPS } },
  });
  if (outside > 0) {
    throw new ApiError(409, "RESOURCE_IN_USE", "缩短路线会使既有录入越界，请先调整相关录入", {
      count: outside,
    });
  }

  const existing = await prisma.transectSegment.findMany({ where: { transectId } });
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const keepIds = new Set<string>();
  for (const seg of ordered) {
    if (seg.id) {
      const found = existingById.get(seg.id);
      if (!found) throw new ApiError(400, "VALIDATION_ERROR", `分段 ${seg.id} 不属于该样线`);
      keepIds.add(seg.id);
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    for (const seg of ordered) {
      const data = {
        orderIndex: seg.orderIndex,
        startM: seg.startM,
        endM: seg.endM,
        name: seg.name,
        habitat: seg.habitat ?? null,
        geometry: seg.geometry ? JSON.stringify(seg.geometry) : null,
      };
      if (seg.id) await tx.transectSegment.update({ where: { id: seg.id }, data });
      else await tx.transectSegment.create({ data: { transectId, ...data } });
    }
    // 只删除本次提交之前已存在、且未保留 id 的旧分段；本次新建的分段不受影响
    const staleIds = existing.map((s) => s.id).filter((id) => !keepIds.has(id));
    if (staleIds.length > 0) {
      await tx.transectSegment.deleteMany({ where: { transectId, id: { in: staleIds } } });
    }
    await tx.transect.update({ where: { id: transectId }, data: { lengthM: newLength } });

    // 重新落点：录入中点所在的分段
    const freshSegments = await tx.transectSegment.findMany({
      where: { transectId },
      orderBy: { orderIndex: "asc" },
    });
    const entries = await tx.transectEntry.findMany({ where: { transectId } });
    for (const entry of entries) {
      const mid = (entry.startM + entry.endM) / 2;
      const hit =
        freshSegments.find((s) => mid >= s.startM - EPS && mid < s.endM + EPS) ??
        freshSegments.find((s) => entry.startM >= s.startM - EPS && entry.startM < s.endM + EPS);
      await tx.transectEntry.update({
        where: { id: entry.id },
        data: { segmentId: hit?.id ?? null },
      });
    }
    return freshSegments;
  });

  return saved.map(serializeSegment);
}

// ============================================================
// 录入
// ============================================================

function toAlignmentEntry(
  entry: Prisma.TransectEntryGetPayload<Record<string, never>>,
): AlignmentEntry {
  return {
    id: entry.id,
    speciesName: entry.speciesName,
    speciesId: entry.speciesId,
    category: entry.category,
    startAt: entry.startAt.getTime(),
    endAt: entry.endAt.getTime(),
    startM: entry.startM,
    endM: entry.endM,
    count: entry.count,
    source: entry.source,
    observer: entry.observer,
    notes: entry.notes,
    segmentId: entry.segmentId,
    observedAt: entry.observedAt.getTime(),
    recordedAt: entry.recordedAt.getTime(),
    createdAt: entry.createdAt.getTime(),
  };
}

function serializeEntry(entry: Prisma.TransectEntryGetPayload<{ include: { segment: true } }>) {
  return {
    id: entry.id,
    transectId: entry.transectId,
    speciesId: entry.speciesId,
    speciesName: entry.speciesName,
    category: entry.category,
    segmentId: entry.segmentId,
    segmentName: entry.segment?.name ?? null,
    startM: entry.startM,
    endM: entry.endM,
    count: entry.count,
    startAt: entry.startAt.toISOString(),
    endAt: entry.endAt.toISOString(),
    observedAt: entry.observedAt.toISOString(),
    recordedAt: entry.recordedAt.toISOString(),
    source: entry.source,
    observer: entry.observer,
    notes: entry.notes,
    supersedesEntryId: entry.supersedesEntryId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export async function listEntries(userId: string, transectId: string, query: {
  speciesName?: string;
  segmentId?: string;
  source?: string;
  from?: string;
  to?: string;
}) {
  await getOwnedTransect(userId, transectId);
  const entries = await prisma.transectEntry.findMany({
    where: {
      transectId,
      ...(query.speciesName ? { speciesName: query.speciesName } : {}),
      ...(query.segmentId ? { segmentId: query.segmentId } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.from || query.to
        ? {
            startAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    },
    include: { segment: true },
    orderBy: [{ startAt: "asc" }, { startM: "asc" }],
  });
  return entries.map(serializeEntry);
}

async function resolveSpecies(
  userId: string,
  speciesId: string | null | undefined,
  fallbackName: string,
  fallbackCategory: string | null | undefined,
): Promise<{ speciesId: string | null; speciesName: string; category: string | null }> {
  if (speciesId) {
    const species = await getOwnedSpecies(userId, speciesId);
    return { speciesId: species.id, speciesName: species.commonName, category: species.category };
  }
  return { speciesId: null, speciesName: fallbackName, category: fallbackCategory ?? null };
}

/**
 * 重算样线内全部相交关系并与冲突表对齐：
 * 新增重叠（含事后补录落入既有区间）→ 建 PENDING；不再重叠 → 删除；处理决定保留。
 */
async function syncConflicts(tx: Prisma.TransactionClient, transectId: string, ownerId: string) {
  const entries = await tx.transectEntry.findMany({ where: { transectId } });
  const byId = new Map(entries.map((e) => [e.id, e]));

  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = groups.get(entry.speciesName) ?? [];
    list.push(entry);
    groups.set(entry.speciesName, list);
  }

  const pairs: { key: string; aId: string; bId: string; overlap: ReturnType<typeof detectOverlaps>[number] }[] = [];
  for (const group of groups.values()) {
    for (const overlap of detectOverlaps(group.map(toAlignmentEntry))) {
      const [aId, bId] = [overlap.entryAId, overlap.entryBId].sort();
      pairs.push({ key: `${aId}::${bId}`, aId, bId, overlap });
    }
  }
  const activeKeys = new Set(pairs.map((p) => p.key));

  const existing = await tx.transectConflict.findMany({ where: { transectId } });
  const existingKey = new Map(
    existing.map((c) => [`${c.entryAId}::${c.entryBId}`, c]),
  );

  for (const conflict of existing) {
    if (!activeKeys.has(`${conflict.entryAId}::${conflict.entryBId}`)) {
      await tx.transectConflict.delete({ where: { id: conflict.id } });
    }
  }

  for (const pair of pairs) {
    const a = byId.get(pair.aId)!;
    const b = byId.get(pair.bId)!;
    if (existingKey.has(pair.key)) continue;
    await tx.transectConflict.create({
      data: {
        transectId,
        ownerId,
        speciesName: a.speciesName,
        entryAId: pair.aId,
        entryBId: pair.bId,
        startM: pair.overlap.startM,
        endM: pair.overlap.endM,
        startAt: new Date(pair.overlap.startAt),
        endAt: new Date(pair.overlap.endAt),
        countA: a.count,
        countB: b.count,
      },
    });
  }
}

type DbClient = typeof prisma | Prisma.TransactionClient;

async function prepareEntryData(
  db: DbClient,
  userId: string,
  transectId: string,
  input: CreateEntryInput,
) {
  const transect = await db.transect.findFirst({ where: { id: transectId, ownerId: userId } });
  if (!transect) throw new ApiError(404, "NOT_FOUND", "样线不存在");
  validateRange(input.startM, input.endM, transect.lengthM);
  if (transect.lengthM === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "请先定义分段后再录入物种记录");
  }

  const species = await resolveSpecies(userId, input.speciesId ?? null, input.speciesName, input.category);
  let segmentId: string | null = null;
  if (input.segmentId) {
    const segment = await db.transectSegment.findFirst({ where: { id: input.segmentId, transectId } });
    if (!segment) throw new ApiError(400, "VALIDATION_ERROR", "分段不属于该样线");
    segmentId = segment.id;
  } else {
    const mid = (input.startM + input.endM) / 2;
    const hit = await db.transectSegment.findFirst({
      where: { transectId, startM: { lte: mid + EPS }, endM: { gt: mid - EPS } },
    });
    segmentId = hit?.id ?? null;
  }

  const startAt = new Date(input.startAt);
  const endAt = input.endAt ? new Date(input.endAt) : startAt;
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new ApiError(400, "VALIDATION_ERROR", "时间格式无效");
  }
  if (endAt.getTime() < startAt.getTime()) {
    throw new ApiError(400, "VALIDATION_ERROR", "结束时间不能早于开始时间");
  }
  // 事后补录：observedAt 取实际观测时刻；现场录入以录入时刻为 recordedAt
  const observedAt = input.observedAt ? new Date(input.observedAt) : startAt;

  return {
    data: {
      transectId,
      ownerId: userId,
      segmentId,
      speciesId: species.speciesId,
      speciesName: species.speciesName,
      category: species.category,
      startAt,
      endAt,
      startM: input.startM,
      endM: input.endM,
      count: input.count,
      observer: input.observer ?? null,
      notes: input.notes ?? null,
      source: input.source,
      observedAt,
    },
  };
}

async function insertEntryTx(
  tx: Prisma.TransactionClient,
  userId: string,
  transectId: string,
  input: CreateEntryInput,
): Promise<string> {
  const { data } = await prepareEntryData(tx, userId, transectId, input);
  const created = await tx.transectEntry.create({ data });
  await syncConflicts(tx, transectId, userId);
  return created.id;
}

export async function createEntry(userId: string, transectId: string, input: CreateEntryInput) {
  const id = await prisma.$transaction((tx) => insertEntryTx(tx, userId, transectId, input), {
    timeout: 15_000,
  });
  return getEntry(userId, transectId, id);
}

/** 事后补录并声明替代（修正）某条既有录入：被替代录入删除后重算冲突。 */
export async function backfillEntry(
  userId: string,
  transectId: string,
  supersedesEntryId: string,
  input: CreateEntryInput,
) {
  const transect = await getOwnedTransect(userId, transectId);
  const old = await prisma.transectEntry.findFirst({ where: { id: supersedesEntryId, transectId: transect.id } });
  if (!old) throw new ApiError(404, "NOT_FOUND", "被替代的录入不存在");

  const id = await prisma.$transaction(
    async (tx) => {
      const newId = await insertEntryTx(tx, userId, transectId, { ...input, source: "BACKFILL" });
      await tx.transectEntry.update({ where: { id: newId }, data: { supersedesEntryId: old.id } });
      await tx.transectConflict.deleteMany({
        where: { OR: [{ entryAId: old.id }, { entryBId: old.id }] },
      });
      await tx.transectEntry.delete({ where: { id: old.id } });
      await syncConflicts(tx, transectId, userId);
      return newId;
    },
    { timeout: 15_000 },
  );
  return getEntry(userId, transectId, id);
}

export async function getEntry(
  userId: string,
  transectId: string,
  entryId: string,
) {
  await getOwnedTransect(userId, transectId);
  const entry = await prisma.transectEntry.findFirst({
    where: { id: entryId, transectId },
    include: { segment: true },
  });
  if (!entry) throw new ApiError(404, "NOT_FOUND", "录入不存在");
  return serializeEntry(entry);
}

export async function updateEntry(
  userId: string,
  transectId: string,
  entryId: string,
  input: UpdateEntryInput,
) {
  const transect = await getOwnedTransect(userId, transectId);
  const existing = await prisma.transectEntry.findFirst({ where: { id: entryId, transectId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "录入不存在");

  validateRange(input.startM, input.endM, transect.lengthM);
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (endAt.getTime() < startAt.getTime()) {
    throw new ApiError(400, "VALIDATION_ERROR", "结束时间不能早于开始时间");
  }

  let segmentId = existing.segmentId;
  if (input.segmentId) {
    const segment = await prisma.transectSegment.findFirst({ where: { id: input.segmentId, transectId } });
    if (!segment) throw new ApiError(400, "VALIDATION_ERROR", "分段不属于该样线");
    segmentId = segment.id;
  } else {
    const mid = (input.startM + input.endM) / 2;
    const hit = await prisma.transectSegment.findFirst({
      where: { transectId, startM: { lte: mid + EPS }, endM: { gt: mid - EPS } },
    });
    segmentId = hit?.id ?? null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.transectEntry.update({
      where: { id: entryId },
      data: {
        speciesName: input.speciesName,
        category: input.category ?? null,
        segmentId,
        startM: input.startM,
        endM: input.endM,
        count: input.count,
        startAt,
        endAt,
        observedAt: input.observedAt ? new Date(input.observedAt) : startAt,
        observer: input.observer ?? null,
        notes: input.notes ?? null,
        source: input.source,
      },
    });
    await syncConflicts(tx, transectId, userId);
  });
  return getEntry(userId, transectId, entryId);
}

export async function deleteEntry(userId: string, transectId: string, entryId: string) {
  await getOwnedTransect(userId, transectId);
  const existing = await prisma.transectEntry.findFirst({ where: { id: entryId, transectId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "录入不存在");
  await prisma.$transaction(async (tx) => {
    await tx.transectConflict.deleteMany({
      where: { OR: [{ entryAId: entryId }, { entryBId: entryId }] },
    });
    await tx.transectEntry.delete({ where: { id: entryId } });
  });
  return { ok: true };
}

// ============================================================
// 冲突复核
// ============================================================

type ConflictWithEntries = Prisma.TransectConflictGetPayload<Record<string, never>> & {
  transectName: string;
  entryA?: Prisma.TransectEntryGetPayload<{ include: { segment: true } }> | null;
  entryB?: Prisma.TransectEntryGetPayload<{ include: { segment: true } }> | null;
};

function serializeConflict(conflict: ConflictWithEntries) {
  return {
    id: conflict.id,
    transectId: conflict.transectId,
    transectName: conflict.transectName,
    speciesName: conflict.speciesName,
    startM: conflict.startM,
    endM: conflict.endM,
    startAt: conflict.startAt.toISOString(),
    endAt: conflict.endAt.toISOString(),
    countA: conflict.countA,
    countB: conflict.countB,
    resolution: conflict.resolution,
    resolvedAt: conflict.resolvedAt?.toISOString() ?? null,
    resolvedNote: conflict.resolvedNote,
    createdAt: conflict.createdAt.toISOString(),
    entryA: conflict.entryA ? serializeEntry(conflict.entryA) : null,
    entryB: conflict.entryB ? serializeEntry(conflict.entryB) : null,
  };
}

export async function listConflicts(
  userId: string,
  transectId: string | undefined,
  status: "PENDING" | "RESOLVED" | "ALL",
) {
  const conflicts = await prisma.transectConflict.findMany({
    where: {
      ownerId: userId,
      ...(transectId ? { transectId } : {}),
      ...(status === "PENDING" ? { resolution: "PENDING" } : {}),
      ...(status === "RESOLVED" ? { NOT: { resolution: "PENDING" } } : {}),
    },
    orderBy: [{ resolution: "asc" }, { startAt: "asc" }],
  });
  const [transects, entries] = await Promise.all([
    prisma.transect.findMany({
      where: { id: { in: [...new Set(conflicts.map((c) => c.transectId))] } },
    }),
    prisma.transectEntry.findMany({
      where: { id: { in: [...new Set(conflicts.flatMap((c) => [c.entryAId, c.entryBId]))] } },
      include: { segment: true },
    }),
  ]);
  const transectNameById = new Map(transects.map((t) => [t.id, t.name]));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  return conflicts.map((c) =>
    serializeConflict({
      ...c,
      transectName: transectNameById.get(c.transectId) ?? "",
      entryA: entryById.get(c.entryAId) ?? null,
      entryB: entryById.get(c.entryBId) ?? null,
    }),
  );
}

export async function resolveConflict(
  userId: string,
  conflictId: string,
  input: ResolveConflictInput,
) {
  const conflict = await prisma.transectConflict.findFirst({ where: { id: conflictId, ownerId: userId } });
  if (!conflict) throw new ApiError(404, "NOT_FOUND", "冲突不存在或已随录入变化消失");

  const resolution = input.resolution as ConflictResolution;
  const updated = await prisma.transectConflict.update({
    where: { id: conflictId },
    data: {
      resolution,
      resolvedAt: new Date(),
      resolvedNote: input.note ?? null,
    },
  });
  const [transect, entryA, entryB] = await Promise.all([
    prisma.transect.findUnique({ where: { id: updated.transectId } }),
    prisma.transectEntry.findUnique({ where: { id: updated.entryAId }, include: { segment: true } }),
    prisma.transectEntry.findUnique({ where: { id: updated.entryBId }, include: { segment: true } }),
  ]);
  return serializeConflict({
    ...updated,
    transectName: transect?.name ?? "",
    entryA,
    entryB,
  });
}

// ============================================================
// 时间线（对齐结果）
// ============================================================

async function loadAlignmentData(userId: string, transectId: string) {
  const [transect, segments, entries, conflicts] = await Promise.all([
    getOwnedTransect(userId, transectId),
    prisma.transectSegment.findMany({ where: { transectId }, orderBy: { orderIndex: "asc" } }),
    prisma.transectEntry.findMany({ where: { transectId }, include: { segment: true } }),
    prisma.transectConflict.findMany({ where: { transectId } }),
  ]);
  return { transect, segments, entries, conflicts };
}

function serializeSlice(slice: TimelineSlice, segmentById: Map<string, TransectSegment>) {
  const segment = slice.segmentId ? segmentById.get(slice.segmentId) : null;
  return {
    key: slice.key,
    speciesName: slice.speciesName,
    segmentId: slice.segmentId,
    segmentName: segment?.name ?? null,
    segmentOrder: segment?.orderIndex ?? null,
    startM: slice.startM,
    endM: slice.endM,
    startAt: new Date(slice.startAt).toISOString(),
    endAt: new Date(slice.endAt).toISOString(),
    shares: slice.shares,
    totalRaw: slice.totalRaw,
    totalResolved: slice.totalResolved,
    conflictIds: slice.conflictIds.filter((id) => !id.startsWith("pending:")),
    pending: slice.pending,
    source: slice.source,
    observer: slice.observer,
    notes: slice.notes,
  };
}

export async function getTimeline(
  userId: string,
  transectId: string,
  query: { speciesName?: string; segmentId?: string; from?: string; to?: string },
) {
  const { transect, segments, entries, conflicts } = await loadAlignmentData(userId, transectId);
  const segmentById = new Map(segments.map((s) => [s.id, s]));

  const fromMs = query.from ? Date.parse(query.from) : null;
  const toMs = query.to ? Date.parse(query.to) : null;

  const filtered = entries.filter((entry) => {
    if (query.speciesName && entry.speciesName !== query.speciesName) return false;
    if (fromMs !== null && entry.endAt.getTime() < fromMs) return false;
    if (toMs !== null && entry.startAt.getTime() > toMs) return false;
    return true;
  });

  const slices = buildTimeline(
    filtered.map(toAlignmentEntry),
    conflicts.map<ResolutionInput>((c) => ({
      id: c.id,
      entryAId: c.entryAId,
      entryBId: c.entryBId,
      resolution: c.resolution as ConflictResolution,
    })),
    segments.map((s) => ({ id: s.id, orderIndex: s.orderIndex, startM: s.startM, endM: s.endM })),
  );

  let visible = slices;
  if (query.segmentId) visible = slices.filter((s) => s.segmentId === query.segmentId);

  const serialized = visible.map((s) => serializeSlice(s, segmentById));
  const includedEntryIds = new Set(visible.flatMap((s) => s.shares.map((share) => share.entryId)));
  const includedEntries = entries
    .filter((e) => includedEntryIds.has(e.id))
    .map(serializeEntry);

  return {
    transect: (await decorateTransects(userId, [transect]))[0],
    segments: segments.map(serializeSegment),
    slices: serialized,
    entries: includedEntries,
    summary: summarizeTimeline(visible),
  };
}

// ============================================================
// 导出
// ============================================================

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 生成可安全放入 Content-Disposition 的文件名参数（ASCII 回退 + RFC 5987 编码）。 */
function contentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

async function buildExportTimeline(userId: string, transectId: string, query: ExportQuery) {
  const data = await getTimeline(userId, transectId, {
    speciesName: query.speciesName,
    from: query.from,
    to: query.to,
  });
  return data;
}

function interpolatePoint(coords: number[][], fraction: number): number[] | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  const segs: { a: number[]; b: number[]; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [a, b] = [coords[i], coords[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len });
    total += len;
  }
  if (total === 0) return coords[0];
  let target = fraction * total;
  for (const { a, b, len } of segs) {
    if (target <= len || len === segs[segs.length - 1].len) {
      const t = len === 0 ? 0 : Math.min(target / len, 1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ...(a.length > 2 || b.length > 2 ? [(a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t] : [])];
    }
    target -= len;
  }
  return coords[coords.length - 1];
}

export async function exportTransect(userId: string, transectId: string, query: ExportQuery) {
  const data = await buildExportTimeline(userId, transectId, query);

  if (query.format === "geojson") {
    const features: Record<string, unknown>[] = data.segments
      .filter((s) => s.geometry && s.geometry.length > 0)
      .map((s) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: s.geometry },
        properties: {
          kind: "segment",
          orderIndex: s.orderIndex,
          name: s.name,
          habitat: s.habitat,
          startM: s.startM,
          endM: s.endM,
        },
      }));

    for (const slice of data.slices) {
      const segment = data.segments.find((s) => s.id === slice.segmentId);
      let coordinates: number[] | null = null;
      if (segment?.geometry && segment.geometry.length > 1) {
        const midM = (slice.startM + slice.endM) / 2;
        const fraction = (midM - segment.startM) / Math.max(segment.endM - segment.startM, EPS);
        coordinates = interpolatePoint(segment.geometry, Math.min(Math.max(fraction, 0), 1));
      }
      features.push({
        type: "Feature",
        geometry: coordinates ? { type: "Point", coordinates } : null,
        properties: {
          kind: "sighting",
          speciesName: slice.speciesName,
          segment: slice.segmentName,
          startAt: slice.startAt,
          endAt: slice.endAt,
          startM: slice.startM,
          endM: slice.endM,
          totalRaw: slice.totalRaw,
          totalResolved: slice.totalResolved,
          pending: slice.pending,
          source: slice.source,
        },
      });
    }

    const body = Buffer.from(
      JSON.stringify(
        {
          type: "FeatureCollection",
          metadata: {
            transectId,
            transectName: data.transect.name,
            exportedAt: new Date().toISOString(),
            count: data.slices.length,
          },
          features,
        },
        null,
        2,
      ),
      "utf8",
    );
    const filename = `transect-${data.transect.name}-${new Date().toISOString().slice(0, 10)}.geojson`;
    return {
      contentType: "application/geo+json; charset=utf-8",
      filename,
      contentDisposition: contentDisposition(filename),
      body,
    };
  }

  const columns = [
    "transect",
    "code",
    "segment",
    "habitat",
    "speciesName",
    "startAt",
    "endAt",
    "startM",
    "endM",
    "totalRaw",
    "totalResolved",
    "pending",
    "conflictIds",
    "source",
    "observer",
    "entryIds",
    "entryCounts",
    "notes",
  ];
  const habitatById = new Map(data.segments.map((s) => [s.id, s.habitat ?? ""]));
  const lines = [columns.join(",")];
  for (const slice of data.slices) {
    lines.push(
      [
        data.transect.name,
        data.transect.code ?? "",
        slice.segmentName ?? "",
        slice.segmentId ? habitatById.get(slice.segmentId) ?? "" : "",
        slice.speciesName,
        slice.startAt,
        slice.endAt,
        slice.startM,
        slice.endM,
        slice.totalRaw,
        slice.totalResolved,
        slice.pending ? "PENDING" : "OK",
        slice.conflictIds.join(" | "),
        slice.source,
        slice.observer ?? "",
        slice.shares.map((s) => s.entryId).join(" | "),
        slice.shares.map((s) => s.count).join(" | "),
        slice.notes ?? "",
      ].map(escapeCsv).join(","),
    );
  }
  const csv = `﻿${lines.join("\r\n")}\r\n`;
  const filename = `transect-${data.transect.name}-${new Date().toISOString().slice(0, 10)}.csv`;
  return {
    contentType: "text/csv; charset=utf-8",
    filename,
    contentDisposition: contentDisposition(filename),
    body: Buffer.from(csv, "utf8"),
  };
}
