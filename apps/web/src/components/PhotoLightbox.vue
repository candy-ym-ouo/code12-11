<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { storeToRefs } from "pinia";
import { useUiStore } from "@/stores/ui";
import { ArrowLeft, ArrowRight } from "@element-plus/icons-vue";

const ui = useUiStore();
const { lightboxOpen, lightboxPhotos, lightboxIndex } = storeToRefs(ui);

const current = computed(() => lightboxPhotos.value[lightboxIndex.value] ?? null);

function next() {
  if (!lightboxPhotos.value.length) return;
  lightboxIndex.value = (lightboxIndex.value + 1) % lightboxPhotos.value.length;
}

function previous() {
  if (!lightboxPhotos.value.length) return;
  lightboxIndex.value = (lightboxIndex.value - 1 + lightboxPhotos.value.length) % lightboxPhotos.value.length;
}

function onKeydown(event: KeyboardEvent) {
  if (!lightboxOpen.value) return;
  if (event.key === "ArrowRight") next();
  if (event.key === "ArrowLeft") previous();
  if (event.key === "Escape") ui.closeLightbox();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <el-dialog
    :model-value="lightboxOpen"
    width="min(960px, 92vw)"
    :show-close="true"
    append-to-body
    @update:model-value="ui.closeLightbox()"
  >
    <div v-if="current" class="lightbox">
      <img class="lightbox__image" :src="current.displayUrl" alt="观察照片" />
      <div class="lightbox__bar">
        <el-button :icon="ArrowLeft" circle aria-label="上一张" @click="previous" />
        <span class="lightbox__counter">{{ lightboxIndex + 1 }} / {{ lightboxPhotos.length }}</span>
        <el-button :icon="ArrowRight" circle aria-label="下一张" @click="next" />
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.lightbox {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lightbox__image {
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
  background: #1f2422;
  border-radius: 6px;
}

.lightbox__bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.lightbox__counter {
  color: var(--color-text-muted);
  font-size: 14px;
}
</style>
