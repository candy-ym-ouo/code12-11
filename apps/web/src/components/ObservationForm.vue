<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { observationApi, tagApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import PhotoUploader from "./PhotoUploader.vue";
import {
  ANOMALY_SEVERITY_LABELS,
  ANOMALY_TYPE_LABELS,
  KIND_LABELS,
  type AnomalySeverity,
  type AnomalyType,
  type Observation,
  type ObservationKind,
  type ObservationStatus,
  type Tag,
} from "@/types/models";

const props = defineProps<{ observationId?: string }>();
const emit = defineEmits<{ saved: [id: string] }>();

const route = useRoute();
const router = useRouter();
const siteStore = useSiteStore();
const speciesStore = useSpeciesStore();

const DRAFT_KEY = "nature-timeline:observation-draft";
const KIND_CATEGORY: Record<ObservationKind, string | null> = {
  PLANT_PHENOLOGY: "PLANT",
  INSECT_SIGHTING: "INSECT",
  BIRD_SOUND: "BIRD",
  WEATHER_ANOMALY: null,
};

const form = reactive({
  kind: "PLANT_PHENOLOGY" as ObservationKind,
  status: "PUBLISHED" as ObservationStatus,
  siteId: "",
  speciesId: "",
  phenophaseId: "",
  observationDate: dayjs().format("YYYY-MM-DD"),
  title: "",
  notes: "",
  temperatureC: undefined as number | undefined,
  precipitationMm: undefined as number | undefined,
  windLevel: undefined as number | undefined,
  humidityPct: undefined as number | undefined,
  anomalyType: "" as AnomalyType | "",
  anomalySeverity: "MODERATE" as AnomalySeverity,
  impactNotes: "",
  tagIds: [] as string[],
});

const photos = ref<Observation["photos"]>([]);
const pendingFiles = ref<File[]>([]);
const tags = ref<Tag[]>([]);
const saving = ref(false);
const loading = ref(false);
const uploaderRef = ref<InstanceType<typeof PhotoUploader> | null>(null);

const kindOptions = Object.entries(KIND_LABELS) as Array<[ObservationKind, string]>;
const anomalyTypes = Object.entries(ANOMALY_TYPE_LABELS) as Array<[AnomalyType, string]>;
const severities = Object.entries(ANOMALY_SEVERITY_LABELS) as Array<[AnomalySeverity, string]>;

const isEdit = computed(() => Boolean(props.observationId));
const isWeather = computed(() => form.kind === "WEATHER_ANOMALY");
const requiredCategory = computed(() => KIND_CATEGORY[form.kind]);

const speciesOptions = computed(() => {
  if (!requiredCategory.value) return speciesStore.mine;
  return speciesStore.mine.filter((item) => item.category === requiredCategory.value);
});

const phenophaseOptions = computed(
  () => speciesStore.mine.find((item) => item.id === form.speciesId)?.phenophases ?? [],
);

watch(
  () => form.speciesId,
  () => {
    if (!phenophaseOptions.value.some((phase) => phase.id === form.phenophaseId)) {
      form.phenophaseId = "";
    }
  },
);

watch(
  () => form.kind,
  () => {
    if (form.speciesId && !speciesOptions.value.some((item) => item.id === form.speciesId)) {
      form.speciesId = "";
      form.phenophaseId = "";
    }
    if (isWeather.value && !form.anomalyType) form.anomalyType = "COLD_WAVE";
  },
);

function buildPayload(extra: Record<string, unknown> = {}) {
  return {
    kind: form.kind,
    status: form.status,
    siteId: form.siteId,
    speciesId: form.speciesId || null,
    phenophaseId: form.phenophaseId || null,
    observationDate: form.observationDate,
    title: form.title || null,
    notes: form.notes || null,
    temperatureC: form.temperatureC ?? null,
    precipitationMm: form.precipitationMm ?? null,
    windLevel: form.windLevel ?? null,
    humidityPct: form.humidityPct ?? null,
    anomalyType: isWeather.value ? form.anomalyType || null : null,
    anomalySeverity: isWeather.value ? form.anomalySeverity : null,
    impactNotes: isWeather.value ? form.impactNotes || null : null,
    tagIds: form.tagIds,
    ...extra,
  };
}

function validate(): string | null {
  if (!form.siteId) return "请选择观察地点";
  if (!form.observationDate) return "请选择观察日期";
  if (!isWeather.value && !form.speciesId) return "请选择观察物种";
  if (isWeather.value && !form.anomalyType) return "请选择异常类型";
  return null;
}

async function submit(extra: Record<string, unknown> = {}) {
  const message = validate();
  if (message) {
    ElMessage.warning(message);
    return;
  }

  saving.value = true;
  try {
    const payload = buildPayload(extra);
    const saved = props.observationId
      ? await observationApi.update(props.observationId, payload)
      : await observationApi.create(payload);

    if (pendingFiles.value.length) {
      const result = await observationApi.uploadPhotos(saved.id, pendingFiles.value);
      if (result.failed.length) {
        for (const item of result.failed) ElMessage.error(`${item.originalName}：${item.reason}`);
      }
      pendingFiles.value = [];
    }

    localStorage.removeItem(DRAFT_KEY);
    ElMessage.success(props.observationId ? "已保存修改" : "记录已保存");
    emit("saved", saved.id);
  } catch (error) {
    const code = (error as { response?: { data?: { error?: { code?: string; details?: { existingObservationId?: string } } } } })
      .response?.data?.error;
    if (code?.code === "DUPLICATE_OBSERVATION") {
      try {
        await ElMessageBox.confirm("该地点当天已有同一物候阶段的记录，是否仍然新增？", "重复记录", {
          confirmButtonText: "仍然新增",
          cancelButtonText: "取消",
          type: "warning",
        });
        await submit({ allowDuplicate: true });
        return;
      } catch {
        return;
      }
    }
    ElMessage.error(apiErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

function saveDraftLocally() {
  if (isEdit.value) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form, savedAt: new Date().toISOString() }));
}

let autosaveTimer: number | undefined;

onMounted(async () => {
  await Promise.all([siteStore.fetch(), speciesStore.fetch()]);
  tags.value = await tagApi.list().catch(() => []);

  if (props.observationId) {
    loading.value = true;
    try {
      const observation = await observationApi.get(props.observationId);
      form.kind = observation.kind;
      form.status = observation.status;
      form.siteId = observation.site.id;
      form.speciesId = observation.species?.id ?? "";
      form.phenophaseId = observation.phenophase?.id ?? "";
      form.observationDate = observation.observationDate;
      form.title = observation.title ?? "";
      form.notes = observation.notes ?? "";
      form.temperatureC = observation.temperatureC ?? undefined;
      form.precipitationMm = observation.precipitationMm ?? undefined;
      form.windLevel = observation.windLevel ?? undefined;
      form.humidityPct = observation.humidityPct ?? undefined;
      form.anomalyType = (observation.anomalyType as AnomalyType) ?? "";
      form.anomalySeverity = (observation.anomalySeverity as AnomalySeverity) ?? "MODERATE";
      form.impactNotes = observation.impactNotes ?? "";
      form.tagIds = observation.tags.map((tag) => tag.id);
      photos.value = observation.photos;
    } catch (error) {
      ElMessage.error(apiErrorMessage(error));
    } finally {
      loading.value = false;
    }
    return;
  }

  const stored = localStorage.getItem(DRAFT_KEY);
  if (stored) {
    try {
      await ElMessageBox.confirm("检测到上次未提交的草稿，是否恢复？", "恢复草稿", {
        confirmButtonText: "恢复",
        cancelButtonText: "丢弃",
        type: "info",
      });
      Object.assign(form, JSON.parse(stored));
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }

  if (typeof route.query.siteId === "string") form.siteId = route.query.siteId;
  if (typeof route.query.speciesId === "string") form.speciesId = route.query.speciesId;
  if (typeof route.query.kind === "string" && route.query.kind in KIND_LABELS) {
    form.kind = route.query.kind as ObservationKind;
  }
  if (typeof route.query.date === "string") form.observationDate = route.query.date;
  if (!form.siteId && siteStore.sites.length === 1) form.siteId = siteStore.sites[0].id;

  autosaveTimer = window.setInterval(saveDraftLocally, 5000);
});

onUnmounted(() => {
  if (autosaveTimer) window.clearInterval(autosaveTimer);
});

async function refreshPhotos() {
  if (!props.observationId) return;
  const observation = await observationApi.get(props.observationId);
  photos.value = observation.photos;
}

function cancel() {
  router.back();
}
</script>

<template>
  <section v-loading="loading" class="form card">
    <header class="form__header">
      <h2 class="form__title">{{ isEdit ? "编辑观察记录" : "新增观察记录" }}</h2>
      <p class="form__subtitle muted">
        记录树木发芽、昆虫出现、鸟鸣变化或天气异常，照片与文字都会进入时间线。
      </p>
    </header>

    <el-form label-position="top" class="form__body" @submit.prevent>
      <el-form-item label="观测类型">
        <el-radio-group v-model="form.kind" size="small">
          <el-radio-button v-for="[value, label] in kindOptions" :key="value" :value="value">{{ label }}</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <div class="form__grid">
        <el-form-item label="观察地点" required>
          <el-select v-model="form.siteId" placeholder="请选择地点" filterable>
            <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="观察日期" required>
          <el-date-picker v-model="form.observationDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>

        <el-form-item :label="isWeather ? '关联物种（可选）' : '物种'" :required="!isWeather">
          <el-select v-model="form.speciesId" placeholder="请选择物种" filterable clearable>
            <el-option v-for="species in speciesOptions" :key="species.id" :label="species.commonName" :value="species.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="物候阶段">
          <el-select v-model="form.phenophaseId" placeholder="请选择阶段" clearable :disabled="!form.speciesId">
            <el-option v-for="phase in phenophaseOptions" :key="phase.id" :label="phase.name" :value="phase.id" />
          </el-select>
        </el-form-item>
      </div>

      <template v-if="isWeather">
        <div class="form__grid">
          <el-form-item label="异常类型" required>
            <el-select v-model="form.anomalyType" placeholder="请选择异常类型">
              <el-option v-for="[value, label] in anomalyTypes" :key="value" :label="label" :value="value" />
            </el-select>
          </el-form-item>
          <el-form-item label="严重程度">
            <el-select v-model="form.anomalySeverity">
              <el-option v-for="[value, label] in severities" :key="value" :label="label" :value="value" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="对生物的影响">
          <el-input v-model="form.impactNotes" type="textarea" :rows="2" maxlength="1000" show-word-limit />
        </el-form-item>
      </template>

      <div class="form__grid form__grid--three">
        <el-form-item label="气温（℃）">
          <el-input-number v-model="form.temperatureC" :min="-60" :max="60" :step="0.1" controls-position="right" />
        </el-form-item>
        <el-form-item label="降水量（mm）">
          <el-input-number v-model="form.precipitationMm" :min="0" :max="2000" :step="0.1" controls-position="right" />
        </el-form-item>
        <el-form-item label="风力（级）">
          <el-input-number v-model="form.windLevel" :min="0" :max="17" controls-position="right" />
        </el-form-item>
      </div>

      <el-form-item label="标题">
        <el-input v-model="form.title" maxlength="120" placeholder="例如：银杏发芽（2025）" />
      </el-form-item>

      <el-form-item label="文字记录">
        <el-input
          v-model="form.notes"
          type="textarea"
          :rows="4"
          maxlength="5000"
          show-word-limit
          placeholder="记录你看到的细节，例如芽鳞状态、鸣叫时间、数量级等"
        />
      </el-form-item>

      <el-form-item label="标签">
        <el-select v-model="form.tagIds" multiple filterable allow-create default-first-option placeholder="选择或输入标签">
          <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.id" />
        </el-select>
      </el-form-item>

      <el-form-item label="照片">
        <PhotoUploader
          ref="uploaderRef"
          :observation-id="props.observationId"
          :photos="photos"
          :files="pendingFiles"
          @update:files="(files) => (pendingFiles = files)"
          @uploaded="refreshPhotos"
          @removed="refreshPhotos"
        />
      </el-form-item>

      <el-form-item v-if="!isEdit" label="记录状态">
        <el-radio-group v-model="form.status">
          <el-radio value="PUBLISHED">正式记录（进入时间线与统计）</el-radio>
          <el-radio value="DRAFT">草稿（仅自己可见）</el-radio>
        </el-radio-group>
      </el-form-item>

      <div class="form__actions">
        <el-button class="touch-target" @click="cancel">取消</el-button>
        <el-button v-if="!isEdit" class="touch-target" @click="submit({ status: 'DRAFT' })">保存为草稿</el-button>
        <el-button type="primary" class="touch-target" :loading="saving" @click="submit()">保存记录</el-button>
      </div>
    </el-form>
  </section>
</template>

<style scoped>
.form {
  padding: 18px;
}

.form__header {
  margin-bottom: 12px;
}

.form__title {
  margin: 0;
  font-size: 18px;
}

.form__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
}

.form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.form__grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

@media (max-width: 767px) {
  .form__grid,
  .form__grid--three {
    grid-template-columns: 1fr;
  }
  .form__actions {
    flex-direction: column;
  }
  .form__actions :deep(.el-button) {
    margin-left: 0;
    width: 100%;
  }
}
</style>
