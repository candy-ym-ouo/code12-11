import type {
  EntryBatch,
  Observation,
  ReviewReport,
  Segment,
  Sighting,
  SpeciesTotal,
  Timeline,
} from "./types.js";
import type { SegmentStat } from "./types.js";
import { chainageToLngLat } from "./geometry.js";
import type { SurveyBook } from "./survey.js";

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // BOM 让 Excel 正确识别 UTF-8
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function fmtM(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : "";
}

export interface ExportBundle {
  observationsCsv: string;
  timelineCsv: string;
  segmentsCsv: string;
  timelineJson: Timeline;
  review: ReviewReport;
  geoJson: GeoJSON.FeatureCollection;
  summary: {
    routeName: string;
    routeLengthM: number;
    batches: EntryBatch[];
    segments: Segment[];
    speciesTotals: SpeciesTotal[];
    segmentStats: SegmentStat[];
    resolvedIndividuals: number;
    unresolvedSightings: number;
    retroactiveObservations: number;
  };
}

// 极简 GeoJSON 类型（避免额外依赖）
declare namespace GeoJSON {
  interface FeatureCollection {
    type: "FeatureCollection";
    features: Feature[];
  }
  interface Feature {
    type: "Feature";
    geometry: { type: string; coordinates: number[] | number[][] } | null;
    properties: Record<string, unknown>;
  }
}

export function buildBundle(book: SurveyBook): ExportBundle {
  const { sightings } = book.reconcile();
  const review = book.review();
  const timeline = book.timeline();
  const speciesTotals = book.speciesTotals();
  const segmentStats = book.segmentStats();
  const state = book.state;

  const obsRows = state.observations.map((o: Observation) => [
    o.id,
    o.batchId,
    o.retroactive ? "补录" : "现场",
    o.observedAt,
    o.enteredAt,
    o.speciesCode,
    o.speciesName,
    o.count,
    o.minCount ?? "",
    o.maxCount ?? "",
    o.atM ?? "",
    o.fromM ?? "",
    o.toM ?? "",
    o.segmentId ?? "",
    o.observer ?? "",
    o.weather ?? "",
    o.note ?? "",
  ]);
  const observationsCsv = toCsv(
    [
      "观测id", "批次", "录入方式", "观察时刻", "录入时刻",
      "物种代码", "物种名称", "数量", "最小估计", "最大估计",
      "桩号m", "起点m", "终点m", "所属分段", "记录者", "天气", "备注",
    ],
    obsRows,
  );

  const tlRows = sightings.map((s: Sighting) => [
    s.id,
    s.observedAt,
    s.speciesCode,
    s.speciesName,
    s.resolvedCount,
    statusLabel(s.status),
    fmtM(s.fromM),
    fmtM(s.toM),
    s.atomicIndexes.join("|"),
    s.segmentIds.join("|"),
    s.observationIds.join("|"),
    s.batchIds.join("|"),
    s.retroactive ? "是" : "否",
    s.conflictReason ?? "",
  ]);
  const timelineCsv = toCsv(
    [
      "目击id", "观察时刻", "物种代码", "物种名称", "核定数量",
      "状态", "起点m", "终点m", "原子分段序", "分段id",
      "来源观测", "来源批次", "含补录", "待处理原因",
    ],
    tlRows,
  );

  const segRows = segmentStats.map((st) => [
    st.segmentId,
    st.label,
    fmtM(st.fromM),
    fmtM(st.toM),
    fmtM(st.lengthM),
    st.retroactive ? "补录" : "现场",
    st.overlapRatio.toFixed(3),
    st.total,
    ...speciesTotals.map((sp) => st.species[sp.speciesName] ?? 0),
  ]);
  const segmentsCsv = toCsv(
    ["分段id", "名称", "起点m", "终点m", "长度m", "录入方式", "重叠比例", "合计", ...speciesTotals.map((s) => s.speciesName)],
    segRows,
  );

  const features: GeoJSON.Feature[] = [];
  // 路线
  const routeCoords = book.waypoints
    .map((wp) => (wp.lng !== undefined && wp.lat !== undefined ? [wp.lng, wp.lat] : null))
    .filter((c): c is number[] => c !== null);
  if (routeCoords.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: routeCoords },
      properties: { kind: "route", id: book.route.id, name: book.route.name },
    });
  }
  for (const s of sightings) {
    const ll = chainageToLngLat(book.route, s.representativeM);
    if (!ll) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ll.lng, ll.lat] },
      properties: {
        kind: "sighting",
        id: s.id,
        speciesCode: s.speciesCode,
        speciesName: s.speciesName,
        observedAt: s.observedAt,
        count: s.resolvedCount,
        status: s.status,
        retroactive: s.retroactive,
      },
    });
  }
  const geoJson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

  return {
    observationsCsv,
    timelineCsv,
    segmentsCsv,
    timelineJson: timeline,
    review,
    geoJson,
    summary: {
      routeName: book.route.name,
      routeLengthM: book.routeLength,
      batches: state.batches,
      segments: state.segments,
      speciesTotals,
      segmentStats,
      resolvedIndividuals: speciesTotals.reduce((sum, s) => sum + s.count, 0),
      unresolvedSightings: speciesTotals.reduce((sum, s) => sum + s.unresolvedCount, 0),
      retroactiveObservations: state.observations.filter((o) => o.retroactive).length,
    },
  };
}

export function statusLabel(status: Sighting["status"]): string {
  switch (status) {
    case "confirmed":
      return "已核定";
    case "auto-merged":
      return "自动合并";
    case "conflict":
      return "冲突待核";
    case "unresolved":
      return "待人工确认";
  }
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function buildMarkdownReport(book: SurveyBook): string {
  const bundle = buildBundle(book);
  const { review, summary } = bundle;
  const lines: string[] = [];
  lines.push(`# 样线调查报告：${mdEscape(summary.routeName)}`);
  lines.push("");
  lines.push(`- 路线长度：${summary.routeLengthM.toFixed(1)} m`);
  lines.push(`- 录入批次：${summary.batches.length}（其中补录 ${summary.batches.filter((b) => b.source === "retroactive").length}）`);
  lines.push(`- 分段：${review.totals.segments}，原子分段：${review.totals.atomicIntervals}`);
  lines.push(`- 观测 ${review.totals.observations} 条 → 目击 ${review.totals.sightings} 次；事后补录观测 ${summary.retroactiveObservations} 条`);
  lines.push(`- 已核定个体数：**${summary.resolvedIndividuals}**；待处理目击：**${summary.unresolvedSightings}**`);
  lines.push(`- 复核问题：${review.errorCount} 错误 / ${review.warningCount} 警告（共 ${review.issues.length} 条）`);
  lines.push("");

  lines.push("## 物种合计（不含待处理目击）");
  lines.push("");
  lines.push("| 物种 | 核定数量 | 目击次数 | 待处理 |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const sp of summary.speciesTotals) {
    lines.push(`| ${mdEscape(sp.speciesName)} | ${sp.count} | ${sp.sightings} | ${sp.unresolvedCount} |`);
  }
  lines.push("");

  lines.push("## 分段统计");
  lines.push("");
  lines.push("| 分段 | 桩号(m) | 长度(m) | 录入 | 重叠比例 | 合计 |");
  lines.push("| --- | --- | ---: | --- | ---: | ---: |");
  for (const st of summary.segmentStats) {
    lines.push(
      `| ${mdEscape(st.label)} | ${fmtM(st.fromM)}~${fmtM(st.toM)} | ${fmtM(st.lengthM)} | ${st.retroactive ? "补录" : "现场"} | ${(st.overlapRatio * 100).toFixed(0)}% | ${st.total} |`,
    );
  }
  lines.push("");

  lines.push("## 复核问题");
  lines.push("");
  if (review.issues.length === 0) {
    lines.push("无问题。");
  } else {
    lines.push("| 级别 | 代码 | 说明 | 关联 |");
    lines.push("| --- | --- | --- | --- |");
    for (const issue of review.issues) {
      const related = issue.sightingId ?? issue.observationId ?? issue.segmentId ?? (issue.relatedIds?.join(",") ?? "");
      lines.push(`| ${issue.severity === "error" ? "错误" : issue.severity === "warning" ? "警告" : "提示"} | ${issue.code} | ${mdEscape(issue.message)} | ${mdEscape(related)} |`);
    }
  }
  lines.push("");

  lines.push("## 目击时间线");
  lines.push("");
  lines.push("| 时刻 | 目击 | 物种 | 数量 | 状态 | 桩号(m) | 来源观测 |");
  lines.push("| --- | --- | --- | ---: | --- | --- | --- |");
  for (const s of bundle.timelineJson.sightings) {
    lines.push(
      `| ${s.observedAt} | ${s.id} | ${mdEscape(s.speciesName)} | ${s.resolvedCount} | ${statusLabel(s.status)} | ${fmtM(s.fromM)}~${fmtM(s.toM)} | ${s.observationIds.join(",")} |`,
    );
  }
  lines.push("");
  lines.push(`> 报告生成时刻：${review.generatedAt}`);
  return lines.join("\n");
}
