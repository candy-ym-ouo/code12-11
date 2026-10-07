<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import { transectApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import type { EntryPayload, TransectEntry, TransectSegment } from "@/types/transect";

const props = defineProps<{
  transectId: string;
  segments: TransectSegment[];
  lengthM: number;
  /** null=新建；entry=编辑；{ replace: entry }=事后补录替代 */
  target: TransectEntry | { replace: TransectEntry } | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved", entry: TransectEntry): void;
}>();

const visible = defineModel<boolean>("visible", { default: false });
const saving = ref(false);

const form = reactive({
  speciesName: "",
  segmentId: "" as string,
  startM: 0,
  endM: 0,
  count: 1,
  observedAt: dayjs().format("YYYY-MM-DDTHH:mm"),
  endAt: "",
  observer: "",
  notes: "",
  source: "MANUAL" as "MANUAL" | "BACKFILL",
});

const mode = (): "create" | "edit" | "replace" => {
  if (!props.target) return "create";
  return "replace" in props.target ? "replace" : "edit";
};

watch(
  () => props.target,
  (target) => {
    if (!target) {
      Object.assign(form, {
        speciesName: "",
        segmentId: "",
        startM: 0,
        endM: 0,
        count: 1,
        observedAt: dayjs().format("YYYY-MM-DDTHH:mm"),
        endAt: "",
        observer: "",
        notes: "",
        source: "MANUAL",
      });
      return;
    }
    const entry = "replace" in target ? target.replace : target;
    Object.assign(form, {
      speciesName: entry.speciesName,
      segmentId: entry.segmentId ?? "",
      startM: entry.startM,
      endM: entry.endM,
      count: entry.count,
      observedAt: dayjs(entry.startAt).format("YYYY-MM-DDTHH:mm"),
      endAt: entry.endAt && entry.endAt !== entry.startAt ? dayjs(entry.endAt).format("YYYY-MM-DDTHH:mm") : "",
      observer: entry.observer ?? "",
      notes: entry.notes ?? "",
      source: "replace" in (target as object) ? "BACKFILL" : entry.source,
    });
  },
  { immediate: true },
);

function onSegmentChange(segmentId: string) {
  const seg = props.segments.find((s) => s.id === segmentId);
  if (seg) {
    form.startM = seg.startM;
    form.endM = seg.endM;
  }
}

async function save() {
  if (!form.speciesName.trim()) return ElMessage.warning("请填写物种名称");
  if (form.endM < form.startM) return ElMessage.warning("里程上界不能小于下界");
  if (form.endM > props.lengthM) return ElMessage.warning(`里程超出路线总长度 ${props.lengthM} m`);
  if (form.endAt && dayjs(form.endAt).isBefore(dayjs(form.observedAt))) {
    return ElMessage.warning("结束时间不能早于开始时间");
  }

  const payload: EntryPayload = {
    speciesName: form.speciesName.trim(),
    segmentId: form.segmentId || null,
    startM: Number(form.startM),
    endM: Number(form.endM),
    count: Number(form.count),
    startAt: new Date(form.observedAt).toISOString(),
    ...(form.endAt ? { endAt: new Date(form.endAt).toISOString() } : {}),
    observer: form.observer.trim() || null,
    notes: form.notes.trim() || null,
    source: form.source,
  };

  saving.value = true;
  try {
    const currentMode = mode();
    let saved: TransectEntry;
    if (currentMode === "replace") {
      const old = (props.target as { replace: TransectEntry }).replace;
      saved = await transectApi.replaceEntry(props.transectId, old.id, payload);
    } else if (currentMode === "edit") {
      saved = await transectApi.updateEntry(props.transectId, (props.target as TransectEntry).id, {
        ...payload,
        endAt: payload.endAt ?? payload.startAt,
      });
    } else {
      saved = await transectApi.createEntry(props.transectId, payload);
    }
    ElMessage.success(currentMode === "replace" ? "补录已与既有时间线对齐" : "已保存");
    emit("saved", saved);
    visible.value = false;
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="mode() === 'replace' ? '事后补录（替代既有录入）' : mode() === 'edit' ? '编辑录入' : '新增物种录入'"
    width="min(560px, 94vw)"
    @close="emit('close')"
  >
    <el-alert
      v-if="mode() === 'replace'"
      type="warning"
      :closable="false"
      show-icon
      title="补录会按实际观测时刻并入统一时间线；保存后旧录入被归档移除，与其他录入的重叠关系会重新计算。"
      style="margin-bottom: 12px"
    />
    <el-form label-position="top">
      <el-form-item label="物种名称" required>
        <el-input v-model="form.speciesName" maxlength="80" placeholder="例如：白头鹎" />
      </el-form-item>

      <el-form-item label="所属分段（选择后自动填入里程）">
        <el-select v-model="form.segmentId" clearable filterable placeholder="按分段录入；也可直接填写里程" @change="onSegmentChange">
          <el-option
            v-for="seg in segments"
            :key="seg.id"
            :value="seg.id"
            :label="`${seg.orderIndex}. ${seg.name}（${seg.startM}–${seg.endM}m）`"
          />
        </el-select>
      </el-form-item>

      <div class="form-grid">
        <el-form-item label="里程起点 (m)" required>
          <el-input-number v-model="form.startM" :min="0" :max="lengthM" :precision="1" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="里程终点 (m)" required>
          <el-input-number v-model="form.endM" :min="0" :max="lengthM" :precision="1" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="数量" required>
          <el-input-number v-model="form.count" :min="0" :max="1000000" controls-position="right" style="width: 100%" />
        </el-form-item>
      </div>

      <div class="form-grid">
        <el-form-item label="开始观测时间" required>
          <el-date-picker
            v-model="form.observedAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="结束时间（瞬时记录留空）">
          <el-date-picker
            v-model="form.endAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="观察者">
          <el-input v-model="form.observer" maxlength="60" placeholder="选填" />
        </el-form-item>
      </div>

      <el-form-item label="备注">
        <el-input v-model="form.notes" type="textarea" :rows="2" maxlength="2000" show-word-limit />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">
        {{ mode() === "replace" ? "提交补录" : "保存" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 12px;
}
</style>
