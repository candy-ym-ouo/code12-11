<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Plus, Delete } from "@element-plus/icons-vue";
import { transectApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import type { TransectSegment } from "@/types/transect";

const props = defineProps<{ transectId: string }>();
const emit = defineEmits<{ (e: "saved", segments: TransectSegment[]): void }>();

const loading = reactive({ list: false, save: false });
const segments = ref<TransectSegment[]>([]);

interface SegmentDraft {
  id?: string;
  orderIndex: number;
  startM: number;
  endM: number | null;
  name: string;
  habitat: string;
}

const drafts = ref<SegmentDraft[]>([]);

const totalLength = computed(() => {
  const last = drafts.value[drafts.value.length - 1];
  return last?.endM ?? 0;
});

function toDrafts(list: TransectSegment[]): SegmentDraft[] {
  return list.map((s) => ({
    id: s.id,
    orderIndex: s.orderIndex,
    startM: s.startM,
    endM: s.endM,
    name: s.name,
    habitat: s.habitat ?? "",
  }));
}

async function load() {
  loading.list = true;
  try {
    segments.value = await transectApi.listSegments(props.transectId);
    drafts.value = toDrafts(segments.value);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    loading.list = false;
  }
}

watch(() => props.transectId, load, { immediate: true });

function addSegment() {
  const startM = Number(totalLength.value) || 0;
  drafts.value.push({
    orderIndex: drafts.value.length,
    startM,
    endM: null,
    name: `第 ${drafts.value.length + 1} 段`,
    habitat: "",
  });
}

function removeSegment(index: number) {
  drafts.value.splice(index, 1);
  // 重新编号；里程保持手填值，由保存时统一校验衔接
  drafts.value.forEach((d, i) => {
    d.orderIndex = i;
    if (i > 0 && drafts.value[i - 1].endM !== null) d.startM = drafts.value[i - 1].endM!;
  });
}

function onEndChange(index: number) {
  const current = drafts.value[index];
  if (current.endM !== null && index + 1 < drafts.value.length) {
    drafts.value[index + 1].startM = current.endM;
  }
}

async function save() {
  if (drafts.value.length === 0) {
    ElMessage.warning("至少定义一个分段");
    return;
  }
  for (const d of drafts.value) {
    if (!d.name.trim()) return ElMessage.warning("每段都需要名称");
    if (d.endM === null || d.endM <= d.startM) return ElMessage.warning(`「${d.name}」的结束里程必须大于起始里程`);
  }
  // 本地预检：从 0 开始且首尾相接
  if (drafts.value[0].startM !== 0) {
    return ElMessage.warning("第一个分段必须从里程 0 开始");
  }
  for (let i = 1; i < drafts.value.length; i++) {
    if (Math.abs(drafts.value[i].startM - drafts.value[i - 1].endM!) > 1e-6) {
      return ElMessage.warning("分段必须首尾相接，不能重叠或留空（可删除后重新添加）");
    }
  }

  loading.save = true;
  try {
    const saved = await transectApi.replaceSegments(
      props.transectId,
      drafts.value.map((d) => ({
        ...(d.id ? { id: d.id } : {}),
        orderIndex: d.orderIndex,
        startM: d.startM,
        endM: d.endM as number,
        name: d.name.trim(),
        habitat: d.habitat.trim() || null,
        geometry: null,
      })) as TransectSegment[],
    );
    segments.value = saved;
    drafts.value = toDrafts(saved);
    ElMessage.success("分段已保存，路线总长度已更新");
    emit("saved", saved);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    loading.save = false;
  }
}

defineExpose({ load });
</script>

<template>
  <div v-loading="loading.list" class="segment-editor">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="分段从里程 0 开始，按顺序首尾相接、互不重叠。保存后已有录入会自动重新落点；缩短路线导致录入越界时会被拒绝。"
      class="segment-editor__hint"
    />

    <el-table :data="drafts" size="small" border>
      <el-table-column label="#" width="48" align="center">
        <template #default="{ $index }">{{ $index }}</template>
      </el-table-column>
      <el-table-column label="分段名称" min-width="140">
        <template #default="{ row }">
          <el-input v-model="row.name" maxlength="60" placeholder="例如：林缘段" />
        </template>
      </el-table-column>
      <el-table-column label="生境" min-width="120">
        <template #default="{ row }">
          <el-input v-model="row.habitat" maxlength="60" placeholder="阔叶林 / 滩涂…" />
        </template>
      </el-table-column>
      <el-table-column label="起点 (m)" width="120" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.startM" :min="0" :precision="1" :controls="false" style="width: 100%" />
        </template>
      </el-table-column>
      <el-table-column label="终点 (m)" width="120" align="center">
        <template #default="{ $index, row }">
          <el-input-number
            v-model="row.endM"
            :min="0"
            :precision="1"
            :controls="false"
            style="width: 100%"
            @change="onEndChange($index)"
          />
        </template>
      </el-table-column>
      <el-table-column label="长度 (m)" width="90" align="center">
        <template #default="{ row }">{{ row.endM !== null ? Math.max(row.endM - row.startM, 0) : "—" }}</template>
      </el-table-column>
      <el-table-column width="56" align="center">
        <template #default="{ $index }">
          <el-button link type="danger" :icon="Delete" @click="removeSegment($index)" aria-label="删除分段" />
        </template>
      </el-table-column>
    </el-table>

    <div class="segment-editor__footer">
      <el-button :icon="Plus" @click="addSegment">添加分段</el-button>
      <span class="muted">路线总长度：<strong>{{ totalLength }}</strong> m</span>
      <el-button type="primary" :loading="loading.save" @click="save">保存分段</el-button>
    </div>
  </div>
</template>

<style scoped>
.segment-editor__hint {
  margin-bottom: 12px;
}

.segment-editor__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
</style>
