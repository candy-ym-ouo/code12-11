<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { Download } from "@element-plus/icons-vue";
import { authApi, downloadExport, siteApi, tagApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { KIND_LABELS, type ShareLink, type Tag } from "@/types/models";

const auth = useAuthStore();
const siteStore = useSiteStore();

const profile = reactive({ displayName: "", timezone: "Asia/Shanghai" });
const password = reactive({ currentPassword: "", newPassword: "" });
const savingProfile = ref(false);
const savingPassword = ref(false);

const exportForm = reactive({
  format: "csv" as "csv" | "json",
  siteId: "",
  range: [] as string[],
  kind: "",
});

const tags = ref<Tag[]>([]);
const newTag = reactive({ name: "", color: "#B0793A" });

const shareSiteId = ref("");
const shareLinks = ref<ShareLink[]>([]);

const timezones = ["Asia/Shanghai", "Asia/Urumqi", "Asia/Tokyo", "Europe/London", "America/New_York", "UTC"];
const kindOptions = Object.entries(KIND_LABELS);

async function loadProfile() {
  profile.displayName = auth.user?.displayName ?? "";
  profile.timezone = auth.user?.timezone ?? "Asia/Shanghai";
}

async function saveProfile() {
  if (!profile.displayName.trim()) {
    ElMessage.warning("昵称不能为空");
    return;
  }
  savingProfile.value = true;
  try {
    const user = await authApi.updateMe({ displayName: profile.displayName.trim(), timezone: profile.timezone });
    auth.user = user;
    ElMessage.success("资料已更新");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    savingProfile.value = false;
  }
}

async function savePassword() {
  if (password.newPassword.length < 10) {
    ElMessage.warning("新密码至少 10 位");
    return;
  }
  savingPassword.value = true;
  try {
    await authApi.updateMe({ currentPassword: password.currentPassword, newPassword: password.newPassword });
    password.currentPassword = "";
    password.newPassword = "";
    ElMessage.success("密码已更新，其他设备需要重新登录");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    savingPassword.value = false;
  }
}

async function runExport() {
  try {
    await downloadExport(
      {
        format: exportForm.format,
        siteId: exportForm.siteId || undefined,
        from: exportForm.range?.[0],
        to: exportForm.range?.[1],
        kind: exportForm.kind || undefined,
      },
      `nature-observations-${dayjs().format("YYYYMMDD")}.${exportForm.format}`,
    );
    ElMessage.success("导出已开始下载");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function loadTags() {
  try {
    tags.value = await tagApi.list();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function addTag() {
  if (!newTag.name.trim()) return;
  try {
    const tag = await tagApi.create(newTag.name.trim(), newTag.color);
    if (!tags.value.some((item) => item.id === tag.id)) tags.value.push(tag);
    newTag.name = "";
    ElMessage.success("标签已保存");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function removeTag(tag: Tag) {
  try {
    await ElMessageBox.confirm(`删除标签「${tag.name}」？该标签会从所有观测上移除。`, "删除标签", { type: "warning" });
    await tagApi.remove(tag.id);
    tags.value = tags.value.filter((item) => item.id !== tag.id);
  } catch (error) {
    if (error !== "cancel") ElMessage.error(apiErrorMessage(error));
  }
}

async function loadShares() {
  if (!shareSiteId.value) {
    shareLinks.value = [];
    return;
  }
  try {
    shareLinks.value = await siteApi.listShares(shareSiteId.value);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function revoke(link: ShareLink) {
  try {
    await siteApi.revokeShare(link.id);
    shareLinks.value = shareLinks.value.map((item) =>
      item.id === link.id ? { ...item, revokedAt: new Date().toISOString() } : item,
    );
    ElMessage.success("已撤销");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

onMounted(async () => {
  await Promise.all([siteStore.fetch(), loadProfile(), loadTags()]);
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1 class="page-title">设置与导出</h1>
      <p class="page-subtitle">账号、数据导出与分享链接管理</p>
    </header>

    <section class="card block">
      <h2 class="block__title">个人资料</h2>
      <el-form label-position="top">
        <el-form-item label="昵称">
          <el-input v-model="profile.displayName" maxlength="40" />
        </el-form-item>
        <el-form-item label="时区（决定「今天」的判定）">
          <el-select v-model="profile.timezone">
            <el-option v-for="zone in timezones" :key="zone" :label="zone" :value="zone" />
          </el-select>
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input :model-value="auth.user?.email" disabled />
        </el-form-item>
      </el-form>
      <el-button type="primary" :loading="savingProfile" @click="saveProfile">保存资料</el-button>
    </section>

    <section class="card block">
      <h2 class="block__title">修改密码</h2>
      <el-form label-position="top">
        <el-form-item label="当前密码">
          <el-input v-model="password.currentPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="password.newPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <el-button :loading="savingPassword" @click="savePassword">更新密码</el-button>
    </section>

    <section class="card block">
      <h2 class="block__title">数据导出</h2>
      <el-form label-position="top">
        <div class="grid">
          <el-form-item label="格式">
            <el-select v-model="exportForm.format">
              <el-option label="CSV（Excel 可直接打开）" value="csv" />
              <el-option label="JSON（含照片链接与完整字段）" value="json" />
            </el-select>
          </el-form-item>
          <el-form-item label="地点">
            <el-select v-model="exportForm.siteId" clearable placeholder="全部地点">
              <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="日期区间">
            <el-date-picker
              v-model="exportForm.range"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
            />
          </el-form-item>
          <el-form-item label="观测类型">
            <el-select v-model="exportForm.kind" clearable placeholder="全部类型">
              <el-option v-for="[value, label] in kindOptions" :key="value" :label="label" :value="value" />
            </el-select>
          </el-form-item>
        </div>
      </el-form>
      <el-button type="primary" @click="runExport">
        <el-icon><Download /></el-icon>
        导出数据
      </el-button>
    </section>

    <section class="card block">
      <h2 class="block__title">观测标签</h2>
      <div class="tags">
        <el-tag
          v-for="tag in tags"
          :key="tag.id"
          closable
          effect="light"
          :style="{ borderColor: tag.color, color: tag.color }"
          @close="removeTag(tag)"
        >
          {{ tag.name }}
        </el-tag>
        <span v-if="!tags.length" class="muted">还没有标签</span>
      </div>
      <div class="row row--wrap section-gap">
        <el-input v-model="newTag.name" placeholder="新标签名称" maxlength="20" class="tag-input" />
        <el-color-picker v-model="newTag.color" />
        <el-button @click="addTag">添加标签</el-button>
      </div>
    </section>

    <section class="card block">
      <h2 class="block__title">分享链接</h2>
      <el-select v-model="shareSiteId" placeholder="选择地点查看已生成的链接" clearable @change="loadShares">
        <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
      </el-select>

      <div class="share-list">
        <div v-for="link in shareLinks" :key="link.id" class="share-item">
          <div>
            <code class="share-item__url">{{ link.url }}</code>
            <div class="muted share-item__meta">
              到期 {{ dayjs(link.expiresAt).format("YYYY-MM-DD") }} · 访问 {{ link.viewCount }} 次
              <template v-if="link.revokedAt">· 已撤销</template>
            </div>
          </div>
          <el-button size="small" type="danger" plain :disabled="Boolean(link.revokedAt)" @click="revoke(link)">
            撤销
          </el-button>
        </div>
        <p v-if="shareSiteId && !shareLinks.length" class="muted">该地点还没有分享链接</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}

.block {
  padding: 16px;
  margin-bottom: 14px;
}

.block__title {
  margin: 0 0 12px;
  font-size: 16px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-input {
  width: 220px;
}

.share-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.share-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  flex-wrap: wrap;
}

.share-item__url {
  font-size: 12px;
  word-break: break-all;
}

.share-item__meta {
  font-size: 12px;
}

@media (max-width: 767px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
