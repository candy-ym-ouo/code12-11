import { dayOfYear } from "./date";

export type OnsetPoint = { year: number; onsetDate: string | null };

export type PhenologyItem = {
  year: number;
  onsetDate: string | null;
  dayOfYear: number | null;
  offsetVsPrevYear: number | null;
  offsetVsBaseline: number | null;
  baselineDayOfYear: number | null;
};

export type Baseline = { method: "median"; yearsUsed: number[]; dayOfYear: number } | null;

export type PhenologySeries = {
  items: PhenologyItem[];
  baseline: Baseline;
  reason?: "INSUFFICIENT_HISTORY";
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

/**
 * 计算逐年首现日序列与偏移。
 * - offsetVsPrevYear：与"最早的上一个可用年份"比较（该年缺失时向前追溯），负数表示提前。
 * - offsetVsBaseline：与该年之前所有可用年份的中位数比较，要求至少 baselineMinYears 个历史年份。
 */
export function buildPhenologySeries(
  points: OnsetPoint[],
  options: { baselineMinYears?: number } = {},
): PhenologySeries {
  const baselineMinYears = options.baselineMinYears ?? 2;
  const sorted = [...points].sort((a, b) => a.year - b.year);
  const items: PhenologyItem[] = [];

  for (const point of sorted) {
    const doy = point.onsetDate ? dayOfYear(point.onsetDate) : null;
    const previous = [...items].reverse().find((item) => item.dayOfYear !== null) ?? null;
    const history = items.filter((item) => item.dayOfYear !== null).map((item) => item.dayOfYear as number);
    const baselineValue = history.length >= baselineMinYears ? median(history) : null;

    items.push({
      year: point.year,
      onsetDate: point.onsetDate,
      dayOfYear: doy,
      offsetVsPrevYear: doy !== null && previous?.dayOfYear != null ? doy - previous.dayOfYear : null,
      offsetVsBaseline: doy !== null && baselineValue !== null ? doy - baselineValue : null,
      baselineDayOfYear: baselineValue,
    });
  }

  const lastWithBaseline = [...items].reverse().find((item) => item.baselineDayOfYear !== null);
  const baseline: Baseline = lastWithBaseline
    ? {
        method: "median",
        yearsUsed: items
          .filter((item) => item.dayOfYear !== null && item.year < lastWithBaseline.year)
          .map((item) => item.year),
        dayOfYear: lastWithBaseline.baselineDayOfYear as number,
      }
    : null;

  return baseline ? { items, baseline } : { items, baseline: null, reason: "INSUFFICIENT_HISTORY" };
}

export type WeatherHistoryPoint = { year: number; temperatureC: number | null };

export type WeatherDeviation = {
  baselineTemp: number | null;
  deviation: number | null;
  yearsUsed: number[];
  insufficientBaseline: boolean;
};

/** 天气同期偏差：历史样本年份少于 3 年时不下结论。 */
export function computeWeatherDeviation(
  currentTemperature: number | null,
  history: WeatherHistoryPoint[],
  minYears = 3,
): WeatherDeviation {
  const usable = history.filter(
    (point): point is { year: number; temperatureC: number } => point.temperatureC !== null,
  );
  const yearsUsed = [...new Set(usable.map((point) => point.year))].sort((a, b) => a - b);
  if (yearsUsed.length < minYears) {
    return { baselineTemp: null, deviation: null, yearsUsed, insufficientBaseline: true };
  }
  const baselineTemp = median(usable.map((point) => point.temperatureC));
  const deviation =
    baselineTemp !== null && currentTemperature !== null
      ? Math.round((currentTemperature - baselineTemp) * 10) / 10
      : null;
  return { baselineTemp, deviation, yearsUsed, insufficientBaseline: false };
}

/** 前端文案：提前/推迟/持平。 */
export function describeOffset(offset: number | null): string {
  if (offset === null) return "暂无对比";
  if (offset === 0) return "与基准持平";
  return offset < 0 ? `提前 ${Math.abs(offset)} 天` : `推迟 ${offset} 天`;
}
