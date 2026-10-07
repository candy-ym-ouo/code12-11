import { getOwnedPhenophase, getOwnedSite, getOwnedSpecies } from "../../lib/access";
import { currentYearInTimezone, dayOfYear, parseDateString } from "../../lib/date";
import { computeWeatherDeviation, buildPhenologySeries, describeOffset, median } from "../../lib/phenology";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import type { CompareQuery, OverviewQuery, PhenologyQuery, WeatherQuery } from "./schema";

type CompareRow = {
  id: string;
  observationDate: string;
  title: string | null;
  notes: string | null;
  phenophase: { id: string; name: string; color: string } | null;
  photos: Array<{ thumbKey: string; displayKey: string }>;
};

async function loadOnsets(
  userId: string,
  query: { siteId: string; speciesId: string; phenophaseId?: string },
): Promise<CompareRow[]> {
  const rows = await prisma.observation.findMany({
    where: {
      ownerId: userId,
      siteId: query.siteId,
      speciesId: query.speciesId,
      status: "PUBLISHED",
      ...(query.phenophaseId ? { phenophaseId: query.phenophaseId } : {}),
    },
    select: {
      id: true,
      observationDate: true,
      title: true,
      notes: true,
      phenophase: { select: { id: true, name: true, color: true } },
      photos: { orderBy: { sortOrder: "asc" }, select: { thumbKey: true, displayKey: true } },
    },
    orderBy: [{ observationDate: "asc" }, { createdAt: "asc" }],
  });
  return rows;
}

function groupFirstPerYear(rows: CompareRow[]): Map<number, CompareRow> {
  const map = new Map<number, CompareRow>();
  for (const row of rows) {
    const year = Number(row.observationDate.slice(0, 4));
    if (!map.has(year)) map.set(year, row);
  }
  return map;
}

export async function compare(userId: string, query: CompareQuery) {
  const site = await getOwnedSite(userId, query.siteId);
  const species = await getOwnedSpecies(userId, query.speciesId);
  const phenophase = query.phenophaseId ? await getOwnedPhenophase(userId, query.phenophaseId) : null;

  const rows = await loadOnsets(userId, query);
  const byYear = groupFirstPerYear(rows);
  const years = query.years.length ? query.years : [...byYear.keys()].sort((a, b) => a - b);

  const series = buildPhenologySeries(
    years.map((year) => ({ year, onsetDate: byYear.get(year)?.observationDate ?? null })),
  );

  const items = series.items.map((item) => {
    const row = byYear.get(item.year);
    const cover = row?.photos[0];
    return {
      ...item,
      offsetText: describeOffset(item.offsetVsBaseline ?? item.offsetVsPrevYear),
      observationId: row?.id ?? null,
      observationsInYear: rows.filter((row2) => row2.observationDate.startsWith(String(item.year))).length,
      title: row?.title ?? null,
      notes: row?.notes ?? null,
      phenophase: row?.phenophase ?? (phenophase ? { id: phenophase.id, name: phenophase.name, color: phenophase.color } : null),
      photo: cover
        ? { thumbUrl: storage.publicUrl(cover.thumbKey, "thumb"), displayUrl: storage.publicUrl(cover.displayKey, "display") }
        : null,
      photoCount: row?.photos.length ?? 0,
    };
  });

  return {
    site: { id: site.id, name: site.name },
    species: { id: species.id, commonName: species.commonName, category: species.category },
    phenophase: phenophase ? { id: phenophase.id, name: phenophase.name, color: phenophase.color } : null,
    years: items,
    baseline: series.baseline,
    ...(series.reason ? { reason: series.reason } : {}),
    missingYears: years.filter((year) => !byYear.has(year)),
  };
}

export async function phenology(userId: string, query: PhenologyQuery) {
  const site = await getOwnedSite(userId, query.siteId);
  const species = await getOwnedSpecies(userId, query.speciesId);
  const rows = await loadOnsets(userId, query);
  const byYear = groupFirstPerYear(rows);

  const allYears = [...byYear.keys()].sort((a, b) => a - b);
  const from = query.fromYear ?? allYears[0] ?? currentYearInTimezone();
  const to = query.toYear ?? allYears[allYears.length - 1] ?? currentYearInTimezone();
  const years: number[] = [];
  for (let year = from; year <= to; year += 1) years.push(year);

  const series = buildPhenologySeries(
    years.map((year) => ({ year, onsetDate: byYear.get(year)?.observationDate ?? null })),
  );

  return {
    site: { id: site.id, name: site.name },
    species: { id: species.id, commonName: species.commonName, category: species.category },
    items: series.items.map((item) => ({
      ...item,
      offsetText: describeOffset(item.offsetVsBaseline),
      observationId: byYear.get(item.year)?.id ?? null,
    })),
    baseline: series.baseline,
    ...(series.reason ? { reason: series.reason } : {}),
  };
}

function withinWindow(observationDate: string, monthDay: string, windowDays: number): boolean {
  const parsed = parseDateString(observationDate);
  if (!parsed) return false;
  const targetDoy = dayOfYear(`2001-${monthDay}`);
  const currentDoy = dayOfYear(`2001-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`);
  const direct = Math.abs(currentDoy - targetDoy);
  return Math.min(direct, 365 - direct) <= windowDays;
}

export async function weather(userId: string, query: WeatherQuery) {
  const site = await getOwnedSite(userId, query.siteId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const timezone = user?.timezone ?? "Asia/Shanghai";

  const rows = await prisma.observation.findMany({
    where: {
      ownerId: userId,
      siteId: query.siteId,
      kind: "WEATHER_ANOMALY",
    },
    select: {
      id: true,
      observationDate: true,
      temperatureC: true,
      precipitationMm: true,
      anomalyType: true,
      anomalySeverity: true,
      impactNotes: true,
      notes: true,
    },
    orderBy: { observationDate: "asc" },
  });

  // 未指定年份时，默认使用该地点最近一次天气异常记录所在年份，
  // 避免"今天所在年份没有记录"导致空结果。
  const latestYear = rows.length ? Number(rows[rows.length - 1].observationDate.slice(0, 4)) : null;
  const targetYear = query.year ?? latestYear ?? currentYearInTimezone(timezone);

  const inWindow = rows.filter((row) => withinWindow(row.observationDate, query.monthDay, query.windowDays));
  const history = inWindow
    .filter((row) => Number(row.observationDate.slice(0, 4)) < targetYear)
    .map((row) => ({ year: Number(row.observationDate.slice(0, 4)), temperatureC: row.temperatureC }));

  const current = inWindow.filter((row) => Number(row.observationDate.slice(0, 4)) === targetYear);
  const deviation = computeWeatherDeviation(current[0]?.temperatureC ?? null, history);

  const historyByYear = new Map<number, number[]>();
  for (const row of history) {
    if (row.temperatureC === null) continue;
    const list = historyByYear.get(row.year) ?? [];
    list.push(row.temperatureC);
    historyByYear.set(row.year, list);
  }

  return {
    site: { id: site.id, name: site.name },
    monthDay: query.monthDay,
    windowDays: query.windowDays,
    year: targetYear,
    current: current.map((row) => ({
      id: row.id,
      observationDate: row.observationDate,
      temperatureC: row.temperatureC,
      precipitationMm: row.precipitationMm,
      anomalyType: row.anomalyType,
      anomalySeverity: row.anomalySeverity,
      deviation:
        deviation.baselineTemp !== null && row.temperatureC !== null
          ? Math.round((row.temperatureC - deviation.baselineTemp) * 10) / 10
          : null,
      notes: row.impactNotes ?? row.notes,
    })),
    baseline: {
      temperatureC: deviation.baselineTemp,
      yearsUsed: deviation.yearsUsed,
      insufficientBaseline: deviation.insufficientBaseline,
    },
    history: [...historyByYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, values]) => ({ year, temperatureC: median(values) })),
  };
}

export async function overview(userId: string, query: OverviewQuery) {
  const where = {
    ownerId: userId,
    ...(query.siteId ? { siteId: query.siteId } : {}),
  };

  const [total, published, drafts, speciesGroups, kindGroups, range] = await Promise.all([
    prisma.observation.count({ where }),
    prisma.observation.count({ where: { ...where, status: "PUBLISHED" } }),
    prisma.observation.count({ where: { ...where, status: "DRAFT" } }),
    prisma.observation.groupBy({ by: ["speciesId"], where: { ...where, status: "PUBLISHED" } }),
    prisma.observation.groupBy({ by: ["kind"], where: { ...where, status: "PUBLISHED" }, _count: { _all: true } }),
    prisma.observation.aggregate({
      where: { ...where, status: "PUBLISHED" },
      _min: { observationDate: true },
      _max: { observationDate: true },
    }),
  ]);

  return {
    total,
    published,
    drafts,
    speciesCount: speciesGroups.filter((group) => group.speciesId !== null).length,
    firstObservationDate: range._min.observationDate ?? null,
    lastObservationDate: range._max.observationDate ?? null,
    byKind: kindGroups.map((group) => ({ kind: group.kind, count: group._count._all })),
  };
}
