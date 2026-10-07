#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SurveyBook, SurveyError, type AddObservationInput } from "./survey.js";
import { buildBundle, buildMarkdownReport, statusLabel } from "./export.js";
import type { Waypoint } from "./types.js";

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string>;
  bools: Set<string>;
}

function parseArgs(argv: string[], booleanFlags: string[] = []): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (booleanFlags.includes(key)) {
        bools.add(key);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new SurveyError(`参数 --${key} 需要值`);
        }
        flags.set(key, next);
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, bools };
}

function num(flags: Map<string, string>, key: string): number | undefined {
  const v = flags.get(key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) throw new SurveyError(`--${key} 需要数字，得到 "${v}"`);
  return n;
}

function loadBook(path: string): SurveyBook {
  return SurveyBook.load(path);
}

// —— 极简 CSV 解析（支持引号、转义、BOM）——
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }
  return rows;
}

const HELP = `yangxian — 样线调查命令行

用法：
  yangxian init <账本.json> --name <路线名> [--length <米>] [--geojson <路线.geojson>] [--desc <说明>]
  yangxian batch <账本.json> --source <field|retroactive> --recorder <记录者> [--at <ISO时刻>] [--note <备注>]
  yangxian segment <账本.json> --batch <批次id> --label <段名> --from <米> --to <米> [--start <ISO>] [--end <ISO>]
  yangxian obs <账本.json> --batch <批次id> --time <ISO时刻> --species-code <代码> --species-name <名称>
          --count <数量> [--at <米> | --from <米> --to <米> | --segment <分段id> | --lng <经> --lat <纬>]
          [--observer <记录者>] [--weather <天气>] [--note <备注>]
  yangxian import <账本.json> --batch <批次id> --csv <观测.csv>
  yangxian timeline <账本.json> [--json]
  yangxian review <账本.json> [--json]
  yangxian stats <账本.json>
  yangxian export <账本.json> --out <目录> [--format <all|csv|json|geojson|md>]（默认 all）
  yangxian show <账本.json>

重叠分段、事后补录可直接录入；所有结果每次从原始记录重新对齐，编号稳定、可复核。
`;

function cmdInit(args: ParsedArgs): void {
  const [path] = args.positional;
  if (!path) throw new SurveyError("缺少账本路径");
  const name = args.flags.get("name");
  if (!name) throw new SurveyError("需要 --name");

  let waypoints: Waypoint[];
  const geojsonPath = args.flags.get("geojson");
  if (geojsonPath) {
    const gj = JSON.parse(readFileSync(geojsonPath, "utf8"));
    const coords: number[][] =
      gj.type === "LineString"
        ? gj.coordinates
        : gj.type === "Feature" && gj.geometry?.type === "LineString"
          ? gj.geometry.coordinates
          : undefined;
    if (!coords) throw new SurveyError("GeoJSON 需为 LineString");
    waypoints = coords.map(([lng, lat], i) => ({ id: `WP${i + 1}`, lng, lat }));
  } else {
    const length = num(args.flags, "length") ?? 1000;
    waypoints = [
      { id: "WP1", chainage: 0 },
      { id: "WP2", chainage: length },
    ];
  }

  const book = new SurveyBook({
    name,
    waypoints,
    ...(args.flags.get("desc") ? { description: args.flags.get("desc") } : {}),
  });
  book.save(path);
  console.log(`已创建路线「${name}」，长度 ${book.routeLength.toFixed(1)} m，控制点 ${waypoints.length} 个 → ${path}`);
}

function cmdBatch(args: ParsedArgs): void {
  const [path] = args.positional;
  const source = args.flags.get("source") as "field" | "retroactive" | undefined;
  const recorder = args.flags.get("recorder");
  if (!path || !source || !recorder) throw new SurveyError("用法：batch <账本> --source --recorder");
  if (source !== "field" && source !== "retroactive") {
    throw new SurveyError("--source 只能是 field 或 retroactive");
  }
  const book = loadBook(path);
  const batch = book.addBatch({
    source,
    recorder,
    ...(args.flags.get("at") ? { enteredAt: args.flags.get("at") } : {}),
    ...(args.flags.get("note") ? { note: args.flags.get("note") } : {}),
  });
  book.save(path);
  console.log(`${batch.id}\t${source}\t${batch.enteredAt}\t${recorder}`);
}

function cmdSegment(args: ParsedArgs): void {
  const [path] = args.positional;
  const batchId = args.flags.get("batch");
  const label = args.flags.get("label");
  const fromM = num(args.flags, "from");
  const toM = num(args.flags, "to");
  if (!path || !batchId || !label || fromM === undefined || toM === undefined) {
    throw new SurveyError("用法：segment <账本> --batch --label --from --to");
  }
  const book = loadBook(path);
  const seg = book.addSegment(batchId, {
    label,
    fromM,
    toM,
    ...(args.flags.get("start") ? { startedAt: args.flags.get("start") } : {}),
    ...(args.flags.get("end") ? { endedAt: args.flags.get("end") } : {}),
  });
  book.save(path);
  console.log(`${seg.id}\t${seg.label}\t${seg.fromM}~${seg.toM}m\t${seg.retroactive ? "补录" : "现场"}`);
}

function obsInputFromFlags(args: ParsedArgs): AddObservationInput {
  const time = args.flags.get("time");
  const speciesCode = args.flags.get("species-code");
  const speciesName = args.flags.get("species-name");
  const count = num(args.flags, "count");
  if (!time || !speciesCode || !speciesName || count === undefined) {
    throw new SurveyError("obs 至少需要 --time --species-code --species-name --count");
  }
  const min = num(args.flags, "min");
  const max = num(args.flags, "max");
  const at = num(args.flags, "at");
  const from = num(args.flags, "from");
  const to = num(args.flags, "to");
  const lng = num(args.flags, "lng");
  const lat = num(args.flags, "lat");
  const segment = args.flags.get("segment");
  const observer = args.flags.get("observer");
  const weather = args.flags.get("weather");
  const note = args.flags.get("note");
  return {
    observedAt: time,
    speciesCode,
    speciesName,
    count,
    ...(min !== undefined ? { minCount: min } : {}),
    ...(max !== undefined ? { maxCount: max } : {}),
    ...(at !== undefined ? { atM: at } : {}),
    ...(from !== undefined ? { fromM: from } : {}),
    ...(to !== undefined ? { toM: to } : {}),
    ...(lng !== undefined ? { lng } : {}),
    ...(lat !== undefined ? { lat } : {}),
    ...(segment ? { segmentId: segment } : {}),
    ...(observer ? { observer } : {}),
    ...(weather ? { weather } : {}),
    ...(note ? { note } : {}),
  };
}

function cmdObs(args: ParsedArgs): void {
  const [path] = args.positional;
  const batchId = args.flags.get("batch");
  if (!path || !batchId) throw new SurveyError("用法：obs <账本> --batch ...");
  const book = loadBook(path);
  const obs = book.addObservation(batchId, obsInputFromFlags(args));
  book.save(path);
  console.log(`${obs.id}\t${obs.observedAt}\t${obs.speciesName} ×${obs.count}\t${obs.retroactive ? "补录" : "现场"}`);
}

/** 批量导入 CSV：表头使用导出观测表的同一套中文列名 */
function cmdImport(args: ParsedArgs): void {
  const [path] = args.positional;
  const batchId = args.flags.get("batch");
  const csvPath = args.flags.get("csv");
  if (!path || !batchId || !csvPath) throw new SurveyError("用法：import <账本> --batch --csv");
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const header = rows[0]!;
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const required = ["观察时刻", "物种代码", "物种名称", "数量"];
  for (const col of required) {
    if (idx[col] === undefined) throw new SurveyError(`CSV 缺少列：${col}`);
  }
  const get = (row: string[], col: string): string | undefined => row[idx[col]!]?.trim() || undefined;
  const n = (v?: string): number | undefined => (v === undefined ? undefined : Number(v));

  const book = loadBook(path);
  let added = 0;
  for (const row of rows.slice(1)) {
    const input: AddObservationInput = {
      observedAt: get(row, "观察时刻")!,
      speciesCode: get(row, "物种代码")!,
      speciesName: get(row, "物种名称")!,
      count: Number(get(row, "数量")),
      ...(get(row, "最小估计") !== undefined ? { minCount: Number(get(row, "最小估计")) } : {}),
      ...(get(row, "最大估计") !== undefined ? { maxCount: Number(get(row, "最大估计")) } : {}),
      ...(n(get(row, "桩号m")) !== undefined ? { atM: Number(get(row, "桩号m")) } : {}),
      ...(n(get(row, "起点m")) !== undefined ? { fromM: Number(get(row, "起点m")) } : {}),
      ...(n(get(row, "终点m")) !== undefined ? { toM: Number(get(row, "终点m")) } : {}),
      ...(get(row, "所属分段") ? { segmentId: get(row, "所属分段") } : {}),
      ...(get(row, "记录者") ? { observer: get(row, "记录者") } : {}),
      ...(get(row, "天气") ? { weather: get(row, "天气") } : {}),
      ...(get(row, "备注") ? { note: get(row, "备注") } : {}),
      ...(get(row, "录入时刻") ? { enteredAt: get(row, "录入时刻") } : {}),
    };
    book.addObservation(batchId, input);
    added++;
  }
  book.save(path);
  console.log(`已导入 ${added} 条观测到批次 ${batchId}`);
}

function cmdTimeline(args: ParsedArgs): void {
  const [path] = args.positional;
  if (!path) throw new SurveyError("用法：timeline <账本.json>");
  const book = loadBook(path);
  const timeline = book.timeline();
  if (args.bools.has("json")) {
    console.log(JSON.stringify(timeline, null, 2));
    return;
  }
  console.log("时刻                    目击      物种                数量  状态        桩号(m)        来源观测");
  for (const s of timeline.sightings) {
    const m = `${s.fromM.toFixed(0)}~${s.toM.toFixed(0)}`;
    console.log(
      `${s.observedAt.padEnd(24)}${s.id.padEnd(10)}${s.speciesName.padEnd(18)}${String(s.resolvedCount).padStart(4)}  ${statusLabel(s.status).padEnd(10)}${m.padStart(11)}   ${s.observationIds.join(",")}${s.conflictReason ? `  ⚠ ${s.conflictReason}` : ""}`,
    );
  }
}

function cmdReview(args: ParsedArgs): void {
  const [path] = args.positional;
  if (!path) throw new SurveyError("用法：review <账本.json>");
  const book = loadBook(path);
  const report = book.review();
  if (args.bools.has("json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.errorCount > 0 ? 2 : 0;
    return;
  }
  console.log(
    `批次 ${report.totals.batches}｜分段 ${report.totals.segments}（原子分段 ${report.totals.atomicIntervals}）｜观测 ${report.totals.observations} → 目击 ${report.totals.sightings}｜补录观测 ${report.totals.retroactiveObservations}`,
  );
  if (report.issues.length === 0) {
    console.log("✓ 无复核问题");
    return;
  }
  for (const issue of report.issues) {
    const icon = issue.severity === "error" ? "✗" : issue.severity === "warning" ? "!" : "·";
    const tag = issue.severity === "error" ? "错误" : issue.severity === "warning" ? "警告" : "提示";
    const where = issue.sightingId ?? issue.observationId ?? issue.segmentId ?? "";
    console.log(`${icon} [${tag}] ${issue.code} ${where} ${issue.message}`);
  }
  console.log(`合计 ${report.errorCount} 错误 / ${report.warningCount} 警告`);
  process.exitCode = report.errorCount > 0 ? 2 : 0;
}

function cmdStats(args: ParsedArgs): void {
  const [path] = args.positional;
  if (!path) throw new SurveyError("用法：stats <账本.json>");
  const book = loadBook(path);
  console.log(`路线「${book.route.name}」 ${book.routeLength.toFixed(1)} m\n`);
  console.log("物种合计：");
  for (const sp of book.speciesTotals()) {
    console.log(
      `  ${sp.speciesName.padEnd(16)} 核定 ${String(sp.count).padStart(5)}  目击 ${String(sp.sightings).padStart(3)}  待处理 ${sp.unresolvedCount}`,
    );
  }
  console.log("\n分段：");
  for (const st of book.segmentStats()) {
    console.log(
      `  ${st.segmentId} ${st.label.padEnd(14)} ${st.fromM.toFixed(0).padStart(6)}~${st.toM.toFixed(0).padStart(6)}m ${st.retroactive ? "补录" : "现场"} 重叠${(st.overlapRatio * 100).toFixed(0)}% 合计 ${st.total}`,
    );
  }
}

function cmdExport(args: ParsedArgs): void {
  const [path] = args.positional;
  const outDir = args.flags.get("out");
  if (!path || !outDir) throw new SurveyError("用法：export <账本> --out <目录>");
  const format = args.flags.get("format") ?? "all";
  const book = loadBook(path);
  const bundle = buildBundle(book);
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const write = (name: string, content: string) => {
    const target = join(outDir, name);
    writeFileSync(target, content, "utf8");
    written.push(target);
  };

  if (format === "all" || format === "csv") {
    write("observations.csv", bundle.observationsCsv);
    write("timeline.csv", bundle.timelineCsv);
    write("segments.csv", bundle.segmentsCsv);
  }
  if (format === "all" || format === "json") {
    write("timeline.json", JSON.stringify(bundle.timelineJson, null, 2));
    write("review.json", JSON.stringify(bundle.review, null, 2));
    write("summary.json", JSON.stringify(bundle.summary, null, 2));
  }
  if (format === "all" || format === "geojson") {
    write("sightings.geojson", JSON.stringify(bundle.geoJson, null, 2));
  }
  if (format === "all" || format === "md") {
    write("report.md", buildMarkdownReport(book));
  }
  console.log(`已导出 ${written.length} 个文件：`);
  written.forEach((f) => console.log(`  ${f}`));
}

function cmdShow(args: ParsedArgs): void {
  const [path] = args.positional;
  if (!path) throw new SurveyError("用法：show <账本.json>");
  const book = loadBook(path);
  console.log(JSON.stringify(book.state, null, 2));
}

function main(argv: string[]): void {
  const command = argv[0];
  const rest = argv.slice(1);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  const booleanFlags = ["json"];
  const args = parseArgs(rest, booleanFlags);
  switch (command) {
    case "init":
      return cmdInit(args);
    case "batch":
      return cmdBatch(args);
    case "segment":
      return cmdSegment(args);
    case "obs":
      return cmdObs(args);
    case "import":
      return cmdImport(args);
    case "timeline":
      return cmdTimeline(args);
    case "review":
      return cmdReview(args);
    case "stats":
      return cmdStats(args);
    case "export":
      return cmdExport(args);
    case "show":
      return cmdShow(args);
    default:
      throw new SurveyError(`未知子命令：${command}\n\n${HELP}`);
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (err instanceof SurveyError) {
    console.error(`错误：${err.message}`);
    process.exit(1);
  }
  throw err;
}
