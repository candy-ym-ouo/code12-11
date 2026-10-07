import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import type { ExportQuery } from "./schema";

const CSV_COLUMNS = [
  "id",
  "observationDate",
  "observedAt",
  "site",
  "latitude",
  "longitude",
  "kind",
  "status",
  "species",
  "scientificName",
  "phenophase",
  "title",
  "notes",
  "temperatureC",
  "precipitationMm",
  "windLevel",
  "anomalyType",
  "anomalySeverity",
  "tags",
  "photoCount",
  "photoUrls",
  "createdAt",
] as const;

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function loadRows(userId: string, query: ExportQuery) {
  const rows = await prisma.observation.findMany({
    where: {
      ownerId: userId,
      status: query.status,
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.speciesId ? { speciesId: query.speciesId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.from || query.to
        ? {
            observationDate: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    },
    include: {
      site: { select: { name: true, latitude: true, longitude: true } },
      species: { select: { commonName: true, scientificName: true } },
      phenophase: { select: { name: true } },
      photos: { orderBy: { sortOrder: "asc" } },
      tags: { include: { tag: true } },
    },
    orderBy: [{ observationDate: "asc" }, { id: "asc" }],
  });
  return rows;
}

export async function exportObservations(userId: string, query: ExportQuery) {
  const rows = await loadRows(userId, query);

  if (query.format === "json") {
    const payload = rows.map((row) => ({
      id: row.id,
      observationDate: row.observationDate,
      observedAt: row.observedAt,
      site: row.site.name,
      latitude: row.site.latitude,
      longitude: row.site.longitude,
      kind: row.kind,
      status: row.status,
      species: row.species?.commonName ?? null,
      scientificName: row.species?.scientificName ?? null,
      phenophase: row.phenophase?.name ?? null,
      title: row.title,
      notes: row.notes,
      temperatureC: row.temperatureC,
      precipitationMm: row.precipitationMm,
      windLevel: row.windLevel,
      anomalyType: row.anomalyType,
      anomalySeverity: row.anomalySeverity,
      impactNotes: row.impactNotes,
      tags: row.tags.map((item) => item.tag.name),
      photos: row.photos.map((photo) => storage.publicUrl(photo.displayKey, "display")),
      createdAt: row.createdAt,
    }));
    return {
      contentType: "application/json; charset=utf-8",
      filename: `nature-observations-${new Date().toISOString().slice(0, 10)}.json`,
      body: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), count: payload.length, data: payload }, null, 2), "utf8"),
    };
  }

  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.observationDate,
        row.observedAt ? row.observedAt.toISOString() : "",
        row.site.name,
        row.site.latitude,
        row.site.longitude,
        row.kind,
        row.status,
        row.species?.commonName ?? "",
        row.species?.scientificName ?? "",
        row.phenophase?.name ?? "",
        row.title ?? "",
        row.notes ?? "",
        row.temperatureC,
        row.precipitationMm,
        row.windLevel,
        row.anomalyType ?? "",
        row.anomalySeverity ?? "",
        row.tags.map((item) => item.tag.name).join(" | "),
        row.photos.length,
        row.photos.map((photo) => storage.publicUrl(photo.displayKey, "display")).join(" | "),
        row.createdAt.toISOString(),
      ]
        .map(escapeCsv)
        .join(","),
    );
  }

  // BOM 前缀保证 Excel 打开时中文不乱码
  const csv = `\uFEFF${lines.join("\r\n")}\r\n`;
  return {
    contentType: "text/csv; charset=utf-8",
    filename: `nature-observations-${new Date().toISOString().slice(0, 10)}.csv`,
    body: Buffer.from(csv, "utf8"),
  };
}
