import { getOwnedPhenophase, getOwnedSpecies } from "../../lib/access";
import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import type {
  CreatePhenophaseInput,
  CreateSpeciesInput,
  UpdatePhenophaseInput,
  UpdateSpeciesInput,
} from "./schema";

const speciesInclude = {
  phenophases: { orderBy: { orderIndex: "asc" as const } },
  _count: { select: { observations: true } },
};

export async function listSpecies(
  userId: string,
  filters: { category?: string; q?: string; includePreset: boolean },
) {
  const keyword = filters.q?.trim();
  const mine = await prisma.species.findMany({
    where: {
      ownerId: userId,
      archivedAt: null,
      ...(filters.category ? { category: filters.category } : {}),
      ...(keyword
        ? {
            OR: [
              { commonName: { contains: keyword } },
              { scientificName: { contains: keyword } },
              { family: { contains: keyword } },
            ],
          }
        : {}),
    },
    include: speciesInclude,
    orderBy: [{ category: "asc" }, { commonName: "asc" }],
  });

  if (!filters.includePreset) {
    return { mine, presets: [] };
  }

  const presets = await prisma.species.findMany({
    where: {
      isPreset: true,
      ...(filters.category ? { category: filters.category } : {}),
      ...(keyword
        ? {
            OR: [
              { commonName: { contains: keyword } },
              { scientificName: { contains: keyword } },
              { family: { contains: keyword } },
            ],
          }
        : {}),
    },
    include: speciesInclude,
    orderBy: [{ category: "asc" }, { commonName: "asc" }],
  });

  return { mine, presets };
}

export async function getSpecies(userId: string, speciesId: string) {
  const species = await prisma.species.findFirst({
    where: { id: speciesId, OR: [{ ownerId: userId }, { isPreset: true }] },
    include: speciesInclude,
  });
  if (!species) throw new ApiError(404, "NOT_FOUND", "物种不存在");
  return species;
}

export async function createSpecies(userId: string, input: CreateSpeciesInput) {
  const duplicate = await prisma.species.findFirst({
    where: { ownerId: userId, category: input.category, commonName: input.commonName },
  });
  if (duplicate) throw new ApiError(409, "DUPLICATE_RECORD", "你的物种库中已存在同名同类别物种");

  return prisma.species.create({
    data: {
      ownerId: userId,
      category: input.category,
      commonName: input.commonName,
      scientificName: input.scientificName ?? null,
      family: input.family ?? null,
      description: input.description ?? null,
      phenophases: input.phenophases?.length
        ? {
            create: input.phenophases.map((phase, index) => ({
              name: phase.name,
              code: phase.code ?? null,
              color: phase.color,
              isDefault: phase.isDefault,
              orderIndex: index,
            })),
          }
        : undefined,
    },
    include: speciesInclude,
  });
}

export async function importPreset(userId: string, presetId: string) {
  const preset = await prisma.species.findFirst({
    where: { id: presetId, isPreset: true },
    include: { phenophases: { orderBy: { orderIndex: "asc" } } },
  });
  if (!preset) throw new ApiError(404, "NOT_FOUND", "预置物种不存在");

  const duplicate = await prisma.species.findFirst({
    where: { ownerId: userId, category: preset.category, commonName: preset.commonName },
  });
  if (duplicate) {
    throw new ApiError(409, "RESOURCE_IN_USE", "该预置物种已在你的物种库中", { speciesId: duplicate.id });
  }

  return prisma.species.create({
    data: {
      ownerId: userId,
      category: preset.category,
      commonName: preset.commonName,
      scientificName: preset.scientificName,
      family: preset.family,
      description: preset.description,
      phenophases: {
        create: preset.phenophases.map((phase, index) => ({
          name: phase.name,
          code: phase.code,
          color: phase.color,
          isDefault: phase.isDefault,
          orderIndex: index,
        })),
      },
    },
    include: speciesInclude,
  });
}

export async function updateSpecies(userId: string, speciesId: string, input: UpdateSpeciesInput) {
  await getOwnedSpecies(userId, speciesId);
  return prisma.species.update({
    where: { id: speciesId },
    data: {
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.commonName !== undefined ? { commonName: input.commonName } : {}),
      ...(input.scientificName !== undefined ? { scientificName: input.scientificName } : {}),
      ...(input.family !== undefined ? { family: input.family } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
    include: speciesInclude,
  });
}

export async function setSpeciesArchived(userId: string, speciesId: string, archived: boolean) {
  await getOwnedSpecies(userId, speciesId);
  return prisma.species.update({
    where: { id: speciesId },
    data: { archivedAt: archived ? new Date() : null },
    include: speciesInclude,
  });
}

export async function deleteSpecies(userId: string, speciesId: string): Promise<void> {
  await getOwnedSpecies(userId, speciesId);
  const count = await prisma.observation.count({ where: { speciesId } });
  if (count > 0) {
    throw new ApiError(409, "RESOURCE_IN_USE", `该物种已被 ${count} 条观测引用，请使用归档`, { count });
  }
  await prisma.species.delete({ where: { id: speciesId } });
}

export async function listPhenophases(userId: string, speciesId: string) {
  const species = await getOwnedSpecies(userId, speciesId);
  return prisma.phenophase.findMany({ where: { speciesId: species.id }, orderBy: { orderIndex: "asc" } });
}

export async function createPhenophase(userId: string, speciesId: string, input: CreatePhenophaseInput) {
  await getOwnedSpecies(userId, speciesId);
  const duplicate = await prisma.phenophase.findFirst({ where: { speciesId, name: input.name } });
  if (duplicate) throw new ApiError(409, "DUPLICATE_RECORD", "该物种下已存在同名物候阶段");

  const count = await prisma.phenophase.count({ where: { speciesId } });
  return prisma.phenophase.create({
    data: {
      speciesId,
      name: input.name,
      code: input.code ?? null,
      color: input.color,
      isDefault: input.isDefault,
      orderIndex: input.orderIndex ?? count,
    },
  });
}

export async function updatePhenophase(userId: string, phenophaseId: string, input: UpdatePhenophaseInput) {
  const phase = await getOwnedPhenophase(userId, phenophaseId);
  if (input.name && input.name !== phase.name) {
    const duplicate = await prisma.phenophase.findFirst({
      where: { speciesId: phase.speciesId, name: input.name, id: { not: phenophaseId } },
    });
    if (duplicate) throw new ApiError(409, "DUPLICATE_RECORD", "该物种下已存在同名物候阶段");
  }
  return prisma.phenophase.update({
    where: { id: phenophaseId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
    },
  });
}

export async function deletePhenophase(userId: string, phenophaseId: string): Promise<void> {
  await getOwnedPhenophase(userId, phenophaseId);
  const count = await prisma.observation.count({ where: { phenophaseId } });
  if (count > 0) {
    throw new ApiError(409, "RESOURCE_IN_USE", `该物候阶段已被 ${count} 条观测引用`, { count });
  }
  await prisma.phenophase.delete({ where: { id: phenophaseId } });
}
