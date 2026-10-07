<script setup lang="ts">
import { computed } from "vue";
import dayjs from "dayjs";
import { KIND_LABELS, type Observation, type Photo } from "@/types/models";

const props = defineProps<{ observation: Observation }>();
const emit = defineEmits<{
  open: [id: string];
  openPhotos: [photos: Photo[], index: number];
}>();

const visiblePhotos = computed(() => props.observation.photos.slice(0, 3));
const extraPhotos = computed(() => Math.max(props.observation.photos.length - visiblePhotos.value.length, 0));
const dateLabel = computed(() => dayjs(props.observation.observationDate).format("M 月 D 日"));
const description = computed(() => props.observation.notes ?? props.observation.impactNotes ?? "");
</script>

<template>
  <article class="item card" @click="emit('open', observation.id)">
    <div class="item__rail" aria-hidden="true">
      <span class="item__dot" :style="{ background: observation.phenophase?.color ?? '#3F6F52' }"></span>
    </div>

    <div class="item__body">
      <header class="item__header">
        <span class="item__date">{{ dateLabel }}</span>
        <el-tag size="small" effect="plain">{{ KIND_LABELS[observation.kind] }}</el-tag>
        <el-tag v-if="observation.status === 'DRAFT'" size="small" type="warning" effect="light">草稿</el-tag>
        <span class="spacer"></span>
        <span v-if="observation.species" class="item__species">{{ observation.species.commonName }}</span>
      </header>

      <h3 v-if="observation.title" class="item__title">{{ observation.title }}</h3>

      <p class="item__meta muted">
        <span>{{ observation.site.name }}</span>
        <span v-if="observation.phenophase">· {{ observation.phenophase.name }}</span>
        <span v-if="observation.temperatureC !== null">· {{ observation.temperatureC }}℃</span>
      </p>

      <p v-if="description" class="item__notes">{{ description }}</p>

      <div v-if="visiblePhotos.length" class="item__photos" role="list">
        <button
          v-for="(photo, index) in visiblePhotos"
          :key="photo.id"
          type="button"
          class="item__photo"
          :aria-label="`查看第 ${index + 1} 张照片`"
          @click.stop="emit('openPhotos', observation.photos, index)"
        >
          <img :src="photo.thumbUrl" :alt="`${observation.species?.commonName ?? '观察'} ${observation.observationDate}`" loading="lazy" decoding="async" />
        </button>
        <span v-if="extraPhotos" class="item__photo-more">+{{ extraPhotos }}</span>
      </div>

      <footer v-if="observation.tags.length" class="item__tags">
        <el-tag
          v-for="tag in observation.tags"
          :key="tag.id"
          size="small"
          effect="light"
          :style="{ borderColor: tag.color, color: tag.color }"
        >
          {{ tag.name }}
        </el-tag>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.item {
  position: relative;
  display: flex;
  padding: 14px 16px 14px 0;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.item:hover {
  border-color: var(--color-primary);
}

.item__rail {
  position: relative;
  width: 40px;
  flex: 0 0 40px;
}

.item__dot {
  position: absolute;
  top: 20px;
  left: 16px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--color-surface);
}

.item__body {
  flex: 1;
  min-width: 0;
}

.item__header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.item__date {
  font-weight: 600;
}

.item__species {
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
}

.item__title {
  margin: 6px 0 0;
  font-size: 15px;
  font-weight: 600;
}

.item__meta {
  margin: 4px 0 0;
  font-size: 13px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.item__notes {
  margin: 8px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 14px;
  color: #3a4245;
  white-space: pre-wrap;
}

.item__photos {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.item__photo {
  padding: 0;
  width: 88px;
  height: 66px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  background: #eef0ec;
  cursor: pointer;
}

.item__photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.item__photo-more {
  font-size: 13px;
  color: var(--color-text-muted);
}

.item__tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}
</style>
