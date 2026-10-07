<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Share } from "@element-plus/icons-vue";
import { siteApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import { useSiteStore } from "@/stores/site";
import type { ShareLink } from "@/types/models";

const siteStore = useSiteStore();
const includeArchived = ref(true);
const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);

const shareDialogVisible = ref(false);
const shareSiteId = ref<string | null>(null);
const shareLinks = ref<ShareLink[]>([]);
const shareForm = reactive({ scope: "TIMELINE" as "TIMELINE" | "TIMELINE_AND_COMPARE", expiresInDays: 30 });

const form = reactive({
  name: "",
  latitude: undefined as number | undefined,
  longitude: undefined as number | undefined,
  elevationM: undefined as number | undefined,
  habitat: "",
  description: "",
});

async function load() {
  try {
    await siteStore.fetch(includeArchived.value);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { name: "", latitude: undefined, longitude: undefined, elevationM: undefined, habitat: "", description: "" });
  dialogVisible.value = true;
}

function openEdit(siteId: string) {
  const site = siteStore.sites.find((item) => item.id === siteId);
  if (!site) return;
  editingId.value = site.id;
  Object.assign(form, {
    name: site.name,
    latitude: site.latitude ?? undefined,
    longitude: site.longitude ?? undefined,
    elevationM: site.elevationM ?? undefined,
    habitat: site.habitat ?? "",
    description: site.description ?? "",
  });
  dialogVisible.value = true;
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning("请填写地点名称");
    return;
  }
  saving.value = true;
  const payload = {
    name: form.name.trim(),
    latitude: form.latitude ?? null,
    longitude: form.longitude ?? null,
    elevationM: form.elevationM ?? null,
    habitat: form.habitat || null,
    description: form.description || null,
  };
  try {
    if (editingId.value) {
      await siteStore.update(editingId.value, payload);
      ElMessage.success("地点已更新");
    } else {
      await siteStore.create(payload);
      ElMessage.success("地点已创建");
    }
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function archive(siteId: string) {
  try {
    await siteStore.archive(siteId);
    ElMessage.success("地点已归档");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function unarchive(siteId: string) {
  try {
    await siteStore.unarchive(siteId);
    ElMessage.success("已取消归档");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function remove(siteId: string) {
  try {
    await ElMessageBox.confirm("仅当该地点没有任何观测记录时才能删除，确定继续吗？", "删除地点", { type: "warning" });
    await siteStore.remove(siteId);
    ElMessage.success("地点已删除");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(apiErrorMessage(error));
  }
}

async function openShare(siteId: string) {
  shareSiteId.value = siteId;
  shareDialogVisible.value = true;
  try {
    shareLinks.value = await siteApi.listShares(siteId);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function createShare() {
  if (!shareSiteId.value) return;
  try {
    const link = await siteApi.createShare(shareSiteId.value, {
      scope: shareForm.scope,
      expiresInDays: shareForm.expiresInDays,
    });
    shareLinks.value.unshift(link);
    await copy(link.url);
    ElMessage.success("分享链接已生成并复制");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function revokeShare(linkId: string) {
  try {
    await siteApi.revokeShare(linkId);
    shareLinks.value = shareLinks.value.map((link) =>
      link.id === linkId ? { ...link, revokedAt: new Date().toISOString() } : link,
    );
    ElMessage.success("分享链接已撤销");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ElMessage.warning("浏览器未授权剪贴板，请手动复制链接");
  }
}

onMounted(load);
</script>

<template>
  <div class="page page--wide">
    <header class="page-header">
      <div>
        <h1 class="page-title">观察地点</h1>
        <p class="page-subtitle">同一地点的多年记录才具备可比性，建议为每个样点单独建档</p>
      </div>
      <div class="row">
        <el-checkbox v-model="includeArchived" label="显示已归档" @change="load" />
        <el-button type="primary" class="touch-target" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建地点
        </el-button>
      </div>
    </header>

    <EmptyState
      v-if="!siteStore.sites.length && !siteStore.loading"
      title="还没有观察地点"
      description="先建立一个固定样点，之后的每一条记录都可以归属到它。"
      action-text="新建地点"
      @action="openCreate"
    />

    <div v-else class="site-grid">
      <article v-for="site in siteStore.sites" :key="site.id" class="site card">
        <header class="site__header">
          <h2 class="site__name">{{ site.name }}</h2>
          <el-tag v-if="site.archivedAt" size="small" type="info">已归档</el-tag>
        </header>

        <p v-if="site.habitat" class="site__habitat muted">{{ site.habitat }}</p>
        <p v-if="site.description" class="site__description">{{ site.description }}</p>

        <dl class="site__stats">
          <div><dt>观测</dt><dd>{{ site.observationCount }} 条</dd></div>
          <div><dt>物种</dt><dd>{{ site.speciesCount }} 种</dd></div>
          <div><dt>最近记录</dt><dd>{{ site.lastObservedAt ?? "—" }}</dd></div>
        </dl>

        <p v-if="site.latitude !== null && site.longitude !== null" class="site__coords muted">
          坐标：{{ site.latitude?.toFixed(4) }}, {{ site.longitude?.toFixed(4) }}
        </p>

        <footer class="site__actions">
          <el-button size="small" @click="openEdit(site.id)">编辑</el-button>
          <el-button size="small" @click="openShare(site.id)">
            <el-icon><Share /></el-icon>
            分享
          </el-button>
          <el-button v-if="!site.archivedAt" size="small" @click="archive(site.id)">归档</el-button>
          <el-button v-else size="small" @click="unarchive(site.id)">取消归档</el-button>
          <el-button size="small" type="danger" plain @click="remove(site.id)">删除</el-button>
        </footer>
      </article>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑地点' : '新建地点'" width="min(520px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="地点名称" required>
          <el-input v-model="form.name" maxlength="60" placeholder="例如：校园银杏道" />
        </el-form-item>
        <div class="dialog-grid">
          <el-form-item label="纬度">
            <el-input-number v-model="form.latitude" :min="-90" :max="90" :precision="6" :step="0.0001" controls-position="right" />
          </el-form-item>
          <el-form-item label="经度">
            <el-input-number v-model="form.longitude" :min="-180" :max="180" :precision="6" :step="0.0001" controls-position="right" />
          </el-form-item>
          <el-form-item label="海拔（米）">
            <el-input-number v-model="form.elevationM" :min="-500" :max="9000" controls-position="right" />
          </el-form-item>
        </div>
        <el-form-item label="生境">
          <el-input v-model="form.habitat" maxlength="60" placeholder="例如：校园绿地" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="2000" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="shareDialogVisible" title="只读分享" width="min(560px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="分享范围">
          <el-radio-group v-model="shareForm.scope">
            <el-radio value="TIMELINE">仅时间线</el-radio>
            <el-radio value="TIMELINE_AND_COMPARE">时间线与对比</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="有效期">
          <el-select v-model="shareForm.expiresInDays">
            <el-option :value="7" label="7 天" />
            <el-option :value="30" label="30 天" />
            <el-option :value="90" label="90 天" />
            <el-option :value="365" label="365 天" />
          </el-select>
        </el-form-item>
        <el-button type="primary" class="touch-target" @click="createShare">生成分享链接</el-button>
      </el-form>

      <div class="share-list">
        <div v-for="link in shareLinks" :key="link.id" class="share-list__item">
          <div class="share-list__info">
            <code class="share-list__url">{{ link.url }}</code>
            <span class="muted">
              到期 {{ dayjs(link.expiresAt).format("YYYY-MM-DD") }} · 访问 {{ link.viewCount }} 次
              <template v-if="link.revokedAt">· 已撤销</template>
            </span>
          </div>
          <div class="row">
            <el-button size="small" @click="copy(link.url)">复制</el-button>
            <el-button size="small" type="danger" plain :disabled="Boolean(link.revokedAt)" @click="revokeShare(link.id)">
              撤销
            </el-button>
          </div>
        </div>
        <p v-if="!shareLinks.length" class="muted">还没有分享链接</p>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.page-header .page-subtitle {
  margin-bottom: 0;
}

.site-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.site {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
}

.site__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.site__name {
  margin: 0;
  font-size: 16px;
}

.site__habitat,
.site__coords {
  margin: 0;
  font-size: 13px;
}

.site__description {
  margin: 0;
  font-size: 14px;
}

.site__stats {
  display: flex;
  gap: 18px;
  margin: 8px 0;
}

.site__stats div {
  display: flex;
  flex-direction: column;
}

.site__stats dt {
  font-size: 12px;
  color: var(--color-text-muted);
}

.site__stats dd {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.site__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: auto;
}

.site__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.share-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}

.share-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  flex-wrap: wrap;
}

.share-list__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.share-list__url {
  font-size: 12px;
  word-break: break-all;
}

@media (max-width: 767px) {
  .dialog-grid {
    grid-template-columns: 1fr;
  }
}
</style>
