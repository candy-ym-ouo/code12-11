<script setup lang="ts">
import { ref } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import { transectConflictApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import { RESOLUTION_LABELS } from "@/types/transect";
import type { TransectConflict } from "@/types/transect";

const props = defineProps<{ conflict: TransectConflict | null }>();
const emit = defineEmits<{ (e: "resolved", conflict: TransectConflict): void }>();

const visible = defineModel<boolean>("visible", { default: false });
const saving = ref(false);
const note = ref("");

const choices: { value: "SUM" | "DUPLICATE" | "KEEP_A" | "KEEP_B"; desc: string }[] = [
  { value: "SUM", desc: "确认为两批不同个体，重叠区数量相加" },
  { value: "DUPLICATE", desc: "同一批被重复记录，重叠区只保留一次（数量大者优先，相同则保留先录入）" },
  { value: "KEEP_A", desc: "只采信先录入的一条，后录入在重叠区不计入" },
  { value: "KEEP_B", desc: "只采信后录入的一条，先录入在重叠区不计入" },
];

function fmtTime(value: string): string {
  return dayjs(value).format("MM-DD HH:mm:ss");
}

async function resolve(resolution: "SUM" | "DUPLICATE" | "KEEP_A" | "KEEP_B") {
  if (!props.conflict) return;
  saving.value = true;
  try {
    const updated = await transectConflictApi.resolve(props.conflict.id, {
      resolution,
      note: note.value.trim() || null,
    });
    ElMessage.success("复核决定已应用到时间线");
    emit("resolved", updated);
    visible.value = false;
    note.value = "";
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="复核重叠录入" width="min(620px, 94vw)">
    <div v-if="conflict" class="conflict">
      <p class="conflict__meta">
        <el-tag type="warning" size="small">待复核</el-tag>
        <strong>{{ conflict.speciesName }}</strong>
        于 {{ fmtTime(conflict.startAt) }} 在里程
        <strong>{{ conflict.startM }}–{{ conflict.endM }} m</strong> 被两条录入同时覆盖
      </p>

      <div class="conflict__cards">
        <div class="conflict__card">
          <header>A · 先录入（{{ conflict.countA }} 只）</header>
          <p v-if="conflict.entryA">
            {{ fmtTime(conflict.entryA.startAt) }} ·
            {{ conflict.entryA.startM }}–{{ conflict.entryA.endM }}m
            <el-tag v-if="conflict.entryA.source === 'BACKFILL'" size="small" type="info">补录</el-tag>
          </p>
          <p v-if="conflict.entryA?.observer" class="muted">观察者：{{ conflict.entryA.observer }}</p>
          <p v-if="conflict.entryA?.notes" class="muted">备注：{{ conflict.entryA.notes }}</p>
        </div>
        <div class="conflict__card">
          <header>B · 后录入（{{ conflict.countB }} 只）</header>
          <p v-if="conflict.entryB">
            {{ fmtTime(conflict.entryB.startAt) }} ·
            {{ conflict.entryB.startM }}–{{ conflict.entryB.endM }}m
            <el-tag v-if="conflict.entryB.source === 'BACKFILL'" size="small" type="info">补录</el-tag>
          </p>
          <p v-if="conflict.entryB?.observer" class="muted">观察者：{{ conflict.entryB.observer }}</p>
          <p v-if="conflict.entryB?.notes" class="muted">备注：{{ conflict.entryB.notes }}</p>
        </div>
      </div>

      <el-input v-model="note" placeholder="复核备注（选填，会随决定一起留存）" maxlength="500" style="margin: 12px 0" />

      <div class="conflict__choices">
        <el-button
          v-for="choice in choices"
          :key="choice.value"
          :loading="saving"
          :type="choice.value === 'SUM' ? 'primary' : choice.value === 'DUPLICATE' ? 'warning' : 'default'"
          @click="resolve(choice.value)"
        >
          {{ RESOLUTION_LABELS[choice.value] }}
        </el-button>
      </div>
      <p v-for="choice in choices" :key="`d-${choice.value}`" class="conflict__desc muted">
        <strong>{{ RESOLUTION_LABELS[choice.value] }}：</strong>{{ choice.desc }}
      </p>
    </div>
  </el-dialog>
</template>

<style scoped>
.conflict__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.conflict__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.conflict__card {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 10px 12px;
}

.conflict__card header {
  font-weight: 600;
  margin-bottom: 6px;
}

.conflict__card p {
  margin: 4px 0;
  font-size: 13px;
}

.conflict__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.conflict__desc {
  font-size: 12px;
  margin: 4px 0;
}
</style>
