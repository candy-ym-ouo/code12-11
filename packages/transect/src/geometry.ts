import type { LngLat, Route, Waypoint } from "./types.js";

const EARTH_RADIUS_M = 6_371_008.8;
const DEG2RAD = Math.PI / 180;

/** 大圆距离（haversine），单位米 */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface ResolvedWaypoint extends Waypoint {
  chainage: number;
  lng?: number;
  lat?: number;
}

/**
 * 计算每个控制点桩号：
 * - 显式给出 chainage 时以它为准；
 * - 否则沿相邻有坐标的控制点累计大圆距离；
 * - 两者都缺失时沿用上一个桩号（该点不贡献长度）。
 */
export function resolveWaypoints(route: Route): ResolvedWaypoint[] {
  const resolved: ResolvedWaypoint[] = [];
  let cumulative = 0;
  route.waypoints.forEach((wp, i) => {
    let chainage: number;
    if (wp.chainage !== undefined) {
      chainage = wp.chainage;
      cumulative = chainage;
    } else if (wp.lng !== undefined && wp.lat !== undefined) {
      if (i === 0) {
        chainage = 0;
      } else {
        const prev = resolved[i - 1]!;
        if (prev.lng !== undefined && prev.lat !== undefined) {
          cumulative += haversineMeters(
            { lng: prev.lng, lat: prev.lat },
            { lng: wp.lng, lat: wp.lat },
          );
        }
      }
      chainage = cumulative;
    } else {
      chainage = cumulative;
    }
    resolved.push({ ...wp, chainage });
  });
  return resolved;
}

/** 路线总长（末端控制点桩号，米） */
export function routeLengthM(route: Route): number {
  const wps = resolveWaypoints(route);
  return wps.length ? wps[wps.length - 1]!.chainage : 0;
}

/**
 * 桩号 → 坐标的分段线性插值；桩号超出路线或该段无坐标时返回 undefined。
 */
export function chainageToLngLat(
  route: Route,
  chainage: number,
): LngLat | undefined {
  const wps = resolveWaypoints(route);
  if (wps.length === 0 || chainage < 0 || chainage > wps[wps.length - 1]!.chainage) {
    return undefined;
  }
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i]!;
    const b = wps[i + 1]!;
    if (chainage >= a.chainage && chainage <= b.chainage) {
      if (a.lng === undefined || a.lat === undefined || b.lng === undefined || b.lat === undefined) {
        return undefined;
      }
      const span = b.chainage - a.chainage;
      if (span <= 0) return { lng: a.lng, lat: a.lat };
      const t = (chainage - a.chainage) / span;
      return {
        lng: a.lng + (b.lng - a.lng) * t,
        lat: a.lat + (b.lat - a.lat) * t,
      };
    }
  }
  const last = wps[wps.length - 1]!;
  return last.lng !== undefined && last.lat !== undefined
    ? { lng: last.lng, lat: last.lat }
    : undefined;
}

/**
 * 坐标 → 最近桩号：逐控制点段求投影，返回沿线最近点的桩号与偏差（米）。
 */
export function lngLatToChainage(
  route: Route,
  point: LngLat,
): { chainage: number; offsetM: number } | undefined {
  const wps = resolveWaypoints(route);
  let best: { chainage: number; offsetM: number } | undefined;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i]!;
    const b = wps[i + 1]!;
    if (a.lng === undefined || a.lat === undefined || b.lng === undefined || b.lat === undefined) {
      continue;
    }
    // 用局部等距方位近似：以经纬度转米的平面投影做段内投影
    const lat0 = ((a.lat + b.lat) / 2) * DEG2RAD;
    const mx = (lng: number, lat: number) => ({
      x: (lng - a.lng!) * DEG2RAD * EARTH_RADIUS_M * Math.cos(lat0),
      y: (lat - a.lat!) * DEG2RAD * EARTH_RADIUS_M,
    });
    const pa = mx(a.lng, a.lat);
    const pb = mx(b.lng, b.lat);
    const pp = mx(point.lng, point.lat);
    const segLen = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    let t = segLen === 0 ? 0 : ((pp.x - pa.x) * (pb.x - pa.x) + (pp.y - pa.y) * (pb.y - pa.y)) / segLen ** 2;
    t = Math.max(0, Math.min(1, t));
    const projX = pa.x + t * (pb.x - pa.x);
    const projY = pa.y + t * (pb.y - pa.y);
    const offset = Math.hypot(pp.x - projX, pp.y - projY);
    const chainage = a.chainage + t * (b.chainage - a.chainage);
    if (!best || offset < best.offsetM) best = { chainage, offsetM: offset };
  }
  return best;
}
