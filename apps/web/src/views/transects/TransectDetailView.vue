<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Download, Plus, Warning } from "@element-plus/icons-vue";
import { transectApi, transectConflictApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import { SOURCE_LABELS } from "@/types/transect";
import type {
  TimelineResponse,
  Transect,
  TransectConflict,
  TransectEntry,
  TransectSegment,
} from "@/types/transect";
import SegmentEditor from "./SegmentEditor.vue";
import EntryFormDialog from "./EntryFormDialog.vue";
import ConflictReviewDialog from "./ConflictReviewDialog.vue";

const route = useRoute();
const router = useRouter();
const transectId = route.params.id as string;

const activeTab = ref<"timeline" | "segments" | "entries">("timeline");
const loading = ref(false);
const transect = ref<Transect | null>(null);
const timeline = ref<TimelineResponse | null>(null);
const segments = ref<TransectSegment[]>([]);
const entries = ref<TransectEntry[]>([]);
const conflicts = ref<TransectConflict[]>([]);

const entryDialogVisible = ref(false);
const entryTarget = ref<TransectEntry | { replace: TransectEntry } | null>(null);
const conflictDialogVisible = ref(false);
const activeConflict = ref<TransectConflict | null>(null);

// 时间线按「日期 × 分段」分组展示
const groupedSlices = computed(() => {
  const slices = timeline.value?.slices ?? [];
  const groups = new Map<string, { label: string; items: typeof slices }>();
  for (const slice of slices) {
    const day = dayjs(slice.startAt).format("YYYY-MM-DD ddd");
    const group = groups.get(day) ?? { label: day, items: [] };
    group.items.push(slice);
    groups.set(day, group);
  }
  return [...groups.values()];
});

const entryById = computed(() => new Map(entries.value.map((e) => [e.id, e])));

async function loadAll() {
  loading.value = true;
  try {
    const [t, tl, list, pending] = await Promise.all([
      transectApi.get(transectId),
      transectApi.timeline(transectId),
      transectApi.listEntries(transectId),
      transectConflictApi.list({ transectId, status: "PENDING" }),
    ]);
    transect.value = t;
    timeline.value = tl;
    segments.value = tl.segments;
    entries.value = list;
    conflicts.value = pending;
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

function onSegmentsSaved(saved: TransectSegment[]) {
  segments.value = saved;
  if (transect.value) transect.value.lengthM = saved[saved.length - 1]?.endM ?? 0;
  void loadAll();
}

function openCreateEntry() {
  entryTarget.value = null;
  entryDialogVisible.value = true;
}

function openEditEntry(entry: TransectEntry) {
  entryTarget.value = entry;
  entryDialogVisible.value = true;
}

function openBackfill(entry: TransectEntry) {
  entryTarget.value = { replace: entry };
  entryDialogVisible.value = true;
}

async function removeEntry(entry: TransectEntry) {
  try {
    await ElMessageBox.confirm(
      `删除「${entry.speciesName}」这条录入后，时间线与冲突会自动重算，确定继续吗？`,
      "删除录入",
      { type: "warning" },
    );
    await transectApi.deleteEntry(transectId, entry.id);
    ElMessage.success("已删除，时间线已重算");
    await loadAll();
  } catch (error) {
    if (error !== "cancel") ElMessage.error(apiErrorMessage(error));
  }
}

function openConflict(conflict: TransectConflict) {
  activeConflict.value = conflict;
  conflictDialogVisible.value = true;
}

async function onConflictResolved() {
  await loadAll();
}

function entryMeta(entryId: string): string {
  const e = entryById.value.get(entryId);
  if (!e) return entryId.slice(-6);
  return `${e.startM}–${e.endM}m · ${SOURCE_LABELS[e.source]}`;
}

async function download(format: "csv" | "geojson") {
  if (!transect.value) return;
  try {
    const date = dayjs().format("YYYY-MM-DD");
    await transectApi.downloadExport(transectId, format, `transect-${transect.value.name}-${date}.${format}`);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

function fmtTime(value: string): string {
  return dayjs(value).format("HH:mm:ss");
}

function dayjsLocal(value: string): string {
  return dayjs(value).format("MM-DD HH:mm:ss");
}

onMounted(loadAll);
</script>

<template>
  <div class="page page--wide" v-loading="loading">
    <header class="page-header">
      <div>
        <el-button link @click="router.push('/transects')">
          <el-icon><ArrowLeft /></el-icon>
          返回样线列表
        </el-button>
        <h1 class="page-title" style="margin-top: 4px">
          {{ transect?.name }}
          <span v-if="transect?.code" class="muted" style="font-size: 14px">{{ transect.code }}</span>
        </h1>
        <p class="page-subtitle">
          总长 {{ transect?.lengthM ?? 0 }} m · {{ segments.length }} 个分段 · {{ entries.length }} 条录入
          <el-tag v-if="conflicts.length" type="warning" size="small" style="margin-left: 8px">
            <el-icon style="vertical-align: -2px"><Warning /></el-icon>
            {{ conflicts.length }} 条重叠待复核
          </el-tag>
        </p>
      </div>
      <div class="row">
        <el-button @click="download('csv')"><el-icon><Download /></el-icon>导出 CSV</el-button>
        <el-button @click="download('geojson')"><el-icon><Download /></el-icon>GeoJSON</el-button>
        <el-button type="primary" class="touch-target" @click="openCreateEntry">
          <el-icon><Plus /></el-icon>
          新增录入
        </el-button>
      </div>
    </header>

    <el-tabs v-model="activeTab">
      <!-- ============ 对齐时间线 ============ -->
      <el-tab-pane label="统一时间线" name="timeline">
        <div v-if="timeline" class="summary-row">
          <el-statistic title="片段数" :value="timeline.slices.length" />
          <el-statistic title="原始合计（只）" :value="timeline.summary.totalRaw" />
          <el-statistic
            title="复核后合计（只）"
            :value="timeline.summary.totalResolved"
            :class="{ 'is-warn': timeline.summary.pendingSlices > 0 }"
          />
          <el-statistic title="待复核片段" :value="timeline.summary.pendingSlices" />
        </div>

        <el-alert
          v-if="timeline && timeline.slices.length === 0"
          type="info"
          :closable="false"
          title="还没有录入。点击右上角「新增录入」沿分段记录第一个物种。"
          style="margin: 12px 0"
        />

        <section v-for="group in groupedSlices" :key="group.label" class="tl-day">
          <h3 class="tl-day__label">{{ group.label }}</h3>
          <div
            v-for="slice in group.items"
            :key="slice.key"
            class="tl-item card"
            :class="{ 'tl-item--pending': slice.pending }"
          >
            <div class="tl-item__time">{{ fmtTime(slice.startAt) }}<template v-if="slice.endAt !== slice.startAt"> – {{ fmtTime(slice.endAt) }}</template></div>
            <div class="tl-item__body">
              <div class="tl-item__title">
                <strong>{{ slice.speciesName }}</strong>
                <el-tag size="small" effect="plain">{{ slice.segmentName ?? "未分段" }}</el-tag>
                <el-tag size="small" type="info">{{ slice.startM }}–{{ slice.endM }} m</el-tag>
                <el-tag v-if="slice.source === 'BACKFILL'" size="small" type="warning">事后补录</el-tag>
                <el-button
                  v-for="conflictId in slice.conflictIds"
                  :key="conflictId"
                  size="small"
                  type="warning"
                  plain
                  @click="openConflict(conflicts.find((c) => c.id === conflictId)!)"
                >
                  重叠待复核
                </el-button>
              </div>
              <div class="tl-item__count">
                <span class="tl-item__num">{{ slice.totalResolved }}</span> 只
                <span v-if="slice.totalRaw !== slice.totalResolved" class="muted">（原始合计 {{ slice.totalRaw }}）</span>
                <span v-else-if="slice.pending" class="muted">（重叠未复核，当前为合计口径）</span>
              </div>
              <details class="tl-item__audit">
                <summary>分摊明细（{{ slice.shares.length }} 条原始录入，守恒可复核）</summary>
                <ul>
                  <li v-for="share in slice.shares" :key="share.entryId">
                    <code>{{ share.entryId.slice(-8) }}</code> · {{ entryMeta(share.entryId) }} ·
                    分摊 <strong>{{ share.count }}</strong> 只
                  </li>
                </ul>
                <p v-if="slice.notes" class="muted">备注：{{ slice.notes }}</p>
              </details>
            </div>
          </div>
        </section>
      </el-tab-pane>

      <!-- ============ 原始录入 ============ -->
      <el-tab-pane :label="`原始录入（${entries.length}）`" name="entries">
        <el-table :data="entries" size="small" border stripe>
          <el-table-column label="时间" min-width="140">
            <template #default="{ row }">{{ dayjsLocal(row.startAt) }}<template v-if="row.endAt !== row.startAt"> –<br>{{ dayjsLocal(row.endAt) }}</template></template>
          </el-table-column>
          <el-table-column prop="speciesName" label="物种" min-width="110" />
          <el-table-column label="分段" min-width="100">
            <template #default="{ row }">{{ row.segmentName ?? "—" }}</template>
          </el-table-column>
          <el-table-column label="里程 (m)" width="110" align="center">
            <template #default="{ row }">{{ row.startM }}–{{ row.endM }}</template>
          </el-table-column>
          <el-table-column prop="count" label="数量" width="70" align="center" />
          <el-table-column label="来源" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.source === 'BACKFILL' ? 'warning' : 'info'">
                {{ SOURCE_LABELS[row.source as "MANUAL" | "BACKFILL"] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openEditEntry(row)">编辑</el-button>
              <el-button link type="warning" size="small" @click="openBackfill(row)">补录替代</el-button>
              <el-button link type="danger" size="small" @click="removeEntry(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ============ 分段管理 ============ -->
      <el-tab-pane :label="`路线分段（${segments.length}）`" name="segments">
        <SegmentEditor :transect-id="transectId" @saved="onSegmentsSaved" />
      </el-tab-pane>
    </el-tabs>

    <!-- 待复核冲突浮动入口（时间线内也可逐条点入） -->
    <el-button
      v-if="conflicts.length"
      class="conflict-fab"
      type="warning"
      round
      @click="openConflict(conflicts[0])"
    >
      <el-icon><Warning /></el-icon>
      {{ conflicts.length }} 条待复核
    </el-button>

    <EntryFormDialog
      v-model:visible="entryDialogVisible"
      :transect-id="transectId"
      :segments="segments"
      :length-m="transect?.lengthM ?? 0"
      :target="entryTarget"
      @saved="loadAll"
    />

    <ConflictReviewDialog
      v-model:visible="conflictDialogVisible"
      :conflict="activeConflict"
      @resolved="onConflictResolved"
    />
  </div>
</template>

<style scoped>
.summary-row {
  display: flex;
  gap: 32px;
  padding: 12px 16px;
  margin-bottom: 12px;
}

.is-warn :deep(.el-statistic__number) {
  color: var(--el-color-warning);
}

.tl-day {
  margin-bottom: 18px;
}

.tl-day__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  border-left: 3px solid var(--el-color-primary);
  padding-left: 8px;
  margin: 0 0 8px;
}

.tl-item {
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 8px;
  border-left: 4px solid transparent;
}

.tl-item--pending {
  border-left-color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.tl-item__time {
  width: 120px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.tl-item__body {
  flex: 1;
}

.tl-item__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tl-item__count {
  margin-top: 4px;
}

.tl-item__num {
  font-size: 20px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.tl-item__audit {
  margin-top: 6px;
  font-size: 12px;
}

.tl-item__audit summary {
  cursor: pointer;
  color: var(--el-text-color-secondary);
}

.tl-item__audit ul {
  margin: 6px 0;
  padding-left: 18px;
}

.conflict-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 100;
  box-shadow: var(--el-box-shadow);
}
</style>
