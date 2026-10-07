import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SurveyBook } from "../src/survey.js";
import { buildBundle, buildMarkdownReport } from "../src/export.js";

function demoBook() {
  const book = new SurveyBook({
    name: "导出测试样线",
    waypoints: [
      { id: "WP1", lng: 120, lat: 30 },
      { id: "WP2", lng: 120.01, lat: 30 },
    ],
  });
  const b = book.addBatch({ source: "field", enteredAt: "2026-10-07T06:55:00+08:00", recorder: "t" });
  const s1 = book.addSegment(b, { label: "S1", fromM: 0, toM: 800 });
  const s2 = book.addSegment(b, { label: "S2", fromM: 600, toM: 1000 });
  book.addObservation(b, { observedAt: "2026-10-07T07:10:00+08:00", speciesCode: "A", speciesName: "白头鹎", count: 3, atM: 700, segmentId: s1.id, observer: "甲" });
  book.addObservation(b, { observedAt: "2026-10-07T07:14:00+08:00", speciesCode: "A", speciesName: "白头鹎", count: 3, atM: 705, segmentId: s2.id, observer: "甲" });
  book.addObservation(b, { observedAt: "2026-10-07T07:30:00+08:00", speciesCode: "B", speciesName: "翠鸟", count: 1, lng: 120.005, lat: 30, observer: "甲" });
  return book;
}

describe("export / 导出", () => {
  it("观测 CSV 带 BOM 与中文表头，行数正确", () => {
    const bundle = buildBundle(demoBook());
    expect(bundle.observationsCsv.startsWith("﻿")).toBe(true);
    const lines = bundle.observationsCsv.trim().split("\r\n");
    expect(lines[0]).toContain("物种名称");
    expect(lines).toHaveLength(4); // 表头 + 3 条
  });

  it("时间线 CSV 含去重后的目击", () => {
    const bundle = buildBundle(demoBook());
    const lines = bundle.timelineCsv.trim().split("\r\n");
    expect(lines).toHaveLength(3); // 表头 + 2 次目击
    expect(lines[1]).toContain("白头鹎");
    expect(lines[1]).toContain("自动合并");
  });

  it("GeoJSON 包含路线 LineString 与目击点", () => {
    const bundle = buildBundle(demoBook());
    const kinds = bundle.geoJson.features.map((f) => f.properties!.kind);
    expect(kinds).toContain("route");
    expect(kinds.filter((k) => k === "sighting")).toHaveLength(2);
    const point = bundle.geoJson.features.find((f) => f.geometry!.type === "Point")!;
    expect(point.properties!.speciesName).toBeDefined();
  });

  it("Markdown 报告含物种合计、分段统计、复核与时间线各节", () => {
    const md = buildMarkdownReport(demoBook());
    for (const heading of ["## 物种合计", "## 分段统计", "## 复核问题", "## 目击时间线"]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("白头鹎");
    // 重叠区目击按各观测填报分段计入两个分段（分段合计之和可以大于去重总数）
    expect(md).toContain("重叠");
  });

  it("summary 中已核定个体数去重正确", () => {
    const bundle = buildBundle(demoBook());
    expect(bundle.summary.resolvedIndividuals).toBe(4); // 3（去重的一群）+ 1
    expect(bundle.summary.unresolvedSightings).toBe(0);
  });
});

describe("持久化", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "transect-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("save → load 往返后重算结果一致", () => {
    const book = demoBook();
    const before = JSON.stringify(book.reconcile().sightings);
    const path = join(dir, "survey.json");
    book.save(path);
    const reloaded = SurveyBook.load(path);
    const after = JSON.stringify(reloaded.reconcile().sightings);
    expect(after).toBe(before);
    expect(reloaded.state).toEqual(book.state);
  });

  it("加载未知版本文件报错", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ version: 99 }));
    expect(() => SurveyBook.load(path)).toThrow(/版本/);
  });

  it("原始账本 JSON 含完整批次与观测，可直接人工复核", () => {
    const path = join(dir, "survey.json");
    demoBook().save(path);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.batches).toHaveLength(1);
    expect(raw.segments).toHaveLength(2);
    expect(raw.observations).toHaveLength(3);
    expect(raw.observations[0]).toHaveProperty("enteredAt");
  });
});
