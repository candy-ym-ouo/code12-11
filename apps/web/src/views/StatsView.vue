<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import EmptyState from "@/components/EmptyState.vue";
import PhenologyChart from "@/components/PhenologyChart.vue";
import { statsApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import type { PhenologyResult } from "@/types/models";

const siteStore = useSiteStore();
const speciesStore = useSpeciesStore();

const siteId = ref("");
const speciesId = ref("");
const phenophaseId = ref("");
const phenology = ref<PhenologyResult | null>(null);
const loading = ref(false);
const loaded = ref(false);

const overview = ref<{
  total: number;
  published: number;
  drafts: number;
  speciesCount: number;
  firstObservationDate: string | null;
  lastObservationDate: string | null;
} | null>(null);

const weatherMonthDay = ref(dayjs().format("MM-DD"));
const weatherWindow = ref(7);
const weather = ref<{
  baseline: { temperatureC: number | null; yearsUsed: number[]; insufficientBaseline: boolean };
  current: Array<{ id: string; observationDate: string; temperatureC: number | null; deviation: number | null; notes: string | null }>;
} | null>(null);

const phenophaseOptions = computed(
  () => speciesStore.mine.find((item) => item.id === speciesId.value)?.phenophases ?? [],
);

const baselineText = computed(() => {
  if (!phenology.value) return "";
  if (phenology.value.reason === "INSUFFICIENT_HISTORY" || !phenology.value.baseline) {
    return "可用年份不足 2 年，暂不计算基准";
  }
  return `基准：${phenology.value.baseline.yearsUsed.join("、")} 年中位序日 ${phenology.value.baseline.dayOfYear}`;
});

async function loadOverview() {
  try {
    overview.value = await statsApi.overview(siteId.value ? { siteId: siteId.value } : {});
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function loadPhenology() {
  if (!siteId.value || !speciesId.value) {
    phenology.value = null;
    return;
  }
  loading.value = true;
  try {
    phenology.value = await statsApi.phenology({
      siteId: siteId.value,
      speciesId: speciesId.value,
      phenophaseId: phenophaseId.value || undefined,
    });
    loaded.value = true;
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

async function loadWeather() {
  if (!siteId.value) return;
  try {
    const result = await statsApi.weather({
      siteId: siteId.value,
      monthDay: weatherMonthDay.value,
      windowDays: weatherWindow.value,
    });
    weather.value = { baseline: result.baseline, current: result.current };
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

watch(siteId, () => {
  void loadOverview();
  weather.value = null;
  if (siteId.value && speciesId.value) void loadPhenology();
  else phenology.value = null;
});

watch([speciesId, phenophaseId], () => {
  if (siteId.value && speciesId.value) void loadPhenology();
  else phenology.value = null;
});

onMounted(async () => {
  await Promise.all([siteStore.fetch(), speciesStore.fetch()]);
  if (siteStore.sites.length === 1) siteId.value = siteStore.sites[0].id;
  await loadOverview();
});
</script>

<template>
  <div class="page page--wide">
    <header class="page-header">
      <div>
        <h1 class="page-title">物候统计</h1>
        <p class="page-subtitle">首现日趋势与相对多年基准的偏移</p>
      </div>
    </header>

    <section class="overview">
      <div class="overview__item card">
        <span class="overview__value">{{ overview?.published ?? 0 }}</span>
        <span class="overview__label muted">正式记录</span>
      </div>
      <div class="overview__item card">
        <span class="overview__value">{{ overview?.speciesCount ?? 0 }}</span>
        <span class="overview__label muted">物种数</span>
      </div>
      <div class="overview__item card">
        <span class="overview__value">{{ overview?.drafts ?? 0 }}</span>
        <span class="overview__label muted">草稿</span>
      </div>
      <div class="overview__item card">
        <span class="overview__value overview__value--small">
          {{ overview?.firstObservationDate ?? "—" }}
        </span>
        <span class="overview__label muted">最早记录</span>
      </div>
      <div class="overview__item card">
        <span class="overview__value overview__value--small">
          {{ overview?.lastObservationDate ?? "—" }}
        </span>
        <span class="overview__label muted">最近记录</span>
      </div>
    </section>

    <section class="picker card">
      <el-select v-model="siteId" placeholder="选择地点" clearable class="picker__control">
        <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
      </el-select>
      <el-select v-model="speciesId" placeholder="选择物种" filterable clearable class="picker__control">
        <el-option v-for="species in speciesStore.mine" :key="species.id" :label="species.commonName" :value="species.id" />
      </el-select>
      <el-select v-model="phenophaseId" placeholder="全部阶段" clearable class="picker__control" :disabled="!speciesId">
        <el-option v-for="phase in phenophaseOptions" :key="phase.id" :label="phase.name" :value="phase.id" />
      </el-select>
    </section>

    <template v-if="siteId && speciesId">
      <p class="baseline muted">{{ baselineText }}</p>
      <el-skeleton v-if="loading && !phenology" :rows="6" animated />
      <PhenologyChart
        v-else-if="phenology && phenology.items.some((item) => item.dayOfYear !== null)"
        :items="phenology.items"
      />
      <EmptyState
        v-else-if="loaded"
        title="该组合还没有可用于统计的记录"
        description="统计只包含已发布的记录，草稿不会计入。"
      />
    </template>

    <EmptyState v-else title="选择地点与物种后查看统计" description="上方的筛选条件决定了图表内容。" />

    <section class="weather card">
      <header class="weather__header">
        <h2 class="weather__title">天气同期对比</h2>
        <div class="row row--wrap">
          <el-date-picker
            v-model="weatherMonthDay"
            type="date"
            format="MM-DD"
            value-format="MM-DD"
            :clearable="false"
            class="weather__date"
          />
          <el-select v-model="weatherWindow" class="weather__window" @change="loadWeather">
            <el-option :value="3" label="±3 天" />
            <el-option :value="7" label="±7 天" />
            <el-option :value="14" label="±14 天" />
          </el-select>
          <el-button :disabled="!siteId" @click="loadWeather">查询</el-button>
        </div>
      </header>

      <div v-if="weather" class="weather__body">
        <p v-if="weather.baseline.insufficientBaseline" class="muted">
          历史样本不足 3 年，暂不给出偏差结论；已记录年份：{{ weather.baseline.yearsUsed.join("、") || "无" }}
        </p>
        <p v-else class="muted">
          历史同期均值 {{ weather.baseline.temperatureC }} ℃（基于 {{ weather.baseline.yearsUsed.join("、") }}）
        </p>

        <ul v-if="weather.current.length" class="weather__list">
          <li v-for="item in weather.current" :key="item.id">
            <span>{{ item.observationDate }}</span>
            <span>{{ item.temperatureC ?? "—" }} ℃</span>
            <span v-if="item.deviation !== null">偏差 {{ item.deviation }} ℃</span>
            <span v-if="item.notes" class="muted">{{ item.notes }}</span>
          </li>
        </ul>
        <p v-else class="muted">该日期附近暂无天气异常记录。</p>
      </div>
      <p v-else class="muted">选择日期后查询同期天气异常记录。</p>
    </section>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}

.overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.overview__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
}

.overview__value {
  font-size: 22px;
  font-weight: 600;
}

.overview__value--small {
  font-size: 15px;
  font-weight: 500;
}

.overview__label {
  font-size: 12px;
}

.picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px;
  margin-bottom: 12px;
}

.picker__control {
  width: 200px;
}

.baseline {
  margin: 0 0 10px;
  font-size: 13px;
}

.weather {
  margin-top: 18px;
  padding: 16px;
}

.weather__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.weather__title {
  margin: 0;
  font-size: 16px;
}

.weather__date {
  width: 150px;
}

.weather__window {
  width: 110px;
}

.weather__body {
  margin-top: 12px;
}

.weather__list {
  margin: 8px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}

@media (max-width: 767px) {
  .picker__control {
    width: 100%;
  }
}
</style>
