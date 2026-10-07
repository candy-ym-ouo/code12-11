import { describe, expect, it } from "vitest";
import { SurveyBook } from "../src/survey.js";
import type { EntryBatch } from "../src/types.js";

function newBook(opts?: { timeWindowMinutes?: number; pointProximityM?: number; retroactiveMinutes?: number }) {
  return new SurveyBook(
    {
      name: "测试样线",
      waypoints: [
        { id: "A", chainage: 0 },
        { id: "B", chainage: 2000 },
      ],
    },
    opts,
  );
}

function fieldBatch(book: SurveyBook, at = "2026-10-07T06:55:00+08:00"): EntryBatch {
  return book.addBatch({ source: "field", enteredAt: at, recorder: "t" });
}

describe("reconcile / 时间线对齐", () => {
  it("同物种同位置同时窗的重复记录自动合并为一次目击、数量只算一次", () => {
    const book = newBook();
    const b = fieldBatch(book);
    book.addSegment(b, { label: "S1", fromM: 0, toM: 1000 });
    book.addObservation(b, { observedAt: "2026-10-07T07:10:00+08:00", speciesCode: "A", speciesName: "物种A", count: 3, atM: 500, observer: "甲" });
    book.addObservation(b, { observedAt: "2026-10-07T07:18:00+08:00", speciesCode: "A", speciesName: "物种A", count: 3, atM: 510, observer: "甲" });
    const { sightings } = book.reconcile();
    expect(sightings).toHaveLength(1);
    expect(sightings[0]!.status).toBe("auto-merged");
    expect(sightings[0]!.resolvedCount).toBe(3);
    expect(sightings[0]!.observationIds).toEqual(["O0001", "O0002"]);
    expect(book.speciesTotals()[0]!.count).toBe(3);
  });

  it("时窗外的同物种记录拆分为两次目击，数量累加", () => {
    const book = newBook();
    const b = fieldBatch(book);
    book.addSegment(b, { label: "S1", fromM: 0, toM: 1000 });
    book.addObservation(b, { observedAt: "2026-10-07T07:10:00+08:00", speciesCode: "A", speciesName: "物种A", count: 3, atM: 500, observer: "甲" });
    book.addObservation(b, { observedAt: "2026-10-07T07:40:00+08:00", speciesCode: "A", speciesName: "物种A", count: 2, atM: 500, observer: "甲" });
    const sightings = book.timeline().sightings;
    expect(sightings).toHaveLength(2);
    expect(sightings.every((s) => s.status === "confirmed")).toBe(true);
    expect(book.speciesTotals()[0]!.count).toBe(5);
  });

  it("不同物种即使同时同地也不合并", () => {
    const book = newBook();
    const b = fieldBatch(book);
    book.addSegment(b, { label: "S1", fromM: 0, toM: 1000 });
    book.addObservation(b, { observedAt: "2026-10-07T07:10:00+08:00", speciesCode: "A", speciesName: "物种A", count: 1, atM: 500 });
    book.addObservation(b, { observedAt: "2026-10-07T07:11:00+08:00", speciesCode: "B", speciesName: "物种B", count: 1, atM: 500 });
    expect(book.reconcile().sightings).toHaveLength(2);
  });

  it("同位置同时窗但数量不一致 → conflict，不计入核定数量并给出错误", () => {
    const book = newBook();
    const b = fieldBatch(book);
    book.addSegment(b, { label: "S1", fromM: 0, toM: 1000 });
    book.addObservation(b, { observedAt: "2026-10-07T07:38:00+08:00", speciesCode: "A", speciesName: "物种A", count: 4, atM: 900, observer: "甲" });
    book.addObservation(b, { observedAt: "2026-10-07T07:39:00+08:00", speciesCode: "A", speciesName: "物种A", count: 7, atM: 905, observer: "乙" });
    const { sightings } = book.reconcile();
    expect(sightings).toHaveLength(1);
    expect(sightings[0]!.status).toBe("conflict");
    expect(sightings[0]!.conflictReason).toContain("数量不一致");
    const report = book.review();
    expect(report.errorCount).toBe(1);
    expect(book.speciesTotals()[0]!.count).toBe(0);
    expect(book.speciesTotals()[0]!.unresolvedCount).toBe(1);
  });

  it("不同记录者同数量重复记录 → unresolved（需人工确认是否同一群）", () => {
    const book = newBook();
    const b = fieldBatch(book);
    book.addSegment(b, { label: "S1", fromM: 0, toM: 1000 });
    book.addObservation(b, { observedAt: "2026-10-07T07:10:00+08:00", speciesCode: "A", speciesName: "物种A", count: 2, atM: 500, observer: "甲" });
    book.addObservation(b, { observedAt: "2026-10-07T07:12:00+08:00", speciesCode: "A", speciesName: "物种A", count: 2, atM: 502, observer: "乙" });
    expect(book.reconcile().sightings[0]!.status).toBe("unresolved");
  });

  it("事后补录的记录按观察时刻并入时间线，且与既有记录对齐", () => {
    const book = newBook();
    const b1 = fieldBatch(book);
    book.addSegment(b1, { label: "S1", fromM: 0, toM: 1000 });
    book.addObservation(b1, { observedAt: "2026-10-07T07:31:00+08:00", speciesCode: "D", speciesName: "珠颈斑鸠", count: 2, atM: 905, observer: "甲" });

    // 次日补录批次：补同一次目击的细节
    const b2 = book.addBatch({ source: "retroactive", enteredAt: "2026-10-08T21:00:00+08:00", recorder: "t" });
    book.addObservation(b2, { observedAt: "2026-10-07T07:31:30+08:00", speciesCode: "D", speciesName: "珠颈斑鸠", count: 2, atM: 900, observer: "甲", note: "补抄" });

    const { sightings } = book.reconcile();
    expect(sightings).toHaveLength(1);
    expect(sightings[0]!.observationIds.sort()).toEqual(["O0001", "O0002"]);
    expect(sightings[0]!.retroactive).toBe(true);
    expect(sightings[0]!.batchIds.sort()).toEqual(["B0001", "B0002"]);
  });

  it("补录一条更早的目击：按观察时刻插入时间线，但目击编号由录入锚点决定（稳定）", () => {
    const book = newBook();
    const b1 = fieldBatch(book);
    book.addSegment(b1, { label: "S1", fromM: 0, toM: 2000 });
    book.addObservation(b1, { observedAt: "2026-10-07T08:00:00+08:00", speciesCode: "A", speciesName: "A", count: 1, atM: 100 });
    let sightings = book.reconcile().sightings;
    const idBefore = sightings[0]!.id;

    const b2 = book.addBatch({ source: "retroactive", enteredAt: "2026-10-08T20:00:00+08:00", recorder: "t" });
    book.addObservation(b2, { observedAt: "2026-10-07T06:30:00+08:00", speciesCode: "B", speciesName: "B", count: 1, atM: 200 });
    sightings = book.timeline().sightings;

    // 时间线按观察时刻：补录的 B 在前
    expect(sightings.map((s) => s.speciesCode)).toEqual(["B", "A"]);
    // 但既有目击 id 不变（锚点录入序：A 先录入仍 S0001）
    const a = sightings.find((s) => s.speciesCode === "A")!;
    expect(a.id).toBe(idBefore);
    expect(a.id).toBe("S0001");
    expect(sightings[0]!.id).toBe("S0002");
  });

  it("重算结果确定性：同一状态多次 reconcile 完全一致", () => {
    const book = newBook();
    const b = fieldBatch(book);
    book.addSegment(b, { label: "S1", fromM: 0, toM: 1000 });
    for (const [t, m] of [["07:10", 100], ["07:12", 120], ["08:00", 100]] as const) {
      book.addObservation(b, { observedAt: `2026-10-07T${t}:00+08:00`, speciesCode: "A", speciesName: "A", count: 1, atM: m, observer: "甲" });
    }
    const r1 = JSON.stringify(book.reconcile().sightings);
    const r2 = JSON.stringify(book.reconcile().sightings);
    expect(r1).toBe(r2);
  });

  it("无法定位的观测各自成目击并给缺位置告警", () => {
    const book = newBook();
    const b = fieldBatch(book);
    book.addObservation(b, { observedAt: "2026-10-07T07:10:00+08:00", speciesCode: "A", speciesName: "A", count: 1 });
    book.addObservation(b, { observedAt: "2026-10-07T07:11:00+08:00", speciesCode: "A", speciesName: "A", count: 1 });
    const { sightings } = book.reconcile();
    expect(sightings).toHaveLength(2);
    expect(book.review().issues.some((i) => i.code === "MISSING_LOCATION")).toBe(true);
  });

  it("距离阈值（pointProximityM）控制点状观测合并", () => {
    const book = newBook({ pointProximityM: 10 });
    const b = fieldBatch(book);
    book.addSegment(b, { label: "S1", fromM: 0, toM: 1000 });
    book.addObservation(b, { observedAt: "2026-10-07T07:10:00+08:00", speciesCode: "A", speciesName: "A", count: 1, atM: 500, observer: "甲" });
    book.addObservation(b, { observedAt: "2026-10-07T07:11:00+08:00", speciesCode: "A", speciesName: "A", count: 1, atM: 550, observer: "甲" });
    expect(book.reconcile().sightings).toHaveLength(2);
  });
});
