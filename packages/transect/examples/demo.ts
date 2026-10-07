/**
 * 端到端演示：西溪样线一次鸟类调查
 *
 * 场景：
 *  10-07 清晨两组调查员沿同一样线分段记录，其中 600~1000m 两组都走了（分段重叠）；
 *  10-08 整理记录时发现：末端 1600~2000m 的分段漏录，补录该段与一只白鹭；
 *  另有一条珠颈斑鸠记录是晚上补的；喜鹊数量两组报得不一致，需要人工复核。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SurveyBook } from "../src/survey.js";
import { buildBundle, buildMarkdownReport } from "../src/export.js";

const outDir = new URL("./out", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

// —— 1. 固定路线：5 个控制点，约 2 km ——
const book = new SurveyBook({
  name: "西溪样线 A",
  description: "沿河岸步道的固定鸟类调查样线",
  waypoints: [
    { id: "WP1", name: "栈道入口", lng: 120.06, lat: 30.27 },
    { id: "WP2", lng: 120.06522, lat: 30.27 },
    { id: "WP3", name: "观景台", lng: 120.06522, lat: 30.2745 },
    { id: "WP4", lng: 120.07044, lat: 30.2745 },
    { id: "WP5", name: "芦苇荡终点", lng: 120.07044, lat: 30.279 },
  ],
});
console.log(`路线「${book.route.name}」长度 ${book.routeLength.toFixed(1)} m`);

// —— 2. 当天现场批次：分段调查，允许重叠 ——
const field = book.addBatch({
  source: "field",
  enteredAt: "2026-10-07T06:55:00+08:00",
  recorder: "调查组值班长",
  note: "清晨同步调查，出发前建档",
});
const segA = book.addSegment(field, {
  label: "A组 起点~K0+800",
  fromM: 0,
  toM: 800,
  startedAt: "2026-10-07T07:00:00+08:00",
  endedAt: "2026-10-07T07:35:00+08:00",
});
const segB = book.addSegment(field, {
  label: "B组 K0+800~K1+600",
  fromM: 800,
  toM: 1600,
  startedAt: "2026-10-07T07:25:00+08:00",
  endedAt: "2026-10-07T08:00:00+08:00",
});
// 重叠分段：A组在 600~1000m 又走了一遍（与 A、B 两段都重叠）
const segC = book.addSegment(field, {
  label: "A组复查 K0+600~K1+000",
  fromM: 600,
  toM: 1000,
  startedAt: "2026-10-07T07:15:00+08:00",
  endedAt: "2026-10-07T07:40:00+08:00",
  note: "折返复查鸣声活跃区",
});

// A 组记录
book.addObservation(field, {
  observedAt: "2026-10-07T07:10:00+08:00",
  speciesCode: "PYC_SIN",
  speciesName: "白头鹎",
  count: 3,
  atM: 650,
  segmentId: segA.id,
  observer: "小林",
  weather: "晴 微风",
});
// 同一群白头鹎在重叠段（600~800m 同时属于 segA 与 segC）复查时又记了一遍：同位置、同时段、同数量 → 自动去重
book.addObservation(field, {
  observedAt: "2026-10-07T07:18:00+08:00",
  speciesCode: "PYC_SIN",
  speciesName: "白头鹎",
  count: 3,
  atM: 655,
  segmentId: segC.id,
  observer: "小林",
  note: "与 07:10 那群疑似同一群，就在重叠区",
});

// B 组在 900m 记录珠颈斑鸠 2 只
book.addObservation(field, {
  observedAt: "2026-10-07T07:31:00+08:00",
  speciesCode: "STR_CHI",
  speciesName: "珠颈斑鸠",
  count: 2,
  atM: 905,
  segmentId: segB.id,
  observer: "阿苇",
});

// 普通翠鸟 1 只
book.addObservation(field, {
  observedAt: "2026-10-07T07:42:00+08:00",
  speciesCode: "ALC_ATH",
  speciesName: "普通翠鸟",
  count: 1,
  atM: 1200,
  segmentId: segB.id,
  observer: "阿苇",
});

// 喜鹊：同一群在重叠段（600~1000m）被两组分别记录，但数量对不上 → 冲突待人工复核
book.addObservation(field, {
  observedAt: "2026-10-07T07:38:00+08:00",
  speciesCode: "PIC_SER",
  speciesName: "喜鹊",
  count: 4,
  atM: 900,
  segmentId: segB.id,
  observer: "阿苇",
});
book.addObservation(field, {
  observedAt: "2026-10-07T07:39:00+08:00",
  speciesCode: "PIC_SER",
  speciesName: "喜鹊",
  count: 7,
  atM: 905,
  segmentId: segC.id,
  observer: "小林",
  note: "同一群喜鹊，人数法点数有分歧",
});

// 23 分钟后同位置又出现白头鹎，超过 15 分钟时窗 → 另一次目击，计数累加
book.addObservation(field, {
  observedAt: "2026-10-07T07:33:00+08:00",
  speciesCode: "PYC_SIN",
  speciesName: "白头鹎",
  count: 2,
  atM: 350,
  segmentId: segA.id,
  observer: "小林",
});

// —— 3. 次日补录批次：补末端分段与漏录记录 ——
const retro = book.addBatch({
  source: "retroactive",
  enteredAt: "2026-10-08T21:10:00+08:00",
  recorder: "调查组值班长",
  note: "补末端分段；阿苇手册补抄",
});
const segD = book.addSegment(retro, {
  label: "B组 K1+600~终点（补录）",
  fromM: 1600,
  toM: 2000,
  startedAt: "2026-10-07T08:00:00+08:00",
  endedAt: "2026-10-07T08:12:00+08:00",
});
// 补录：白鹭（用坐标而非桩号，自动投影到路线 ~1800m）
book.addObservation(retro, {
  observedAt: "2026-10-07T08:05:00+08:00",
  speciesCode: "EGR_GAR",
  speciesName: "白鹭",
  count: 5,
  lng: 120.07044,
  lat: 30.2772,
  segmentId: segD.id,
  observer: "阿苇",
  note: "次日据手册补录",
});
// 补录：07:31 的珠颈斑鸠，B 组当时还记下了鸣叫声位置（900m）——与现场记录对齐为同一次目击
book.addObservation(retro, {
  observedAt: "2026-10-07T07:31:30+08:00",
  speciesCode: "STR_CHI",
  speciesName: "珠颈斑鸠",
  count: 2,
  atM: 900,
  segmentId: segB.id,
  observer: "阿苇",
  note: "补抄：同两只，鸣声确认",
});

// —— 4. 重算与复核 ——
const review = book.review();
console.log("\n===== 复核报告 =====");
console.log(
  `分段 ${review.totals.segments}（原子分段 ${review.totals.atomicIntervals}）｜观测 ${review.totals.observations} → 目击 ${review.totals.sightings}｜补录 ${review.totals.retroactiveObservations}`,
);
for (const issue of review.issues) {
  const tag = issue.severity === "error" ? "错误" : issue.severity === "warning" ? "警告" : "提示";
  console.log(`[${tag}] ${issue.code} ${issue.sightingId ?? issue.observationId ?? issue.segmentId ?? ""} ${issue.message}`);
}

console.log("\n===== 时间线（按观察时刻）=====");
for (const s of book.timeline().sightings) {
  console.log(
    `${s.observedAt.slice(11, 16)}  ${s.id}  ${s.speciesName.padEnd(6)} ×${String(s.resolvedCount).padStart(2)}  ${String(s.fromM.toFixed(0)).padStart(4)}~${s.toM.toFixed(0).padStart(4)}m  ${s.status}${s.retroactive ? "（含补录）" : ""}  <= ${s.observationIds.join(",")}`,
  );
}

console.log("\n===== 物种合计 =====");
for (const sp of book.speciesTotals()) {
  console.log(`  ${sp.speciesName}：核定 ${sp.count}，目击 ${sp.sightings}，待处理 ${sp.unresolvedCount}`);
}

// —— 5. 导出 ——
const bundle = buildBundle(book);
writeFileSync(join(outDir, "observations.csv"), bundle.observationsCsv);
writeFileSync(join(outDir, "timeline.csv"), bundle.timelineCsv);
writeFileSync(join(outDir, "segments.csv"), bundle.segmentsCsv);
writeFileSync(join(outDir, "timeline.json"), JSON.stringify(bundle.timelineJson, null, 2));
writeFileSync(join(outDir, "sightings.geojson"), JSON.stringify(bundle.geoJson, null, 2));
writeFileSync(join(outDir, "report.md"), buildMarkdownReport(book));
book.save(join(outDir, "survey.json"));
console.log(`\n已导出到 ${outDir}`);
