<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Delete, Edit } from "@element-plus/icons-vue";
import { observationApi, statsApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import { useObservationStore } from "@/stores/observation";
import { useUiStore } from "@/stores/ui";
import {
  ANOMALY_SEVERITY_LABELS,
  ANOMALY_TYPE_LABELS,
  KIND_LABELS,
  type Observation,
} from "@/types/models";

const route = useRoute();
const router = useRouter();
const observationStore = useObservationStore();
const ui = useUiStore();

const observation = ref<Observation | null>(null);
const loading = ref(true);
const weatherDeviation = ref<{ baseline: number | null; deviation: number | null; insufficient: boolean } | null>(null);

const observationId = computed(() => String(route.params.id));
const kindLabel = computed(() => (observation.value ? KIND_LABELS[observation.value.kind] : ""));
const dateLabel = computed(() =>
  observation.value ? dayjs(observation.value.observationDate).format("YYYY 年 M 月 D 日") : "",
);

async function load() {
  loading.value = true;
  try {
    observation.value = await observationApi.get(observationId.value);
    if (observation.value.kind === "WEATHER_ANOMALY") {
      const monthDay = observation.value.observationDate.slice(5);
      const result = await statsApi.weather({
        siteId: observation.value.site.id,
        monthDay,
        windowDays: 7,
        year: Number(observation.value.observationDate.slice(0, 4)),
      });
      weatherDeviation.value = {
        baseline: result.baseline.temperatureC,
        deviation: result.current[0]?.deviation ?? null,
        insufficient: result.baseline.insufficientBaseline,
      };
    }
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
    observation.value = null;
  } finally {
    loading.value = false;
  }
}

async function remove() {
  if (!observation.value) return;
  await ElMessageBox.confirm("删除后无法恢复，确定删除这条记录吗？", "删除记录", { type: "warning" });
  try {
    await observationApi.remove(observation.value.id);
    observationStore.removeItem(observation.value.id);
    ElMessage.success("已删除");
    await router.push({ name: "timeline" });
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function publish() {
  if (!observation.value) return;
  try {
    observation.value = await observationApi.publish(observation.value.id);
    ElMessage.success("草稿已发布");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="detail__toolbar">
      <el-button text class="touch-target" @click="router.back()">
        <el-icon><ArrowLeft /></el-icon>
        返回
      </el-button>
      <span class="spacer"></span>
      <template v-if="observation">
        <el-button v-if="observation.status === 'DRAFT'" class="touch-target" @click="publish">发布草稿</el-button>
        <el-button
          class="touch-target"
          @click="router.push({ name: 'observation-edit', params: { id: observation.id } })"
        >
          <el-icon><Edit /></el-icon>
          编辑
        </el-button>
        <el-button type="danger" plain class="touch-target" @click="remove">
          <el-icon><Delete /></el-icon>
          删除
        </el-button>
      </template>
    </div>

    <el-skeleton v-if="loading" :rows="6" animated />

    <EmptyState
      v-else-if="!observation"
      title="记录不存在"
      description="它可能已被删除，或者不属于当前账号。"
      action-text="回到时间线"
      @action="router.push({ name: 'timeline' })"
    />

    <article v-else class="detail card">
      <header class="detail__header">
        <div class="row row--wrap">
          <el-tag effect="plain">{{ kindLabel }}</el-tag>
          <el-tag v-if="observation.status === 'DRAFT'" type="warning">草稿</el-tag>
          <span v-for="tag in observation.tags" :key="tag.id" class="detail__tag" :style="{ color: tag.color }">
            #{{ tag.name }}
          </span>
        </div>
        <h1 class="detail__title">{{ observation.title || `${dateLabel} ${kindLabel}` }}</h1>
        <p class="detail__meta muted">
          <span>{{ dateLabel }}</span>
          <span>· {{ observation.site.name }}</span>
          <span v-if="observation.species">· {{ observation.species.commonName }}</span>
          <span v-if="observation.phenophase">· {{ observation.phenophase.name }}</span>
        </p>
      </header>

      <div v-if="observation.photos.length" class="detail__photos">
        <button
          v-for="(photo, index) in observation.photos"
          :key="photo.id"
          type="button"
          class="detail__photo"
          :aria-label="`查看第 ${index + 1} 张照片`"
          @click="ui.openLightbox(observation.photos, index)"
        >
          <img
            :src="photo.thumbUrl"
            :alt="`${observation.species?.commonName ?? '观察'} ${observation.observationDate}`"
            loading="lazy"
          />
        </button>
      </div>

      <p v-if="observation.notes" class="detail__notes">{{ observation.notes }}</p>

      <el-descriptions v-if="observation.kind === 'WEATHER_ANOMALY'" :column="2" border class="section-gap">
        <el-descriptions-item label="异常类型">
          {{ observation.anomalyType ? ANOMALY_TYPE_LABELS[observation.anomalyType] : "未填写" }}
        </el-descriptions-item>
        <el-descriptions-item label="严重程度">
          {{ observation.anomalySeverity ? ANOMALY_SEVERITY_LABELS[observation.anomalySeverity] : "未填写" }}
        </el-descriptions-item>
        <el-descriptions-item label="气温">{{ observation.temperatureC ?? "—" }} ℃</el-descriptions-item>
        <el-descriptions-item label="降水">{{ observation.precipitationMm ?? "—" }} mm</el-descriptions-item>
        <el-descriptions-item label="风力">{{ observation.windLevel ?? "—" }} 级</el-descriptions-item>
        <el-descriptions-item label="历史同期均值">
          <template v-if="weatherDeviation?.insufficient">历史样本不足 3 年，暂不计算</template>
          <template v-else-if="weatherDeviation?.baseline !== null && weatherDeviation?.baseline !== undefined">
            {{ weatherDeviation.baseline }} ℃（偏差 {{ weatherDeviation.deviation ?? "—" }} ℃）
          </template>
          <template v-else>—</template>
        </el-descriptions-item>
        <el-descriptions-item v-if="observation.impactNotes" label="对生物的影响" :span="2">
          {{ observation.impactNotes }}
        </el-descriptions-item>
      </el-descriptions>

      <p class="detail__timestamp muted">
        创建于 {{ dayjs(observation.createdAt).format("YYYY-MM-DD HH:mm") }}
        <span v-if="observation.source !== 'MANUAL'"> · 来源：{{ observation.source }}</span>
      </p>
    </article>
  </div>
</template>

<style scoped>
.detail__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.detail {
  padding: 18px;
}

.detail__title {
  margin: 10px 0 6px;
  font-size: 20px;
}

.detail__meta {
  margin: 0;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 13px;
}

.detail__tag {
  font-size: 13px;
}

.detail__photos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  margin: 14px 0;
}

.detail__photo {
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  background: #eef0ec;
  cursor: pointer;
  aspect-ratio: 4 / 3;
}

.detail__photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.detail__notes {
  margin: 12px 0 0;
  white-space: pre-wrap;
}

.detail__timestamp {
  margin: 16px 0 0;
  font-size: 12px;
}
</style>
