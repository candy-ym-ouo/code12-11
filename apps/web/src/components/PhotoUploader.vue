<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { Delete, Plus } from "@element-plus/icons-vue";
import { observationApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import type { Photo } from "@/types/models";

const props = withDefaults(
  defineProps<{
    observationId?: string;
    photos?: Photo[];
    files?: File[];
    max?: number;
  }>(),
  { photos: () => [], files: () => [], max: 9 },
);

const emit = defineEmits<{
  "update:files": [files: File[]];
  uploaded: [];
  removed: [photoId: string];
}>();

const uploading = ref(false);
const previews = ref<string[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const total = computed(() => props.photos.length + props.files.length);

function pick() {
  fileInput.value?.click();
}

function onSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = Array.from(input.files ?? []);
  input.value = "";
  if (!selected.length) return;

  const remaining = props.max - total.value;
  if (remaining <= 0) {
    ElMessage.warning(`最多上传 ${props.max} 张照片`);
    return;
  }

  const accepted = selected.slice(0, remaining);
  if (selected.length > remaining) {
    ElMessage.warning(`已达上限，仅添加前 ${remaining} 张`);
  }

  for (const file of accepted) previews.value.push(URL.createObjectURL(file));
  emit("update:files", [...props.files, ...accepted]);
}

function removePending(index: number) {
  const url = previews.value[index];
  if (url) URL.revokeObjectURL(url);
  previews.value.splice(index, 1);
  emit(
    "update:files",
    props.files.filter((_, currentIndex) => currentIndex !== index),
  );
}

async function uploadNow() {
  if (!props.observationId || !props.files.length) return;
  uploading.value = true;
  try {
    const result = await observationApi.uploadPhotos(props.observationId, props.files);
    if (result.succeeded.length) ElMessage.success(`已上传 ${result.succeeded.length} 张照片`);
    for (const item of result.failed) ElMessage.error(`${item.originalName}：${item.reason}`);
    for (const url of previews.value) URL.revokeObjectURL(url);
    previews.value = [];
    emit("update:files", []);
    emit("uploaded");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    uploading.value = false;
  }
}

async function removeExisting(photoId: string) {
  try {
    await observationApi.removePhoto(photoId);
    emit("removed", photoId);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

onUnmounted(() => {
  for (const url of previews.value) URL.revokeObjectURL(url);
});

defineExpose({ uploadNow });
</script>

<template>
  <div class="uploader">
    <div class="uploader__grid">
      <div v-for="photo in photos" :key="photo.id" class="uploader__tile">
        <img :src="photo.thumbUrl" alt="已上传照片" loading="lazy" />
        <el-button
          class="uploader__remove"
          size="small"
          circle
          :icon="Delete"
          aria-label="删除照片"
          @click="removeExisting(photo.id)"
        />
      </div>

      <div v-for="(url, index) in previews" :key="url" class="uploader__tile uploader__tile--pending">
        <img :src="url" alt="待上传照片" />
        <el-button
          class="uploader__remove"
          size="small"
          circle
          :icon="Delete"
          aria-label="移除照片"
          @click="removePending(index)"
        />
      </div>

      <button v-if="total < max" type="button" class="uploader__add" aria-label="添加照片" @click="pick">
        <el-icon><Plus /></el-icon>
        <span>添加照片</span>
      </button>
    </div>

    <p class="uploader__hint muted">
      最多 {{ max }} 张，单张不超过 10MB；上传后自动压缩并生成缩略图。
    </p>

    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
      multiple
      @change="onSelect"
    />
  </div>
</template>

<style scoped>
.uploader__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.uploader__tile {
  position: relative;
  width: 104px;
  height: 80px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  background: #eef0ec;
}

.uploader__tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.uploader__tile--pending {
  border-style: dashed;
}

.uploader__remove {
  position: absolute;
  top: 4px;
  right: 4px;
}

.uploader__add {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 104px;
  height: 80px;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
}

.uploader__add:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.uploader__hint {
  margin: 10px 0 0;
  font-size: 13px;
}
</style>
