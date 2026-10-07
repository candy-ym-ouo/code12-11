import { describe, expect, it } from "vitest";
import type { Observation, Route, Segment } from "../src/types.js";
import {
  buildAtomicIntervals,
  intervalsOverlap,
  observationExtent,
  overlapLength,
  overlapWithOthers,
} from "../src/alignment.js";

const route: Route = {
  id: "R1",
  name: "r",
  createdAt: "2026-10-07T00:00:00Z",
  waypoints: [
    { id: "A", chainage: 0 },
    { id: "B", chainage: 2000 },
  ],
};

function seg(id: string, fromM: number, toM: number): Segment {
  return {
    id,
    routeId: "R1",
    label: id,
    fromM,
    toM,
    batchId: "B1",
    retroactive: false,
  };
}

describe("区间运算", () => {
  it("重叠长度正确", () => {
    expect(overlapLength(0, 100, 50, 150)).toBe(50);
    expect(overlapLength(0, 100, 100, 200)).toBe(0);
    expect(overlapLength(0, 100, 200, 300)).toBe(0);
    // 端点接触不算重叠；真正有重叠长度才算
    expect(intervalsOverlap(0, 100, 100, 200)).toBe(false);
    expect(intervalsOverlap(0, 100, 99, 200)).toBe(true);
  });
});

describe("buildAtomicIntervals / 原子分段", () => {
  it("无重叠：分段即原子分段", () => {
    const ivs = buildAtomicIntervals([seg("S1", 0, 500), seg("S2", 500, 1000)]);
    expect(ivs.map((i) => [i.fromM, i.toM])).toEqual([
      [0, 500],
      [500, 1000],
    ]);
    expect(ivs[0]!.segmentIds).toEqual(["S1"]);
    expect(ivs[1]!.segmentIds).toEqual(["S2"]);
  });

  it("部分重叠：端点排序切分，重叠区命中两个分段", () => {
    const ivs = buildAtomicIntervals([seg("S1", 0, 800), seg("S2", 600, 1000)]);
    expect(ivs.map((i) => [i.fromM, i.toM])).toEqual([
      [0, 600],
      [600, 800],
      [800, 1000],
    ]);
    expect(ivs[1]!.segmentIds.sort()).toEqual(["S1", "S2"]);
  });

  it("三重分段（含完全包含）切成 4 个原子分段", () => {
    const ivs = buildAtomicIntervals([
      seg("S1", 0, 800),
      seg("S2", 800, 1600),
      seg("S3", 600, 1000),
    ]);
    expect(ivs.map((i) => [i.fromM, i.toM])).toEqual([
      [0, 600],
      [600, 800],
      [800, 1000],
      [1000, 1600],
    ]);
    expect(ivs[1]!.segmentIds).toEqual(["S1", "S3"]);
    expect(ivs[2]!.segmentIds).toEqual(["S2", "S3"]);
    expect(overlapWithOthers(seg("S3", 600, 1000), [seg("S1", 0, 800), seg("S2", 800, 1600), seg("S3", 600, 1000)])).toBeCloseTo(400);
  });

  it("空分段集合", () => {
    expect(buildAtomicIntervals([])).toEqual([]);
  });
});

describe("observationExtent / 观测落点", () => {
  const segments = [seg("S1", 0, 800), seg("S2", 600, 1000)];
  const intervals = buildAtomicIntervals(segments);

  function obs(partial: Partial<Observation>): Observation {
    return {
      id: "O1",
      routeId: "R1",
      observedAt: "2026-10-07T07:00:00+08:00",
      enteredAt: "2026-10-07T07:00:00+08:00",
      batchId: "B1",
      retroactive: false,
      speciesCode: "X",
      speciesName: "x",
      count: 1,
      ...partial,
    };
  }

  it("桩号优先：重叠区的点命中两个分段", () => {
    const e = observationExtent(obs({ atM: 700, segmentId: "S1" }), route, segments, intervals);
    expect(e.locatedBy).toBe("atM");
    expect(e.atomicIndexes).toEqual([1]);
    expect(e.segmentIds.sort()).toEqual(["S1", "S2"]);
  });

  it("坐标投影优先于所填分段（分段只做审计）", () => {
    const geoRoute: Route = {
      id: "R1",
      name: "r",
      createdAt: "",
      waypoints: [
        { id: "WP1", lng: 120, lat: 30 },
        { id: "WP2", lng: 120.02, lat: 30 },
      ],
    };
    const e = observationExtent(
      obs({ lng: 120.005, lat: 30, segmentId: "S1" }),
      geoRoute,
      segments,
      intervals,
    );
    expect(e.locatedBy).toBe("coordinates");
    expect(e.representativeM).toBeGreaterThan(400);
    expect(e.representativeM).toBeLessThan(520);
    expect(e.segmentIds).toContain("S1");
  });

  it("区间范围命中多个原子分段", () => {
    const e = observationExtent(obs({ fromM: 100, toM: 900 }), route, segments, intervals);
    expect(e.locatedBy).toBe("range");
    expect(e.atomicIndexes).toEqual([0, 1, 2]);
  });

  it("缺少所有位置信息且无分段 → none", () => {
    const e = observationExtent(obs({}), route, segments, intervals);
    expect(e.locatedBy).toBe("none");
    expect(e.atomicIndexes).toEqual([]);
  });

  it("仅有分段时用分段范围兜底", () => {
    const e = observationExtent(obs({ segmentId: "S2" }), route, segments, intervals);
    expect(e.locatedBy).toBe("segment");
    expect([e.fromM, e.toM]).toEqual([600, 1000]);
  });
});
