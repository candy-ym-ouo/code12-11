import { describe, expect, it } from "vitest";
import {
  chainageToLngLat,
  haversineMeters,
  lngLatToChainage,
  resolveWaypoints,
  routeLengthM,
} from "../src/geometry.js";
import type { Route } from "../src/types.js";

const route: Route = {
  id: "R1",
  name: "测试样线",
  createdAt: "2026-10-07T00:00:00Z",
  waypoints: [
    { id: "WP1", lng: 120.0, lat: 30.0 },
    { id: "WP2", lng: 120.01, lat: 30.0 },
    { id: "WP3", lng: 120.01, lat: 30.01 },
  ],
};

describe("geometry / 桩号", () => {
  it("haversine 与已知距离相符（经度 0.01°，纬度 30° 约 964.9m）", () => {
    const d = haversineMeters({ lng: 120, lat: 30 }, { lng: 120.01, lat: 30 });
    expect(d).toBeGreaterThan(960);
    expect(d).toBeLessThan(970);
    expect(haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 0 })).toBe(0);
  });

  it("桩号沿控制点累计且总长正确", () => {
    const wps = resolveWaypoints(route);
    expect(wps[0]!.chainage).toBe(0);
    const seg1 = haversineMeters({ lng: 120, lat: 30 }, { lng: 120.01, lat: 30 });
    expect(wps[1]!.chainage).toBeCloseTo(seg1, 5);
    expect(routeLengthM(route)).toBeCloseTo(wps[2]!.chainage, 5);
  });

  it("显式 chainage 覆盖坐标累计", () => {
    const r: Route = {
      ...route,
      waypoints: [
        { id: "A", chainage: 0 },
        { id: "B", chainage: 500 },
        { id: "C", chainage: 1200 },
      ],
    };
    const wps = resolveWaypoints(r);
    expect(wps.map((w) => w.chainage)).toEqual([0, 500, 1200]);
    expect(routeLengthM(r)).toBe(1200);
  });

  it("桩号插值到坐标、坐标投影回桩号互为逆运算", () => {
    const total = routeLengthM(route);
    const ll = chainageToLngLat(route, total / 3)!;
    expect(ll).toBeDefined();
    const back = lngLatToChainage(route, ll)!;
    expect(back.chainage).toBeCloseTo(total / 3, 3);
    expect(back.offsetM).toBeCloseTo(0, 4);
  });

  it("超出路线的桩号返回 undefined", () => {
    expect(chainageToLngLat(route, -1)).toBeUndefined();
    expect(chainageToLngLat(route, routeLengthM(route) + 10)).toBeUndefined();
  });

  it("无坐标的纯桩号路线无法插值坐标", () => {
    const r: Route = {
      ...route,
      waypoints: [
        { id: "A", chainage: 0 },
        { id: "B", chainage: 1000 },
      ],
    };
    expect(chainageToLngLat(r, 500)).toBeUndefined();
  });
});
