/** ISO 8601 解析（兼容结尾 Z） */
export function parseTime(value: string): Date {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`时间格式无效："${value}"，需要 ISO 8601，如 2026-10-07T08:30:00+08:00`);
  }
  const normalized = value.trim().replace(/Z$/i, "+00:00");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`时间无法解析："${value}"`);
  }
  return d;
}

export function toIso(value: Date): string {
  return value.toISOString();
}

/** 分钟差（b - a） */
export function diffMinutes(a: string, b: string): number {
  return (parseTime(b).getTime() - parseTime(a).getTime()) / 60000;
}

export function minTime(a: string, b: string): string {
  return parseTime(a) <= parseTime(b) ? a : b;
}

export function maxTime(a: string, b: string): string {
  return parseTime(a) >= parseTime(b) ? a : b;
}
