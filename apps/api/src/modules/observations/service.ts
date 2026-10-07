import type { Prisma } from "@prisma/client";
import { getOwnedObservation, getOwnedPhenophase, getOwnedSite, getOwnedSpecies } from "../../lib/access";
import { ApiError, decodeCursor, encodeCursor } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import type {
  BulkObservationInput,
  CreateObservationInput,
  ListObservationsQuery,
  UpdateObservationInput,
} from "./schema";

const KIND_CATEGORY: Record<string, string | null> = {
  PLANT_PHENOLOGY: "PLANT",
  INSECT_SIGHTING: "INSECT",
  BIRD_SOUND: "BIRD",
  WEATHER_ANOMALY: null,
};

export const observationInclude = {
  site: { select: { id: true, name: true, latitude: true, longitude: true } },
  species: { select: { id: true, commonName: true, category: true, scientificName: true } },
  phenophase: { select: { id: true, name: true, color: true } },
  photos: { orderBy: { sortOrder: "asc" as const } },
  tags: { include: { tag: true } },
} satisfies Prisma.ObservationInclude;

export type ObservationWithRelations = Prisma.ObservationGetPayload<{ include: typeof observationInclude }>;

export function serializeObservation(observation: ObservationWithRelations) {
  return {
    id: observation.id,
    kind: observation.kind,
    status: observation.status,
    observationDate: observation.observationDate,
    observedAt: observation.observedAt,
    title: observation.title,
    notes: observation.notes,
    temperatureC: observation.temperatureC,
    precipitationMm: observation.precipitationMm,
    windLevel: observation.windLevel,
    humidityPct: observation.humidityPct,
    anomalyType: observation.anomalyType,
    anomalySeverity: observation.anomalySeverity,
    impactNotes: observation.impactNotes,
    source: observation.source,
    site: observation.site,
    species: observation.species,
    phenophase: observation.phenophase,
    photos: observation.photos.map((photo) => ({
      id: photo.id,
      thumbUrl: storage.publicUrl(photo.thumbKey, "thumb"),
      displayUrl: storage.publicUrl(photo.displayKey, "display"),
      originalUrl: storage.publicUrl(photo.storageKey, "original"),
      width: photo.width,
      height: photo.height,
      bytes: photo.bytes,
      takenAt: photo.takenAt,
      sortOrder: photo.sortOrder,
    })),
    tags: observation.tags.map((item) => ({
      id: item.tag.id,
      name: item.tag.name,
      color: item.tag.color,
    })),
    createdAt: observation.createdAt,
    updatedAt: observation.updatedAt,
  };
}

function validationError(path: string, message: string): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", [{ path, message, code: "custom" }]);
}

async function assertRelations(
  userId: string,
  input: {
    siteId: string;
    speciesId?: string | null;
    phenophaseId?: string | null;
    kind: string;
    anomalyType?: string | null;
  },
): Promise<void> {
  await getOwnedSite(userId, input.siteId);

  if (input.speciesId) {
    const species = await getOwnedSpecies(userId, input.speciesId);
    const expected = KIND_CATEGORY[input.kind];
    if (expected && species.category !== expected) {
      throw validationError("speciesId", `该观测类型需要 ${expected} 类物种，当前物种类别为 ${species.category}`);
    }
  }

  if (input.phenophaseId) {
    if (!input.speciesId) throw validationError("phenophaseId", "指定物候阶段时必须同时指定物种");
    const phase = await getOwnedPhenophase(userId, input.phenophaseId);
    if (phase.speciesId !== input.speciesId) throw validationError("phenophaseId", "物候阶段不属于所选物种");
  }

  if (input.kind === "WEATHER_ANOMALY" && !input.anomalyType) {
    throw validationError("anomalyType", "天气异常记录必须选择异常类型");
  }
}

async function assertTagsOwned(userId: string, tagIds: string[] | undefined): Promise<string[]> {
  if (!tagIds?.length) return [];
  const unique = [...new Set(tagIds)];
  const tags = await prisma.tag.findMany({ where: { id: { in: unique }, ownerId: userId } });
  if (tags.length !== unique.length) throw validationError("tagIds", "包含不存在或不属于你的标签");
  return unique;
}

async function findDuplicate(input: {
  ownerId: string;
  siteId: string;
  speciesId?: string | null;
  phenophaseId?: string | null;
  kind: string;
  observationDate: string;
}) {
  return prisma.observation.findFirst({
    where: {
      ownerId: input.ownerId,
      siteId: input.siteId,
      speciesId: input.speciesId ?? null,
      phenophaseId: input.phenophaseId ?? null,
      kind: input.kind,
      observationDate: input.observationDate,
      status: "PUBLISHED",
    },
    select: { id: true, title: true, observationDate: true },
  });
}

export async function createObservation(userId: string, input: CreateObservationInput) {
  await assertRelations(userId, input);
  const tagIds = await assertTagsOwned(userId, input.tagIds);

  if (input.status === "PUBLISHED" && !input.allowDuplicate) {
    const duplicate = await findDuplicate({ ownerId: userId, ...input });
    if (duplicate) {
      throw new ApiError(409, "DUPLICATE_OBSERVATION", "该地点当天已有同一物候阶段的记录", {
        existingObservationId: duplicate.id,
        existingTitle: duplicate.title,
      });
    }
  }

  const observation = await prisma.observation.create({
    data: {
      ownerId: userId,
      siteId: input.siteId,
      speciesId: input.speciesId ?? null,
      phenophaseId: input.phenophaseId ?? null,
      kind: input.kind,
      status: input.status,
      observationDate: input.observationDate,
      observedAt: input.observedAt ?? null,
      title: input.title ?? null,
      notes: input.notes ?? null,
      temperatureC: input.temperatureC ?? null,
      precipitationMm: input.precipitationMm ?? null,
      windLevel: input.windLevel ?? null,
      humidityPct: input.humidityPct ?? null,
      anomalyType: input.anomalyType ?? null,
      anomalySeverity: input.anomalySeverity ?? null,
      impactNotes: input.impactNotes ?? null,
      tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
    },
    include: observationInclude,
  });

  return serializeObservation(observation);
}

export async function listObservations(userId: string, query: ListObservationsQuery) {
  const tagIds = query.tagIds
    ? query.tagIds
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const baseWhere: Prisma.ObservationWhereInput = {
    ownerId: userId,
    ...(query.status === "ALL" ? {} : { status: query.status }),
    ...(query.siteId ? { siteId: query.siteId } : {}),
    ...(query.speciesId ? { speciesId: query.speciesId } : {}),
    ...(query.phenophaseId ? { phenophaseId: query.phenophaseId } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.from || query.to || query.year
      ? {
          observationDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
            ...(query.year ? { gte: `${query.year}-01-01`, lte: `${query.year}-12-31` } : {}),
          },
        }
      : {}),
    ...(query.hasPhotos ? { photos: { some: {} } } : {}),
    ...(tagIds.length ? { tags: { some: { tagId: { in: tagIds } } } } : {}),
    ...(query.keyword
      ? {
          OR: [
            { title: { contains: query.keyword } },
            { notes: { contains: query.keyword } },
            { impactNotes: { contains: query.keyword } },
          ],
        }
      : {}),
  };

  const desc = query.sort === "date_desc";
  let where: Prisma.ObservationWhereInput = baseWhere;

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    if (!cursor) throw validationError("cursor", "分页游标不合法");
    where = {
      AND: [
        baseWhere,
        {
          OR: [
            { observationDate: desc ? { lt: cursor.observationDate } : { gt: cursor.observationDate } },
            { observationDate: cursor.observationDate, id: desc ? { lt: cursor.id } : { gt: cursor.id } },
          ],
        },
      ],
    };
  }

  const rows = await prisma.observation.findMany({
    where,
    include: observationInclude,
    orderBy: [{ observationDate: desc ? "desc" : "asc" }, { id: desc ? "desc" : "asc" }],
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
  const last = pageRows[pageRows.length - 1];

  let emptyReason: "NO_DATA" | "FILTERED_OUT" | undefined;
  if (!pageRows.length) {
    const total = await prisma.observation.count({ where: { ownerId: userId, status: "PUBLISHED" } });
    emptyReason = total === 0 ? "NO_DATA" : "FILTERED_OUT";
  }

  return {
    items: pageRows.map(serializeObservation),
    meta: {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ observationDate: last.observationDate, id: last.id }) : null,
      ...(emptyReason ? { emptyReason } : {}),
    },
  };
}

export async function getObservation(userId: string, observationId: string) {
  await getOwnedObservation(userId, observationId);
  const observation = await prisma.observation.findUniqueOrThrow({
    where: { id: observationId },
    include: observationInclude,
  });
  return serializeObservation(observation);
}

export async function updateObservation(
  userId: string,
  observationId: string,
  input: UpdateObservationInput,
) {
  const existing = await getOwnedObservation(userId, observationId);

  if (input.tagIds) await assertTagsOwned(userId, input.tagIds);

  const merged = {
    siteId: input.siteId ?? existing.siteId,
    speciesId: input.speciesId === undefined ? existing.speciesId : input.speciesId,
    phenophaseId: input.phenophaseId === undefined ? existing.phenophaseId : input.phenophaseId,
    kind: input.kind ?? existing.kind,
    anomalyType: input.anomalyType === undefined ? existing.anomalyType : input.anomalyType,
  };
  await assertRelations(userId, merged);

  const observation = await prisma.$transaction(async (tx) => {
    if (input.tagIds) {
      await tx.observationTag.deleteMany({ where: { observationId } });
      if (input.tagIds.length) {
        await tx.observationTag.createMany({
          data: input.tagIds.map((tagId) => ({ observationId, tagId })),
        });
      }
    }

    return tx.observation.update({
      where: { id: observationId },
      data: {
        ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
        ...(input.speciesId !== undefined ? { speciesId: input.speciesId } : {}),
        ...(input.phenophaseId !== undefined ? { phenophaseId: input.phenophaseId } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.observationDate !== undefined ? { observationDate: input.observationDate } : {}),
        ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.temperatureC !== undefined ? { temperatureC: input.temperatureC } : {}),
        ...(input.precipitationMm !== undefined ? { precipitationMm: input.precipitationMm } : {}),
        ...(input.windLevel !== undefined ? { windLevel: input.windLevel } : {}),
        ...(input.humidityPct !== undefined ? { humidityPct: input.humidityPct } : {}),
        ...(input.anomalyType !== undefined ? { anomalyType: input.anomalyType } : {}),
        ...(input.anomalySeverity !== undefined ? { anomalySeverity: input.anomalySeverity } : {}),
        ...(input.impactNotes !== undefined ? { impactNotes: input.impactNotes } : {}),
      },
      include: observationInclude,
    });
  });

  return serializeObservation(observation);
}

export async function publishObservation(userId: string, observationId: string) {
  await getOwnedObservation(userId, observationId);
  const observation = await prisma.observation.update({
    where: { id: observationId },
    data: { status: "PUBLISHED" },
    include: observationInclude,
  });
  return serializeObservation(observation);
}

export async function deleteObservation(userId: string, observationId: string): Promise<void> {
  await getOwnedObservation(userId, observationId);
  const photos = await prisma.observationPhoto.findMany({ where: { observationId } });
  await prisma.observation.delete({ where: { id: observationId } });

  for (const photo of photos) {
    for (const [key, variant] of [
      [photo.thumbKey, "thumb"],
      [photo.displayKey, "display"],
      [photo.storageKey, "original"],
    ] as const) {
      await storage.remove(key, variant).catch(() => undefined);
    }
  }
}

export async function bulkObservations(userId: string, input: BulkObservationInput) {
  const owned = await prisma.observation.findMany({
    where: { id: { in: input.ids }, ownerId: userId },
    select: { id: true },
  });
  const ownedIds = owned.map((item) => item.id);
  if (ownedIds.length !== input.ids.length) {
    throw new ApiError(404, "NOT_FOUND", "部分观测记录不存在或不属于你");
  }

  if (input.action === "delete") {
    for (const id of ownedIds) await deleteObservation(userId, id);
    return { affected: ownedIds.length };
  }

  const tagIds = await assertTagsOwned(userId, input.tagIds);
  if (!tagIds.length) throw validationError("tagIds", "该操作需要提供标签");

  if (input.action === "addTags") {
    const existing = await prisma.observationTag.findMany({
      where: { observationId: { in: ownedIds }, tagId: { in: tagIds } },
      select: { observationId: true, tagId: true },
    });
    const existingKeys = new Set(existing.map((item) => `${item.observationId}:${item.tagId}`));
    const data = ownedIds
      .flatMap((observationId) => tagIds.map((tagId) => ({ observationId, tagId })))
      .filter((item) => !existingKeys.has(`${item.observationId}:${item.tagId}`));
    if (data.length) await prisma.observationTag.createMany({ data });
  } else {
    await prisma.observationTag.deleteMany({
      where: { observationId: { in: ownedIds }, tagId: { in: tagIds } },
    });
  }
  return { affected: ownedIds.length };
}
