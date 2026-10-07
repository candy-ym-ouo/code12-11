<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Warning } from "@element-plus/icons-vue";
import { transectApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import type { Transect } from "@/types/transect";

const router = useRouter();
const loading = ref(false);
const includeArchived = ref(false);
const transects = ref<Transect[]>([]);
const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);

const form = reactive({ name: "", code: "", description: "" });

async function load() {
  loading.value = true;
  try {
    transects.value = await transectApi.list(includeArchived.value);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { name: "", code: "", description: "" });
  dialogVisible.value = true;
}

function openEdit(t: Transect) {
  editingId.value = t.id;
  Object.assign(form, { name: t.name, code: t.code ?? "", description: t.description ?? "" });
  dialogVisible.value = true;
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning("请填写路线名称");
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      description: form.description.trim() || null,
    };
    if (editingId.value) await transectApi.update(editingId.value, payload);
    else await transectApi.create(payload);
    ElMessage.success(editingId.value ? "样线已更新" : "样线已创建");
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function setArchived(t: Transect, archived: boolean) {
  try {
    if (archived) await transectApi.archive(t.id);
    else await transectApi.unarchive(t.id);
    ElMessage.success(archived ? "样线已归档" : "已取消归档");
    await load();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function remove(t: Transect) {
  try {
    await ElMessageBox.confirm(
      `删除样线「${t.name}」将同时删除其全部分段、录入与冲突记录，且不可恢复，确定继续吗？`,
      "删除样线",
      { type: "warning" },
    );
    await transectApi.remove(t.id);
    ElMessage.success("样线已删除");
    await load();
  } catch (error) {
    if (error !== "cancel") ElMessage.error(apiErrorMessage(error));
  }
}

onMounted(load);
</script>

<template>
  <div class="page page--wide">
    <header class="page-header">
      <div>
        <h1 class="page-title">样线调查</h1>
        <p class="page-subtitle">
          沿固定路线分段记录物种与数量；分段重叠或事后补录会自动并入统一时间线，并生成待复核冲突。
        </p>
      </div>
      <div class="row">
        <el-checkbox v-model="includeArchived" label="显示已归档" @change="load" />
        <el-button type="primary" class="touch-target" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建样线
        </el-button>
      </div>
    </header>

    <EmptyState
      v-if="!transects.length && !loading"
      title="还没有调查样线"
      description="先建立一条固定路线并划分分段，之后就可以沿路线分段录入物种与数量。"
      action-text="新建样线"
      @action="openCreate"
    />

    <div v-else v-loading="loading" class="transect-grid">
      <article v-for="t in transects" :key="t.id" class="transect card" :class="{ 'is-archived': t.archivedAt }">
        <header class="transect__header">
          <h2 class="transect__name">
            {{ t.name }}
            <span v-if="t.code" class="transect__code">{{ t.code }}</span>
          </h2>
          <el-tag v-if="t.archivedAt" size="small" type="info">已归档</el-tag>
          <el-tag v-else-if="t.pendingConflictCount > 0" size="small" type="warning">
            <el-icon style="vertical-align: -2px"><Warning /></el-icon>
            {{ t.pendingConflictCount }} 条待复核
          </el-tag>
        </header>

        <p v-if="t.description" class="transect__description">{{ t.description }}</p>

        <dl class="transect__stats">
          <div><dt>总长</dt><dd>{{ t.lengthM }} m</dd></div>
          <div><dt>分段</dt><dd>{{ t.segmentCount }} 段</dd></div>
          <div><dt>录入</dt><dd>{{ t.entryCount }} 条</dd></div>
          <div><dt>最近观测</dt><dd>{{ t.lastObservedAt ? dayjs(t.lastObservedAt).format("MM-DD HH:mm") : "—" }}</dd></div>
        </dl>

        <footer class="transect__actions">
          <el-button type="primary" size="small" @click="router.push(`/transects/${t.id}`)">进入调查</el-button>
          <el-button size="small" @click="openEdit(t)">编辑</el-button>
          <el-button v-if="!t.archivedAt" size="small" @click="setArchived(t, true)">归档</el-button>
          <el-button v-else size="small" @click="setArchived(t, false)">取消归档</el-button>
          <el-button size="small" type="danger" plain @click="remove(t)">删除</el-button>
        </footer>
      </article>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑样线' : '新建样线'" width="min(520px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="路线名称" required>
          <el-input v-model="form.name" maxlength="60" placeholder="例如：环湖步道样线" />
        </el-form-item>
        <el-form-item label="路线编号">
          <el-input v-model="form.code" maxlength="30" placeholder="例如：T-01（选填）" />
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
  </div>
</template>

<style scoped>
.transect-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.transect.is-archived {
  opacity: 0.7;
}

.transect__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.transect__name {
  margin: 0;
  font-size: 17px;
}

.transect__code {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.transect__description {
  margin: 8px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.transect__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 12px 0;
}

.transect__stats dt {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.transect__stats dd {
  margin: 2px 0 0;
  font-weight: 600;
}

.transect__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
