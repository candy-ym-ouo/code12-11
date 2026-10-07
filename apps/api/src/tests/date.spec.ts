import { describe, expect, it } from "vitest";
import { addDays, dayOfYear, daysBetween, isLeapDay, isValidDateString, parseDateString, todayInTimezone } from "../lib/date";

describe("日期工具", () => {
  it("校验日期字符串的合法性", () => {
    expect(isValidDateString("2025-03-12")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true);
    expect(isValidDateString("2025-02-29")).toBe(false);
    expect(isValidDateString("2025-13-01")).toBe(false);
    expect(isValidDateString("2025-3-1")).toBe(false);
  });

  it("计算序日，并把闰日按 2 月 28 日归一", () => {
    expect(dayOfYear("2025-01-01")).toBe(1);
    // 跨年比较统一使用平年参照系，闰年 3 月及以后的日期不会多出一天
    expect(dayOfYear("2024-03-18")).toBe(77);
    expect(dayOfYear("2025-03-12")).toBe(71);
    expect(dayOfYear("2024-02-29")).toBe(dayOfYear("2024-02-28"));
    expect(isLeapDay("2024-02-29")).toBe(true);
    expect(isLeapDay("2025-02-28")).toBe(false);
  });

  it("支持日期加减与差值计算", () => {
    expect(addDays("2025-03-12", 6)).toBe("2025-03-18");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(daysBetween("2024-03-18", "2025-03-12")).toBe(359);
    expect(daysBetween("2025-03-12", "2024-03-18")).toBe(-359);
  });

  it("按指定时区返回当地日期", () => {
    const instant = new Date("2025-03-11T16:30:00Z");
    expect(todayInTimezone("Asia/Shanghai", instant)).toBe("2025-03-12");
    expect(todayInTimezone("UTC", instant)).toBe("2025-03-11");
  });

  it("解析失败时返回 null", () => {
    expect(parseDateString("not-a-date")).toBeNull();
  });
});
