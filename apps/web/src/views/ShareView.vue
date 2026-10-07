<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import dayjs from "dayjs";
import { shareApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import TimelineGroup from "@/components/TimelineGroup.vue";
import { useUiStore } from "@/stores/ui";
import type { Observation } from "@/types/models";

const route = useRoute();
const ui = useUiStore();

const data = ref<{
  site: { id: string; name: string; habitat: string | null; description: string | null };
  owner: { displayName: string };
  scope: string;
  expiresAt: string;
  observations: Observation[];
} | null>(null);

const loading = ref(true);
const error = ref("");

const groups = computed(() => {
  if (!data.value) return [];
  const byYear = new Map<string, Map<string, Observation[]>>();
  for (const item of data.value.observations) {
    const year = item.observationDate.slice(0, 4);
    const month = item.observationDate.slice(0, 7);
    const months = byYear.get(year) ?? new Map<string, Observation[]>();
    const list = months.get(month) ?? [];
    list.push(item);
    months.set(month, list);
    byYear.set(year, months);
  }
  return [...byYear.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([year, months]) => ({
      year,
      months: [...months.entries()].map(([month, items]) => ({ month, items })),
    }));
});

const comparisons = computed(() => {
  if (!data.value || data.value.scope !== "TIMELINE_AND_COMPARE") return [];
  const keyed = new Map<string, { label: string; years: Map<number, string> }>();
  for (const item of data.value.observations) {
    if (!item.species || !item.phenophase) continue;
    const key = `${item.species.id}:${item.phenophase.id}`;
    const entry = keyed.get(key) ?? { label: `${item.species.commonName} · ${item.phenophase.name}`, years: new Map() };
    const year = Number(item.observationDate.slice(0, 4));
    const existing = entry.years.get(year);
    if (!existing || item.observationDate < existing) entry.years.set(year, item.observationDate);
    keyed.set(key, entry);
  }
  return [...keyed.values()].map((entry) => ({
    label: entry.label,
    years: [...entry.years.entries()].sort((a, b) => a[0] - b[0]),
  }));
});

onMounted(async () => {
  try {
    data.value = await shareApi.view(String(route.params.token));
  } catch (err) {
    error.value = apiErrorMessage(err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <el-skeleton v-if="loading" :rows="6" animated />

    <EmptyState
      v-else-if="error"
      title="分享链接不可用"
      :description="error"
    />

    <template v-else-if="data">
      <header class="share-header card">
        <div class="row row--wrap">
          <h1 class="share-header__title">{{ data.site.name }}</h1>
          <el-tag size="small" type="info">只读分享</el-tag>
        </div>
        <p class="muted share-header__meta">
          由 {{ data.owner.displayName }} 分享 · 有效期至 {{ dayjs(data.expiresAt).format("YYYY-MM-DD") }}
        </p>
        <p v-if="data.site.description" class="share-header__description">{{ data.site.description }}</p>
      </header>

      <section v-if="comparisons.length" class="section-gap card compare-block">
        <h2 class="compare-block__title">跨年首现日</h2>
        <div v-for="row in comparisons" :key="row.label" class="compare-block__row">
          <span class="compare-block__label">{{ row.label }}</span>
          <span v-for="[year, date] in row.years" :key="year" class="compare-block__year">
            {{ year }}：{{ date.slice(5) }}
          </span>
        </div>
      </section>

      <EmptyState
        v-if="!data.observations.length"
        title="该地点还没有公开的观察记录"
        description="分享者可能还在整理数据。"
      />

      <div v-else class="section-gap">
        <TimelineGroup
          v-for="group in groups"
          :key="group.year"
          :year="group.year"
          :months="group.months"
          @open="() => undefined"
          @open-photos="(photos, index) => ui.openLightbox(photos, index)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.share-header {
  padding: 16px;
}

.share-header__title {
  margin: 0;
  font-size: 20px;
}

.share-header__meta {
  margin: 6px 0 0;
  font-size: 13px;
}

.share-header__description {
  margin: 8px 0 0;
  font-size: 14px;
}

.compare-block {
  padding: 16px;
}

.compare-block__title {
  margin: 0 0 10px;
  font-size: 16px;
}

.compare-block__row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
}

.compare-block__row:last-child {
  border-bottom: none;
}

.compare-block__label {
  min-width: 160px;
  font-weight: 600;
}

.compare-block__year {
  color: var(--color-text-muted);
}
</style>
