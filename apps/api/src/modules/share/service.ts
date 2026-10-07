import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { observationInclude, serializeObservation } from "../observations/service";

export async function getSharedView(token: string) {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { site: true, owner: { select: { displayName: true } } },
  });

  if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }

  const observations = await prisma.observation.findMany({
    where: { siteId: link.siteId, ownerId: link.ownerId, status: "PUBLISHED" },
    include: observationInclude,
    orderBy: [{ observationDate: "desc" }, { id: "desc" }],
    take: 500,
  });

  await prisma.shareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 } } });

  return {
    site: {
      id: link.site.id,
      name: link.site.name,
      latitude: link.site.latitude,
      longitude: link.site.longitude,
      habitat: link.site.habitat,
      description: link.site.description,
    },
    owner: { displayName: link.owner.displayName },
    scope: link.scope,
    expiresAt: link.expiresAt,
    observations: observations.map(serializeObservation),
  };
}
