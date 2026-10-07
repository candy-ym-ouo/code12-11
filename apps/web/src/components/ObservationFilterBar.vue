<script setup lang="ts">
import { computed, watch } from "vue";
import { storeToRefs } from "pinia";
import { useObservationStore } from "@/stores/observation";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import { CATEGORY_LABELS, KIND_LABELS, type ObservationKind } from "@/types/models";

const observationStore = useObservationStore();
const siteStore = useSiteStore();
const speciesStore = useSpeciesStore();
const { filters } = storeToRefs(observationStore);

const kindOptions = Object.entries(KIND_LABELS) as Array<[ObservationKind, string]>;

const speciesOptions = computed(() => {
  if (!filters.value.kind) return speciesStore.mine;
  const category = {
    PLANT_PHENOLOGY: "PLANT",
    INSECT_SIGHTING: "INSECT",
    BIRD_SOUND: "BIRD",
    WEATHER_ANOMALY: "",
  }[filters.value.kind];
  return category ? speciesStore.mine.filter((item) => item.category === category) : speciesStore.mine;
});

const phenophaseOptions = computed(
  () => speciesStore.mine.find((item) => item.id === filters.value.speciesId)?.phenophases ?? [],
);

const yearOptions = computed(() => {
  const current = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, index) => current - index);
});

watch(
  () => filters.value.speciesId,
  () => {
    if (!phenophaseOptions.value.some((phase) => phase.id === filters.value.phenophaseId)) {
      filters.value.phenophaseId = "";
    }
  },
);

watch(
  () => filters.value.kind,
  () => {
    if (filters.value.speciesId && !speciesOptions.value.some((item) => item.id === filters.value.speciesId)) {
      filters.value.speciesId = "";
      filters.value.phenophaseId = "";
    }
  },
);

async function apply() {
  await observationStore.reload();
}

async function reset() {
  observationStore.resetFilters();
  await apply();
}
</script>

<template>
  <section class="filters card" aria-label="筛选条件">
    <div class="filters__row">
      <el-select v-model="filters.siteId" placeholder="全部地点" clearable class="filters__control" @change="apply">
        <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
      </el-select>

      <el-select v-model="filters.speciesId" placeholder="全部物种" clearable filterable class="filters__control" @change="apply">
        <el-option
          v-for="species in speciesOptions"
          :key="species.id"
          :label="`${species.commonName}（${CATEGORY_LABELS[species.category]}）`"
          :value="species.id"
        />
      </el-select>

      <el-select
        v-model="filters.phenophaseId"
        placeholder="全部阶段"
        clearable
        class="filters__control"
        :disabled="!filters.speciesId"
        @change="apply"
      >
        <el-option v-for="phase in phenophaseOptions" :key="phase.id" :label="phase.name" :value="phase.id" />
      </el-select>

      <el-select v-model="filters.year" placeholder="全部年份" clearable class="filters__control filters__control--small" @change="apply">
        <el-option v-for="year in yearOptions" :key="year" :label="`${year} 年`" :value="year" />
      </el-select>
    </div>

    <div class="filters__row">
      <el-radio-group v-model="filters.kind" size="small" @change="apply">
        <el-radio-button value="">全部类型</el-radio-button>
        <el-radio-button v-for="[value, label] in kindOptions" :key="value" :value="value">{{ label }}</el-radio-button>
      </el-radio-group>
    </div>

    <div class="filters__row">
      <el-input
        v-model="filters.keyword"
        placeholder="搜索标题或描述"
        clearable
        class="filters__control"
        :prefix-icon="'Search'"
        @keyup.enter="apply"
        @clear="apply"
      />

      <el-select v-model="filters.status" class="filters__control filters__control--small" @change="apply">
        <el-option label="正式记录" value="PUBLISHED" />
        <el-option label="草稿" value="DRAFT" />
      </el-select>

      <el-select v-model="filters.sort" class="filters__control filters__control--small" @change="apply">
        <el-option label="最新在前" value="date_desc" />
        <el-option label="最早在前" value="date_asc" />
      </el-select>

      <el-checkbox v-model="filters.hasPhotos" label="仅含照片" @change="apply" />

      <span class="spacer"></span>
      <el-button text @click="reset">清除筛选</el-button>
    </div>
  </section>
</template>

<style scoped>
.filters {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filters__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filters__control {
  width: 190px;
}

.filters__control--small {
  width: 132px;
}

@media (max-width: 767px) {
  .filters__control,
  .filters__control--small {
    width: 100%;
  }
  .filters__row {
    gap: 6px;
  }
}
</style>
