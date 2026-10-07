import { describe, expect, it } from "vitest";
import { SurveyBook, SurveyError } from "../src/survey.js";

function newBook() {
  return new SurveyBook({
    name: "测试样线",
    waypoints: [
      { id: "A", chainage: 0 },
      { id: "B", chainage: 1000 },
    ],
  });
}

describe("SurveyBook / 录入校验", () => {
  it("路线至少 2 个控制点", () => {
    expect(() => new SurveyBook({ name: "x", waypoints: [{ id: "A", chainage: 0 }] })).toThrow(SurveyError);
  });

  it("桩号必须单调不减且总长 > 0", () => {
    expect(
      () =>
        new SurveyBook({
          name: "x",
          waypoints: [
            { id: "A", chainage: 500 },
            { id: "B", chainage: 100 },
          ],
        }),
    ).toThrow(/单调不减/);
    expect(
      () =>
        new SurveyBook({
          name: "x",
          waypoints: [
            { id: "A", chainage: 0 },
            { id: "B", chainage: 0 },
          ],
        }),
    ).toThrow(/长度为 0/);
  });

  it("数量与区间校验", () => {
    const book = newBook();
    const b = book.addBatch({ source: "field", recorder: "t" });
    expect(() =>
      book.addObservation(b, { observedAt: "2026-10-07T07:00:00+08:00", speciesCode: "A", speciesName: "A", count: -1 }),
    ).toThrow(/不能为负/);
    expect(() =>
      book.addObservation(b, { observedAt: "2026-10-07T07:00:00+08:00", speciesCode: "A", speciesName: "A", count: 3, minCount: 5, maxCount: 2 }),
    ).toThrow(/数量区间/);
    expect(() =>
      book.addObservation(b, { observedAt: "2026-10-07T07:00:00+08:00", speciesCode: "A", speciesName: "A", count: 1, fromM: 900, toM: 100 }),
    ).toThrow(/观察范围/);
    expect(() =>
      book.addObservation(b, { observedAt: "bad", speciesCode: "A", speciesName: "A", count: 1 }),
    ).toThrow();
  });

  it("不存在的批次/分段拒绝录入", () => {
    const book = newBook();
    expect(() => book.addSegment("B9999", { label: "x", fromM: 0, toM: 100 })).toThrow(/批次不存在/);
    const b = book.addBatch({ source: "field", recorder: "t" });
    expect(() => book.addObservation(b, { observedAt: "2026-10-07T07:00:00+08:00", speciesCode: "A", speciesName: "A", count: 1, segmentId: "SEG9" })).toThrow(/分段不存在/);
  });

  it("分段必须 toM > fromM、时间窗合法", () => {
    const book = newBook();
    const b = book.addBatch({ source: "field", recorder: "t" });
    expect(() => book.addSegment(b, { label: "x", fromM: 800, toM: 800 })).toThrow();
    expect(() =>
      book.addSegment(b, {
        label: "x",
        fromM: 0,
        toM: 100,
        startedAt: "2026-10-07T08:00:00+08:00",
        endedAt: "2026-10-07T07:00:00+08:00",
      }),
    ).toThrow(/结束时间早于/);
  });

  it("补录批次自动把分段与观测标记为 retroactive", () => {
    const book = newBook();
    const retro = book.addBatch({ source: "retroactive", enteredAt: "2026-10-08T20:00:00+08:00", recorder: "t" });
    const seg = book.addSegment(retro, { label: "补", fromM: 0, toM: 100 });
    expect(seg.retroactive).toBe(true);
    const obs = book.addObservation(retro, { observedAt: "2026-10-07T07:00:00+08:00", speciesCode: "A", speciesName: "A", count: 1 });
    expect(obs.retroactive).toBe(true);
  });

  it("现场批次中录入远晚于观察（默认 >60 分钟）也自动视为补录", () => {
    const book = newBook();
    const b = book.addBatch({ source: "field", enteredAt: "2026-10-07T12:00:00+08:00", recorder: "t" });
    const obs = book.addObservation(b, { observedAt: "2026-10-07T07:00:00+08:00", speciesCode: "A", speciesName: "A", count: 1 });
    expect(obs.retroactive).toBe(true);
  });

  it("编号连续且重复 id 被拒绝", () => {
    const book = newBook();
    const b = book.addBatch({ source: "field", recorder: "t" });
    const s1 = book.addSegment(b, { label: "a", fromM: 0, toM: 100 });
    expect(s1.id).toBe("SEG0001");
    expect(() => book.addSegment(b, { id: "SEG0001", label: "b", fromM: 0, toM: 100 })).toThrow(/id 重复/);
  });
});

describe("SurveyBook / 复核问题", () => {
  it("分段超出路线范围 → 错误", () => {
    const book = newBook();
    const b = book.addBatch({ source: "field", recorder: "t" });
    book.addSegment(b, { label: "超长段", fromM: 900, toM: 1300 });
    const report = book.review();
    expect(report.issues.some((i) => i.code === "SEGMENT_OUTSIDE_ROUTE" && i.severity === "error")).toBe(true);
    expect(report.errorCount).toBeGreaterThan(0);
  });

  it("分段重叠 → 警告并给出重叠比例", () => {
    const book = newBook();
    const b = book.addBatch({ source: "field", recorder: "t" });
    book.addSegment(b, { label: "S1", fromM: 0, toM: 800 });
    book.addSegment(b, { label: "S2", fromM: 600, toM: 1000 });
    const report = book.review();
    const overlaps = report.issues.filter((i) => i.code === "SEGMENT_OVERLAP");
    expect(overlaps).toHaveLength(2);
    const stats = book.segmentStats();
    expect(stats[0]!.overlapRatio).toBeCloseTo(0.25);
    expect(stats[1]!.overlapRatio).toBeCloseTo(0.5);
  });

  it("观察时刻超出所填分段调查时间窗 → 警告", () => {
    const book = newBook();
    const b = book.addBatch({ source: "field", recorder: "t" });
    const seg = book.addSegment(b, {
      label: "S1",
      fromM: 0,
      toM: 1000,
      startedAt: "2026-10-07T07:00:00+08:00",
      endedAt: "2026-10-07T08:00:00+08:00",
    });
    book.addObservation(b, { observedAt: "2026-10-07T09:30:00+08:00", speciesCode: "A", speciesName: "A", count: 1, atM: 500, segmentId: seg.id });
    expect(book.review().issues.some((i) => i.code === "OBSERVATION_TIME_OUTSIDE_WINDOW")).toBe(true);
  });

  it("坐标落在所填分段之外 → 警告", () => {
    const geo = new SurveyBook({
      name: "geo",
      waypoints: [
        { id: "WP1", lng: 120, lat: 30 },
        { id: "WP2", lng: 120.01, lat: 30 },
      ],
    });
    const b = geo.addBatch({ source: "field", enteredAt: "2026-10-07T06:00:00+08:00", recorder: "t" });
    const seg = geo.addSegment(b, { label: "前段", fromM: 0, toM: 500 });
    geo.addObservation(b, { observedAt: "2026-10-07T07:00:00+08:00", speciesCode: "A", speciesName: "A", count: 1, lng: 120.009, lat: 30, segmentId: seg.id });
    expect(geo.review().issues.some((i) => i.code === "OBSERVATION_OUTSIDE_SEGMENT")).toBe(true);
  });
});
