import type { Observation, Phenophase, Site, Species, Tag } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./http";

function notFound(resource: string): ApiError {
  return new ApiError(404, "NOT_FOUND", `${resource}不存在`);
}

export async function getOwnedSite(userId: string, siteId: string): Promise<Site> {
  const site = await prisma.site.findFirst({ where: { id: siteId, ownerId: userId } });
  if (!site) throw notFound("地点");
  return site;
}

export async function getOwnedSpecies(userId: string, speciesId: string): Promise<Species> {
  const species = await prisma.species.findFirst({ where: { id: speciesId, ownerId: userId } });
  if (!species) throw notFound("物种");
  return species;
}

export async function getOwnedPhenophase(userId: string, phenophaseId: string): Promise<Phenophase> {
  const phase = await prisma.phenophase.findFirst({
    where: { id: phenophaseId, species: { ownerId: userId } },
  });
  if (!phase) throw notFound("物候阶段");
  return phase;
}

export async function getOwnedObservation(userId: string, observationId: string): Promise<Observation> {
  const observation = await prisma.observation.findFirst({ where: { id: observationId, ownerId: userId } });
  if (!observation) throw notFound("观测记录");
  return observation;
}

export async function getOwnedTag(userId: string, tagId: string): Promise<Tag> {
  const tag = await prisma.tag.findFirst({ where: { id: tagId, ownerId: userId } });
  if (!tag) throw notFound("标签");
  return tag;
}
