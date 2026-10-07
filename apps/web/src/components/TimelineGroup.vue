<script setup lang="ts">
import TimelineItem from "./TimelineItem.vue";
import type { Observation, Photo } from "@/types/models";

defineProps<{
  year: string;
  months: Array<{ month: string; items: Observation[] }>;
}>();

const emit = defineEmits<{
  open: [id: string];
  openPhotos: [photos: Photo[], index: number];
}>();

function monthLabel(month: string): string {
  return `${Number(month.slice(5, 7))} 月`;
}
</script>

<template>
  <section class="group">
    <h2 class="group__year">{{ year }} 年</h2>
    <div v-for="month in months" :key="month.month" class="group__month">
      <h3 class="group__month-title">{{ monthLabel(month.month) }}</h3>
      <div class="group__items">
        <TimelineItem
          v-for="observation in month.items"
          :key="observation.id"
          :observation="observation"
          @open="emit('open', $event)"
          @open-photos="(photos, index) => emit('openPhotos', photos, index)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.group {
  margin-bottom: 24px;
}

.group__year {
  position: sticky;
  top: 56px;
  z-index: 5;
  margin: 0 0 12px;
  padding: 6px 0;
  font-size: 18px;
  background: var(--color-background);
}

.group__month-title {
  margin: 12px 0 8px 40px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
}

.group__items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
