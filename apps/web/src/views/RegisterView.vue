<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { apiErrorMessage } from "@/api/client";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();

const form = reactive({ email: "", password: "", confirm: "", displayName: "" });
const loading = ref(false);

function validate(): string | null {
  if (!form.email.includes("@")) return "请输入合法邮箱";
  if (form.password.length < 10) return "密码至少 10 位";
  if (!/[a-z]/.test(form.password) || !/[A-Z]/.test(form.password) || !/\d/.test(form.password)) {
    return "密码需包含大小写字母与数字";
  }
  if (form.password !== form.confirm) return "两次输入的密码不一致";
  if (!form.displayName.trim()) return "请填写昵称";
  return null;
}

async function submit() {
  const message = validate();
  if (message) {
    ElMessage.warning(message);
    return;
  }
  loading.value = true;
  try {
    await auth.register(form.email, form.password, form.displayName.trim());
    ElMessage.success("注册成功，开始你的第一次观察吧");
    await router.replace("/");
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
      <h1 class="auth__title">注册账号</h1>
      <p class="auth__subtitle muted">数据默认私有，只有你本人可见</p>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="昵称">
          <el-input v-model="form.displayName" maxlength="40" placeholder="例如：小林" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" type="email" autocomplete="email" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-button type="primary" class="auth__submit touch-target" :loading="loading" @click="submit">注册</el-button>
      </el-form>

      <p class="auth__footer">
        已有账号？
        <router-link to="/login">去登录</router-link>
      </p>
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
  max-width: 420px;
  padding: 28px 24px;
}

.auth__title {
  margin: 0 0 4px;
  font-size: 22px;
}

.auth__subtitle {
  margin: 0 0 20px;
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
</style>
