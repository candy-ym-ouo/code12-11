<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { apiErrorMessage } from "@/api/client";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const form = reactive({ email: "", password: "" });
const loading = ref(false);

async function submit() {
  if (!form.email || !form.password) {
    ElMessage.warning("请填写邮箱和密码");
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.email, form.password);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await router.replace(redirect);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth">
    <section class="auth__panel card">
      <div class="auth__brand">
        <span class="auth__mark" aria-hidden="true"></span>
        <h1 class="auth__title">自然观察时间线</h1>
        <p class="auth__subtitle muted">记录同一地点的物候变化，并按年份对比</p>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="邮箱">
          <el-input v-model="form.email" type="email" autocomplete="email" placeholder="you@example.com" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" autocomplete="current-password" show-password />
        </el-form-item>
        <el-button type="primary" class="auth__submit touch-target" :loading="loading" @click="submit">登录</el-button>
      </el-form>

      <p class="auth__footer">
        还没有账号？
        <router-link to="/register">立即注册</router-link>
      </p>

      <p class="auth__hint muted">演示账号：demo@nature.local / Nature#2025</p>
    </section>
  </div>
</template>

<style scoped>
.auth {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 24px 16px;
  background: linear-gradient(180deg, var(--color-primary-soft), var(--color-background) 42%);
}

.auth__panel {
  width: 100%;
  max-width: 400px;
  padding: 28px 24px;
}

.auth__brand {
  text-align: center;
  margin-bottom: 20px;
}

.auth__mark {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 0 6px var(--color-primary-soft);
}

.auth__title {
  margin: 14px 0 4px;
  font-size: 22px;
}

.auth__subtitle {
  margin: 0;
  font-size: 13px;
}

.auth__submit {
  width: 100%;
}

.auth__footer {
  margin: 16px 0 0;
  text-align: center;
  font-size: 14px;
}

.auth__hint {
  margin: 10px 0 0;
  text-align: center;
  font-size: 12px;
}
</style>
