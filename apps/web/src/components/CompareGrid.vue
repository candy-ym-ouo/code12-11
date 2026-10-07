<script setup lang="ts">
import dayjs from "dayjs";
import type { CompareResult } from "@/types/models";

defineProps<{ result: CompareResult }>();

const emit = defineEmits<{ createFor: [year: number]; openObservation: [id: string] }>();

function offsetType(item: { offsetVsPrevYear: number | null }): "success" | "warning" | "info" {
  if (item.offsetVsPrevYear === null) return "info";
  return item.offsetVsPrevYear < 0 ? "success" : item.offsetVsPrevYear > 0 ? "warning" : "info";
}

function offsetLabel(item: { offsetVsPrevYear: number | null }): string {
  if (item.offsetVsPrevYear === null) return "无对比年份";
  if (item.offsetVsPrevYear === 0) return "与上一年持平";
  return item.offsetVsPrevYear < 0 ? `比上一年提前 ${Math.abs(item.offsetVsPrevYear)} 天` : `比上一年推迟 ${item.offsetVsPrevYear} 天`;
}
</script>

<template>
  <div class="compare">
    <article
      v-for="item in result.years"
      :key="item.year"
      class="compare__column card"
      :class="{ 'compare__column--empty': !item.onsetDate }"
    >
      <header class="compare__header">
        <span class="compare__year">{{ item.year }}</span>
        <el-tag v-if="item.onsetDate" size="small" :type="offsetType(item)">{{ offsetLabel(item) }}</el-tag>
      </header>

      <template v-if="item.onsetDate">
        <p class="compare__date">{{ dayjs(item.onsetDate).format("YYYY 年 M 月 D 日") }}</p>
        <p class="compare__doy muted">当年第 {{ item.dayOfYear }} 天</p>

        <button
          v-if="item.photo"
          type="button"
          class="compare__photo"
          :aria-label="`查看 ${item.year} 年照片`"
          @click="item.observationId && emit('openObservation', item.observationId)"
        >
          <img :src="item.photo.thumbUrl" :alt="`${item.year} 年观察照片`" loading="lazy" />
        </button>
        <div v-else class="compare__photo compare__photo--empty muted">无照片</div>

        <p v-if="item.notes" class="compare__notes">{{ item.notes }}</p>
        <p v-else class="compare__notes muted">无文字记录</p>

        <p class="compare__meta muted">
          <span v-if="item.phenophase">阶段：{{ item.phenophase.name }}</span>
          <span v-if="item.observationsInYear > 1"> · 该年共 {{ item.observationsInYear }} 条</span>
        </p>
      </template>

      <template v-else>
        <p class="compare__empty-text muted">该年无记录</p>
        <el-button type="primary" plain class="touch-target" @click="emit('createFor', item.year)">
          去补录
        </el-button>
      </template>
    </article>
  </div>
</template>

<style scoped>
.compare {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.compare__column {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  min-height: 260px;
}

.compare__column--empty {
  border-style: dashed;
  align-items: flex-start;
  justify-content: center;
}

.compare__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.compare__year {
  font-size: 18px;
  font-weight: 600;
}

.compare__date {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.compare__doy {
  margin: 0;
  font-size: 13px;
}

.compare__photo {
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  background: #eef0ec;
  cursor: pointer;
  aspect-ratio: 4 / 3;
}

.compare__photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.compare__photo--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: default;
}

.compare__notes {
  margin: 0;
  font-size: 14px;
  white-space: pre-wrap;
}

.compare__meta {
  margin: 0;
  font-size: 13px;
}

.compare__empty-text {
  margin: 0;
}

@media (max-width: 767px) {
  .compare {
    grid-template-columns: 1fr;
  }
}
</style>
