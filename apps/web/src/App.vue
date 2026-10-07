<script setup lang="ts">
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import PhotoLightbox from "@/components/PhotoLightbox.vue";
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <router-view />
    <PhotoLightbox />
  </ElConfigProvider>
</template>
