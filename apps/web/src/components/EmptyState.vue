<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    actionText?: string;
  }>(),
  { description: "", actionText: "" },
);

defineEmits<{ action: [] }>();
</script>

<template>
  <div class="empty">
    <div class="empty__dot" aria-hidden="true"></div>
    <h3 class="empty__title">{{ title }}</h3>
    <p v-if="description" class="empty__description">{{ description }}</p>
    <el-button v-if="actionText" type="primary" class="touch-target" @click="$emit('action')">
      {{ actionText }}
    </el-button>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 20px;
  text-align: center;
  background: var(--color-surface);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-card);
}

.empty__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  box-shadow: inset 0 0 0 3px var(--color-primary);
}

.empty__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.empty__description {
  margin: 0 0 6px;
  max-width: 420px;
  color: var(--color-text-muted);
  font-size: 14px;
}
</style>
