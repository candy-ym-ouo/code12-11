<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import ObservationForm from "@/components/ObservationForm.vue";

const route = useRoute();
const router = useRouter();

const observationId = computed(() => (typeof route.params.id === "string" ? route.params.id : undefined));

async function onSaved(id: string) {
  await router.replace({ name: "observation-detail", params: { id } });
}
</script>

<template>
  <div class="page">
    <ObservationForm :observation-id="observationId" @saved="onSaved" />
  </div>
</template>
