import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useObservationStore } from "@/stores/observation";
import type { Observation } from "@/types/models";

function makeObservation(id: string, date: string): Observation {
  return {
    id,
    kind: "PLANT_PHENOLOGY",
    status: "PUBLISHED",
    observationDate: date,
    observedAt: null,
    title: null,
    notes: null,
    temperatureC: null,
    precipitationMm: null,
    windLevel: null,
    humidityPct: null,
    anomalyType: null,
    anomalySeverity: null,
    impactNotes: null,
    source: "MANUAL",
    site: { id: "site", name: "测试点", latitude: null, longitude: null },
    species: null,
    phenophase: null,
    photos: [],
    tags: [],
    createdAt: "2025-03-12T00:00:00.000Z",
    updatedAt: "2025-03-12T00:00:00.000Z",
  };
}

describe("observation store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("按年份与月份分组", () => {
    const store = useObservationStore();
    store.items = [
      makeObservation("a", "2025-03-12"),
      makeObservation("b", "2025-03-18"),
      makeObservation("c", "2024-04-02"),
    ];

    expect(store.groups).toHaveLength(2);
    expect(store.groups[0].year).toBe("2025");
    expect(store.groups[0].months[0].items).toHaveLength(2);
    expect(store.groups[1].year).toBe("2024");
  });

  it("将年份筛选转换为日期区间参数", () => {
    const store = useObservationStore();
    store.filters.year = 2025;
    store.filters.kind = "BIRD_SOUND";

    const query = store.buildQuery(null);
    expect(query.from).toBe("2025-01-01");
    expect(query.to).toBe("2025-12-31");
    expect(query.kind).toBe("BIRD_SOUND");
    expect(query.status).toBe("PUBLISHED");
  });

  it("记录当前生效的筛选条件数量", () => {
    const store = useObservationStore();
    expect(store.activeFilterCount).toBe(0);
    store.filters.siteId = "site-1";
    store.filters.hasPhotos = true;
    expect(store.activeFilterCount).toBe(2);
    store.resetFilters();
    expect(store.activeFilterCount).toBe(0);
  });
});
