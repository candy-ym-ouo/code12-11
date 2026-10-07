<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import CompareGrid from "@/components/CompareGrid.vue";
import EmptyState from "@/components/EmptyState.vue";
import { statsApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import type { CompareResult } from "@/types/models";

const router = useRouter();
const siteStore = useSiteStore();
const speciesStore = useSpeciesStore();

const siteId = ref("");
const speciesId = ref("");
const phenophaseId = ref("");
const years = ref<number[]>([]);
const result = ref<CompareResult | null>(null);
const loading = ref(false);
const loaded = ref(false);

const phenophaseOptions = computed(
  () => speciesStore.mine.find((item) => item.id === speciesId.value)?.phenophases ?? [],
);

const conclusion = computed(() => {
  if (!result.value) return "";
  const withOnset = result.value.years.filter((item) => item.onsetDate);
  if (withOnset.length < 2) {
    return "可用年份不足 2 年，暂不计算基准";
  }
  const latest = withOnset[withOnset.length - 1];
  const offset = latest.offsetVsBaseline ?? latest.offsetVsPrevYear;
  if (offset === null) return `${latest.year} 年已记录，但历史样本不足，暂不计算偏移`;
  const baselineText = result.value.baseline
    ? `相对 ${result.value.baseline.yearsUsed.join("、")} 年中位基准`
    : "相对上一年";
  return `${latest.year} 年（${latest.onsetDate}）${baselineText}${offset < 0 ? `提前 ${Math.abs(offset)} 天` : offset > 0 ? `推迟 ${offset} 天` : "持平"}`;
});

async function load() {
  if (!siteId.value || !speciesId.value) {
    result.value = null;
    return;
  }
  loading.value = true;
  try {
    result.value = await statsApi.compare({
      siteId: siteId.value,
      speciesId: speciesId.value,
      phenophaseId: phenophaseId.value || undefined,
      years: years.value,
    });
    loaded.value = true;
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

function goCreate(year: number) {
  const reference = result.value?.years.find((item) => item.onsetDate)?.onsetDate ?? `${year}-03-15`;
  void router.push({
    name: "observation-new",
    query: {
      siteId: siteId.value,
      speciesId: speciesId.value,
      kind: result.value?.species.category === "BIRD" ? "BIRD_SOUND" : "PLANT_PHENOLOGY",
      date: `${year}-${reference.slice(5)}`,
    },
  });
}

watch([siteId, speciesId, phenophaseId], () => {
  if (siteId.value && speciesId.value) void load();
  else result.value = null;
});

watch(speciesId, () => {
  phenophaseId.value = "";
});

onMounted(async () => {
  await Promise.all([siteStore.fetch(), speciesStore.fetch()]);
  if (siteStore.sites.length === 1) siteId.value = siteStore.sites[0].id;
});
</script>

<template>
  <div class="page page--wide">
    <header class="page-header">
      <div>
        <h1 class="page-title">跨年对比</h1>
        <p class="page-subtitle">同地点、同物种、同物候阶段的首现日比较</p>
      </div>
    </header>

    <section class="picker card">
      <el-select v-model="siteId" placeholder="选择地点" class="picker__control">
        <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
      </el-select>

      <el-select v-model="speciesId" placeholder="选择物种" filterable class="picker__control">
        <el-option
          v-for="species in speciesStore.mine"
          :key="species.id"
          :label="species.commonName"
          :value="species.id"
        />
      </el-select>

      <el-select v-model="phenophaseId" placeholder="全部阶段" clearable class="picker__control" :disabled="!speciesId">
        <el-option v-for="phase in phenophaseOptions" :key="phase.id" :label="phase.name" :value="phase.id" />
      </el-select>

      <el-select v-model="years" multiple collapse-tags placeholder="全部年份" class="picker__control" @change="load">
        <el-option v-for="year in [2020, 2021, 2022, 2023, 2024, 2025, 2026]" :key="year" :label="`${year}`" :value="year" />
      </el-select>
    </section>

    <EmptyState
      v-if="!siteId || !speciesId"
      title="先选择地点与物种"
      description="选定后会自动计算每一年的首现日与偏移。"
    />

    <template v-else>
      <el-alert
        v-if="result"
        class="conclusion"
        :title="conclusion"
        :type="result.baseline ? 'success' : 'info'"
        :closable="false"
        show-icon
      />

      <el-skeleton v-if="loading" class="section-gap" :rows="6" animated />

      <CompareGrid
        v-else-if="result && result.years.length"
        class="section-gap"
        :result="result"
        @create-for="goCreate"
        @open-observation="(id) => router.push({ name: 'observation-detail', params: { id } })"
      />

      <EmptyState
        v-else-if="loaded && result && !result.years.length"
        title="这组合还没有数据"
        description="先去记录一条该物种在该地点的观察。"
        action-text="去记录"
        @action="router.push({ name: 'observation-new', query: { siteId, speciesId } })"
      />
    </template>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}

.picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px;
}

.picker__control {
  width: 200px;
}

.conclusion {
  margin-top: 14px;
}

@media (max-width: 767px) {
  .picker__control {
    width: 100%;
  }
}
</style>
