<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { storeToRefs } from "pinia";
import EmptyState from "@/components/EmptyState.vue";
import ObservationFilterBar from "@/components/ObservationFilterBar.vue";
import TimelineGroup from "@/components/TimelineGroup.vue";
import { apiErrorMessage } from "@/api/client";
import { useObservationStore } from "@/stores/observation";
import { useUiStore } from "@/stores/ui";

const router = useRouter();
const observationStore = useObservationStore();
const ui = useUiStore();
const { groups, loading, loaded, emptyReason, hasMore } = storeToRefs(observationStore);

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const showInitialEmpty = computed(
  () => loaded.value && observationStore.items.length === 0 && emptyReason.value === "NO_DATA",
);
const showFilteredEmpty = computed(
  () => loaded.value && observationStore.items.length === 0 && emptyReason.value === "FILTERED_OUT",
);

async function load() {
  try {
    await observationStore.reload();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

function openObservation(id: string) {
  void router.push({ name: "observation-detail", params: { id } });
}

onMounted(async () => {
  await load();
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && hasMore.value && !loading.value) {
        void observationStore.loadMore().catch((error) => ElMessage.error(apiErrorMessage(error)));
      }
    },
    { rootMargin: "200px" },
  );
  if (sentinel.value) observer.observe(sentinel.value);
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="page">
    <header class="timeline-header">
      <div>
        <h1 class="page-title">观察时间线</h1>
        <p class="page-subtitle">按时间回看同一地点的物候变化</p>
      </div>
      <el-button type="primary" class="touch-target" @click="router.push({ name: 'observation-new' })">
        <el-icon><Plus /></el-icon>
        新增记录
      </el-button>
    </header>

    <ObservationFilterBar />

    <div class="timeline-body">
      <template v-if="groups.length">
        <TimelineGroup
          v-for="group in groups"
          :key="group.year"
          :year="group.year"
          :months="group.months"
          @open="openObservation"
          @open-photos="(photos, index) => ui.openLightbox(photos, index)"
        />
      </template>

      <div v-if="loading && !loaded" class="timeline-skeleton">
        <el-skeleton :rows="3" animated />
        <el-skeleton :rows="3" animated />
        <el-skeleton :rows="3" animated />
      </div>

      <EmptyState
        v-if="showInitialEmpty"
        title="还没有任何观察记录"
        description="先建一个观察地点，再记录第一条发芽或鸣叫信息。"
        action-text="记录第一次观察"
        @action="router.push({ name: 'observation-new' })"
      />

      <EmptyState
        v-if="showFilteredEmpty"
        title="当前筛选条件下没有记录"
        description="可以换个地点、物种或年份再试试。"
        action-text="重新加载"
        @action="load"
      />

      <div ref="sentinel" class="timeline-sentinel">
        <span v-if="loading && loaded" class="muted">加载中…</span>
        <span v-else-if="!hasMore && groups.length" class="muted">已经到底了</span>
      </div>
    </div>

    <el-button
      class="timeline-fab touch-target"
      type="primary"
      circle
      aria-label="新增观察记录"
      @click="router.push({ name: 'observation-new' })"
    >
      <el-icon><Plus /></el-icon>
    </el-button>
  </div>
</template>

<style scoped>
.timeline-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.timeline-header .page-subtitle {
  margin-bottom: 0;
}

.timeline-body {
  margin-top: 16px;
}

.timeline-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.timeline-sentinel {
  display: flex;
  justify-content: center;
  padding: 16px 0 8px;
  font-size: 13px;
}

.timeline-fab {
  position: fixed;
  right: 20px;
  bottom: 24px;
  display: none;
  z-index: 30;
}

@media (max-width: 767px) {
  .timeline-header :deep(.el-button) {
    display: none;
  }
  .timeline-fab {
    display: inline-flex;
  }
}
</style>
