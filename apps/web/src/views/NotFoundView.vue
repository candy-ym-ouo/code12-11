<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <div class="page not-found">
    <h1 class="page-title">页面不存在</h1>
    <p class="page-subtitle">你访问的地址可能已经变更或被删除。</p>
    <el-button type="primary" class="touch-target" @click="router.push('/')">回到时间线</el-button>
  </div>
</template>

<style scoped>
.not-found {
  padding-top: 80px;
  text-align: center;
}
</style>
