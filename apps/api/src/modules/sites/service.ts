import crypto from "node:crypto";
import type { Site } from "@prisma/client";
import { env } from "../../config/env";
import { getOwnedSite } from "../../lib/access";
import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import type { CreateShareInput, CreateSiteInput, UpdateSiteInput } from "./schema";

export type SiteSummary = Site & {
  observationCount: number;
  speciesCount: number;
  lastObservedAt: string | null;
};

async function decorateSites(userId: string, sites: Site[]): Promise<SiteSummary[]> {
  if (sites.length === 0) return [];
  const siteIds = sites.map((site) => site.id);

  const grouped = await prisma.observation.groupBy({
    by: ["siteId", "speciesId"],
    where: { ownerId: userId, siteId: { in: siteIds }, status: "PUBLISHED" },
    _count: { _all: true },
    _max: { observationDate: true },
  });

  const stats = new Map<string, { observationCount: number; species: Set<string>; lastObservedAt: string | null }>();
  for (const row of grouped) {
    const entry = stats.get(row.siteId) ?? { observationCount: 0, species: new Set<string>(), lastObservedAt: null };
    entry.observationCount += row._count._all;
    if (row.speciesId) entry.species.add(row.speciesId);
    const last = row._max.observationDate;
    if (last && (!entry.lastObservedAt || last > entry.lastObservedAt)) entry.lastObservedAt = last;
    stats.set(row.siteId, entry);
  }

  return sites.map((site) => {
    const entry = stats.get(site.id);
    return {
      ...site,
      observationCount: entry?.observationCount ?? 0,
      speciesCount: entry?.species.size ?? 0,
      lastObservedAt: entry?.lastObservedAt ?? null,
    };
  });
}

export async function listSites(userId: string, includeArchived: boolean): Promise<SiteSummary[]> {
  const sites = await prisma.site.findMany({
    where: { ownerId: userId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: "asc" }, { createdAt: "asc" }],
  });
  return decorateSites(userId, sites);
}

export async function createSite(userId: string, input: CreateSiteInput): Promise<SiteSummary> {
  const existing = await prisma.site.findFirst({
    where: { ownerId: userId, name: input.name },
  });
  if (existing) throw new ApiError(409, "DUPLICATE_RECORD", "已存在同名地点");

  const site = await prisma.site.create({
    data: {
      ownerId: userId,
      name: input.name,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      elevationM: input.elevationM ?? null,
      habitat: input.habitat ?? null,
      description: input.description ?? null,
    },
  });
  return (await decorateSites(userId, [site]))[0];
}

export async function getSite(userId: string, siteId: string): Promise<SiteSummary> {
  const site = await getOwnedSite(userId, siteId);
  return (await decorateSites(userId, [site]))[0];
}

export async function updateSite(userId: string, siteId: string, input: UpdateSiteInput): Promise<SiteSummary> {
  await getOwnedSite(userId, siteId);

  if (input.name) {
    const conflict = await prisma.site.findFirst({
      where: { ownerId: userId, name: input.name, id: { not: siteId } },
    });
    if (conflict) throw new ApiError(409, "DUPLICATE_RECORD", "已存在同名地点");
  }

  const updated = await prisma.site.update({
    where: { id: siteId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.elevationM !== undefined ? { elevationM: input.elevationM } : {}),
      ...(input.habitat !== undefined ? { habitat: input.habitat } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return (await decorateSites(userId, [updated]))[0];
}

export async function setArchived(userId: string, siteId: string, archived: boolean): Promise<SiteSummary> {
  await getOwnedSite(userId, siteId);
  const site = await prisma.site.update({
    where: { id: siteId },
    data: { archivedAt: archived ? new Date() : null },
  });
  return (await decorateSites(userId, [site]))[0];
}

export async function deleteSite(userId: string, siteId: string): Promise<void> {
  await getOwnedSite(userId, siteId);
  const count = await prisma.observation.count({ where: { siteId } });
  if (count > 0) {
    throw new ApiError(409, "RESOURCE_IN_USE", `该地点下还有 ${count} 条观测记录，请先归档而不是删除`, { count });
  }
  await prisma.site.delete({ where: { id: siteId } });
}

export async function createShareLink(userId: string, siteId: string, input: CreateShareInput) {
  await getOwnedSite(userId, siteId);
  const token = crypto.randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  const link = await prisma.shareLink.create({
    data: { token, siteId, ownerId: userId, scope: input.scope, expiresAt },
  });
  return {
    id: link.id,
    token: link.token,
    scope: link.scope,
    expiresAt: link.expiresAt,
    viewCount: link.viewCount,
    url: `${env.APP_ORIGIN.replace(/\/$/, "")}/share/${link.token}`,
  };
}

export async function listShareLinks(userId: string, siteId: string) {
  await getOwnedSite(userId, siteId);
  const links = await prisma.shareLink.findMany({
    where: { siteId, ownerId: userId },
    orderBy: { createdAt: "desc" },
  });
  return links.map((link) => ({
    id: link.id,
    token: link.token,
    scope: link.scope,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    viewCount: link.viewCount,
    url: `${env.APP_ORIGIN.replace(/\/$/, "")}/share/${link.token}`,
  }));
}

export async function revokeShareLink(userId: string, linkId: string): Promise<void> {
  const link = await prisma.shareLink.findFirst({ where: { id: linkId, ownerId: userId } });
  if (!link) throw new ApiError(404, "NOT_FOUND", "分享链接不存在");
  await prisma.shareLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });
}
