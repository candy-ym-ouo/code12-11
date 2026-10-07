import { describe, expect, it } from "vitest";
import { buildPhenologySeries, computeWeatherDeviation, describeOffset, median } from "../lib/phenology";

describe("物候偏移算法", () => {
  it("计算逐年偏移，负数表示提前", () => {
    const series = buildPhenologySeries([
      { year: 2023, onsetDate: "2023-03-20" },
      { year: 2024, onsetDate: "2024-03-18" },
      { year: 2025, onsetDate: "2025-03-12" },
    ]);

    const [y2023, y2024, y2025] = series.items;
    expect(y2023.offsetVsPrevYear).toBeNull();
    expect(y2023.offsetVsBaseline).toBeNull();

    expect(y2024.offsetVsPrevYear).toBe(-2);
    expect(y2024.offsetVsBaseline).toBeNull();

    expect(y2025.offsetVsPrevYear).toBe(-6);
    expect(y2025.baselineDayOfYear).toBe(median([79, 77]));
    expect(y2025.offsetVsBaseline).toBe(71 - (median([79, 77]) as number));
    expect(describeOffset(y2025.offsetVsBaseline)).toBe("提前 7 天");
  });

  it("可用年份不足时返回 INSUFFICIENT_HISTORY", () => {
    const series = buildPhenologySeries([{ year: 2025, onsetDate: "2025-03-12" }]);
    expect(series.baseline).toBeNull();
    expect(series.reason).toBe("INSUFFICIENT_HISTORY");
  });

  it("缺失年份不影响偏移计算", () => {
    const series = buildPhenologySeries([
      { year: 2022, onsetDate: "2022-03-22" },
      { year: 2023, onsetDate: null },
      { year: 2024, onsetDate: "2024-03-18" },
      { year: 2025, onsetDate: "2025-03-12" },
    ]);
    expect(series.items[1].dayOfYear).toBeNull();
    expect(series.items[2].offsetVsPrevYear).toBe(77 - 81);
    expect(series.items[3].baselineDayOfYear).toBe(median([81, 77]));
  });

  it("天气偏差在历史年份不足时不下结论", () => {
    const result = computeWeatherDeviation(1.2, [
      { year: 2024, temperatureC: 9.5 },
      { year: 2023, temperatureC: 10.0 },
    ]);
    expect(result.insufficientBaseline).toBe(true);
    expect(result.deviation).toBeNull();
  });

  it("天气偏差使用中位数作为基准", () => {
    const result = computeWeatherDeviation(1.2, [
      { year: 2022, temperatureC: 9.5 },
      { year: 2023, temperatureC: 10.0 },
      { year: 2024, temperatureC: 12.0 },
    ]);
    expect(result.insufficientBaseline).toBe(false);
    expect(result.baselineTemp).toBe(10);
    expect(result.deviation).toBe(-8.8);
  });
});
