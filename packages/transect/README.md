# @nature/transect · 样线调查

沿**固定路线（样线）**分段记录物种与数量，自动并入时间线；**分段彼此重叠、事后补录**都会与既有结果确定性对齐；所有结果可追溯到原始记录，可复核、可导出。

- 纯 TypeScript、零运行时依赖（Node ≥ 20）
- 原始数据只追加（账本 JSON），原子分段 / 时间线 / 统计全部由原始数据确定性重算
- 目击编号由「录入锚点」决定：事后补录更早的事件不会改变既有目击编号
- 导出：CSV（带 BOM，Excel 直开）、时间线 JSON、GeoJSON、Markdown 复核报告
- 49 项测试（几何、对齐、归并、复核、持久化、CLI 端到端）

## 概念模型

```text
路线 Route（控制点 + 桩号/坐标）
 └─ 录入批次 Batch（field 现场 / retroactive 事后补录；记录录入时刻与记录者）
     ├─ 分段 Segment（桩号区间 [from, to)，允许跨批次重叠）
     └─ 观测 Observation（物种、数量、观察时刻、桩号/坐标、所属分段、录入时刻）
                              │
                   每次查询时 reconcile 重算
                              ▼
原子分段 AtomicIntervals（全部分段端点排序切分）→ 目击 Sighting 时间线 → 复核报告 / 统计 / 导出
```

### 对齐规则（reconcile）

同一路线内，**物种相同、空间相邻、观察时刻间隔 ≤ 时窗（默认 15 分钟）** 的观测归并为一次目击：

- **空间相邻**：区间观测与原子分段相交；两个点状观测须在距离阈值内（默认 25 m）。同一段长几公里，不会仅因「都在该段内」就合并两个相距很远的点。
- **数量一致、位置相容、同一记录者** → `auto-merged`：重叠分段里的重复计数只算一次。
- **数量不一致 / 位置相离** → `conflict`（错误级问题，不计入核定数量，等待人工复核）。
- **不同记录者、同数量同位置** → `unresolved`：可能是两组记到同一群，需确认。
- 超过时窗 → 另一次目击，数量累加。

### 重叠分段怎么对齐

取**所有分段端点排序去重**切出原子分段（例：`0–800`、`600–1000` → `0–600 / 600–800 / 800–1000`），
重叠区（600–800）同时命中两个分段，落在其中的观测自动识别为重复并去重；复核报告会标出每个分段的重叠长度与比例。

### 事后补录怎么对齐

- 批次标记为 `retroactive`（或录入时刻晚于观察时刻超过阈值，默认 60 分钟）即为补录；
- 补录记录携带**观察时刻**与**录入时刻**：时间线按观察时刻插入，归并锚点按录入时刻确定；
- 因此补录一条更早的目击，只会追加新编号，**既有目击编号与其归并关系不变**（可复核）；
- 补录记录若与现场记录同时同地同物种，会跨批次对齐为同一次目击。

## 作为库使用

```ts
import { SurveyBook, buildBundle, buildMarkdownReport } from "@nature/transect";

const book = new SurveyBook({
  name: "西溪样线 A",
  waypoints: [            // 给坐标则桩号自动按大圆距离累计；也可直接给 chainage
    { id: "WP1", lng: 120.06, lat: 30.27 },
    { id: "WP2", lng: 120.06522, lat: 30.27 },
  ],
});

const field = book.addBatch({ source: "field", enteredAt: "2026-10-07T06:55:00+08:00", recorder: "值班长" });
const seg1 = book.addSegment(field, { label: "A段", fromM: 0, toM: 800 });
const seg2 = book.addSegment(field, { label: "重叠段", fromM: 600, toM: 1000 });

book.addObservation(field, { observedAt: "2026-10-07T07:10+08:00", speciesCode: "PYC_SIN", speciesName: "白头鹎", count: 3, atM: 700, segmentId: seg1.id, observer: "小林" });
book.addObservation(field, { observedAt: "2026-10-07T07:14+08:00", speciesCode: "PYC_SIN", speciesName: "白头鹎", count: 3, atM: 705, segmentId: seg2.id, observer: "小林" });

book.timeline();   // 2 条观测 → 1 次目击（auto-merged，核定数量 3）
book.review();     // 分段重叠警告、归并说明、冲突/缺位置/越界等问题清单
book.speciesTotals();
book.segmentStats();

const retro = book.addBatch({ source: "retroactive", enteredAt: "2026-10-08T21:00+08:00", recorder: "值班长" });
book.addObservation(retro, { observedAt: "2026-10-07T07:10:30+08:00", speciesCode: "PYC_SIN", speciesName: "白头鹎", count: 3, atM: 702, observer: "小林" });
// 跨批次对齐进同一次目击，时间线位置不变，编号稳定

const bundle = buildBundle(book);              // CSV×3 / timeline JSON / review / GeoJSON / summary
const md = buildMarkdownReport(book);          // 一份完整 Markdown 报告
book.save("survey.json");                      // 只追加原始数据的账本
```

参数可调（`new SurveyBook(input, { timeWindowMinutes, pointProximityM, retroactiveMinutes, largeClusterSize })`）。

## 命令行

```bash
pnpm --filter @nature/transect build
node packages/transect/dist/cli.js --help
# 开发态：pnpm --filter @nature/transect dev -- <子命令> ...

yangxian init survey.json --name "西溪样线A" --length 2000
yangxian batch survey.json --source field --recorder 值班长 --at 2026-10-07T06:55:00+08:00
yangxian segment survey.json --batch B0001 --label A段 --from 0 --to 800 \
  --start 2026-10-07T07:00+08:00 --end 2026-10-07T07:35+08:00
yangxian obs survey.json --batch B0001 --time 2026-10-07T07:10+08:00 \
  --species-code PYC_SIN --species-name 白头鹎 --count 3 --at 700 --observer 小林
yangxian import survey.json --batch B0002 --csv 补录.csv   # 表头同导出的 observations.csv
yangxian timeline survey.json [--json]
yangxian review   survey.json [--json]     # 有 error 级问题时退出码 2（可用于 CI 卡关）
yangxian stats    survey.json
yangxian export   survey.json --out ./out  # observations/timeline/segments CSV + JSON + GeoJSON + report.md
```

端到端演示（含重叠去重、跨批次补录对齐、数量冲突）：

```bash
pnpm --filter @nature/transect demo
# 产物在 packages/transect/examples/out/
```

## 复核问题清单

| 代码 | 级别 | 含义 |
| --- | --- | --- |
| `SEGMENT_OUTSIDE_ROUTE` / `SEGMENT_REVERSED` | 错误 | 分段越界、方向反转 |
| `DUPLICATED_ID` | 错误 | id 重复 |
| `COUNT_MISMATCH` | 错误 | 同一次目击数量不一致或位置相离，待人工核定 |
| `SEGMENT_OVERLAP` | 警告 | 分段重叠（已按原子分段对齐，附重叠比例） |
| `OBSERVATION_OUTSIDE_SEGMENT` | 警告 | 桩号/坐标不在所填分段内，或坐标偏离样线过远 |
| `OBSERVATION_TIME_OUTSIDE_WINDOW` | 警告 | 观察时刻不在分段调查时间窗内 |
| `MISSING_LOCATION` | 警告 | 观测无桩号/坐标/分段，未参与空间对齐 |
| `SIGHTING_TIME_SPREAD` / `LARGE_CLUSTER` | 警告 | 合并跨度过大，可能误并多次出现 |
| `SIGHTING_SPATIALLY_MERGED` / `RETROACTIVE_ENTRY` | 提示 | 自动去重与补录对齐的审计说明 |

## 两种统计口径（重要）

- **物种合计 `speciesTotals()`**：全样线去重后的核定数量；`conflict/unresolved` 不计入，单列「待处理」。
- **分段统计 `segmentStats()`**：目击按其来源观测**各自填报的分段**归属。重叠区里同一次目击被两组在各自分段中都记到时，两个分段都计入（反映每次行走的调查结果），所以各分段合计之和可能大于全样线去重总数。

## 测试

```bash
pnpm --filter @nature/transect test     # 先 tsc 构建，再跑 49 项 vitest（含 CLI 真实进程）
```
