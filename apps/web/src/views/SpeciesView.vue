<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Close, Delete, Plus } from "@element-plus/icons-vue";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import { useSpeciesStore } from "@/stores/species";
import { CATEGORY_LABELS, type Phenophase, type Species, type SpeciesCategory } from "@/types/models";

const speciesStore = useSpeciesStore();

const tab = ref<"mine" | "preset">("mine");
const category = ref<SpeciesCategory | "">("");
const keyword = ref("");
const saving = ref(false);

const dialogVisible = ref(false);
const editing = ref<Species | null>(null);
const form = reactive({
  category: "PLANT" as SpeciesCategory,
  commonName: "",
  scientificName: "",
  family: "",
  description: "",
});
const phaseDraft = reactive({ name: "", color: "#3F6F52" });
const phases = ref<Array<{ id?: string; name: string; color: string; isDefault: boolean }>>([]);

const categoryOptions = Object.entries(CATEGORY_LABELS) as Array<[SpeciesCategory, string]>;

const currentList = computed(() => {
  const list = tab.value === "mine" ? speciesStore.mine : speciesStore.presets;
  return list.filter((item) => {
    const matchCategory = !category.value || item.category === category.value;
    const text = keyword.value.trim();
    const matchKeyword =
      !text ||
      item.commonName.includes(text) ||
      (item.scientificName ?? "").includes(text) ||
      (item.family ?? "").includes(text);
    return matchCategory && matchKeyword;
  });
});

async function load() {
  try {
    await speciesStore.fetch();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, { category: "PLANT", commonName: "", scientificName: "", family: "", description: "" });
  phases.value = [];
  dialogVisible.value = true;
}

function openEdit(species: Species) {
  editing.value = species;
  Object.assign(form, {
    category: species.category,
    commonName: species.commonName,
    scientificName: species.scientificName ?? "",
    family: species.family ?? "",
    description: species.description ?? "",
  });
  phases.value = species.phenophases.map((phase) => ({
    id: phase.id,
    name: phase.name,
    color: phase.color,
    isDefault: phase.isDefault,
  }));
  dialogVisible.value = true;
}

function addPhase() {
  if (!phaseDraft.name.trim()) return;
  phases.value.push({ name: phaseDraft.name.trim(), color: phaseDraft.color, isDefault: phases.value.length === 0 });
  phaseDraft.name = "";
}

function removePhase(index: number) {
  phases.value.splice(index, 1);
}

async function save() {
  if (!form.commonName.trim()) {
    ElMessage.warning("请填写物种名称");
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await speciesStore.update(editing.value.id, {
        category: form.category,
        commonName: form.commonName.trim(),
        scientificName: form.scientificName || null,
        family: form.family || null,
        description: form.description || null,
      });
      const newPhases = phases.value.filter((phase) => !phase.id);
      for (const phase of newPhases) {
        await speciesStore.addPhenophase(editing.value.id, {
          name: phase.name,
          color: phase.color,
          isDefault: phase.isDefault,
        });
      }
      ElMessage.success("物种已更新");
    } else {
      await speciesStore.create({
        category: form.category,
        commonName: form.commonName.trim(),
        scientificName: form.scientificName || null,
        family: form.family || null,
        description: form.description || null,
        phenophases: phases.value.map((phase) => ({
          name: phase.name,
          color: phase.color,
          isDefault: phase.isDefault,
        })),
      });
      ElMessage.success("物种已创建");
    }
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function importPreset(species: Species) {
  try {
    await speciesStore.importPreset(species.id);
    ElMessage.success(`已将「${species.commonName}」加入我的物种`);
    tab.value = "mine";
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function archive(species: Species) {
  try {
    await speciesStore.archive(species.id);
    ElMessage.success("物种已归档");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function removePhaseFromSpecies(species: Species, phase: Phenophase) {
  try {
    await ElMessageBox.confirm(`确定删除物候阶段「${phase.name}」吗？`, "删除阶段", { type: "warning" });
    await speciesStore.removePhenophase(species.id, phase.id);
    ElMessage.success("阶段已删除");
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
        <h1 class="page-title">物种与物候阶段</h1>
        <p class="page-subtitle">阶段顺序与颜色会直接体现在时间线和对比页上</p>
      </div>
      <el-button type="primary" class="touch-target" @click="openCreate">
        <el-icon><Plus /></el-icon>
        新建物种
      </el-button>
    </header>

    <section class="toolbar card">
      <el-radio-group v-model="tab">
        <el-radio-button value="mine">我的物种（{{ speciesStore.mine.length }}）</el-radio-button>
        <el-radio-button value="preset">系统预置库（{{ speciesStore.presets.length }}）</el-radio-button>
      </el-radio-group>
      <div class="spacer"></div>
      <el-select v-model="category" placeholder="全部类别" clearable class="toolbar__select">
        <el-option v-for="[value, label] in categoryOptions" :key="value" :label="label" :value="value" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜索名称 / 学名" clearable class="toolbar__input" />
    </section>

    <EmptyState
      v-if="!currentList.length"
      :title="tab === 'mine' ? '还没有个人物种' : '没有匹配的预置物种'"
      :description="tab === 'mine' ? '可以从系统预置库导入，也可以直接新建。' : '换个关键词或类别试试。'"
      :action-text="tab === 'mine' ? '切换到预置库' : ''"
      @action="tab = 'preset'"
    />

    <div v-else class="species-grid">
      <article v-for="species in currentList" :key="species.id" class="species card">
        <header class="species__header">
          <div>
            <h2 class="species__name">{{ species.commonName }}</h2>
            <p v-if="species.scientificName" class="species__latin muted">{{ species.scientificName }}</p>
          </div>
          <el-tag size="small" effect="plain">{{ CATEGORY_LABELS[species.category] }}</el-tag>
        </header>

        <p v-if="species.family" class="species__family muted">{{ species.family }}</p>
        <p v-if="species.description" class="species__description">{{ species.description }}</p>

        <div class="species__phases">
          <div v-for="phase in species.phenophases" :key="phase.id" class="species__phase">
            <span class="species__phase-dot" :style="{ background: phase.color }"></span>
            <span>{{ phase.name }}</span>
            <el-button
              v-if="tab === 'mine'"
              size="small"
              text
              :icon="Close"
              :aria-label="`删除阶段 ${phase.name}`"
              @click="removePhaseFromSpecies(species, phase)"
            />
          </div>
          <span v-if="!species.phenophases.length" class="muted">尚未配置物候阶段</span>
        </div>

        <footer class="species__actions">
          <template v-if="tab === 'mine'">
            <el-button size="small" @click="openEdit(species)">编辑 / 添加阶段</el-button>
            <el-button size="small" type="danger" plain @click="archive(species)">归档</el-button>
            <span v-if="species._count" class="muted species__count">被 {{ species._count.observations }} 条观测引用</span>
          </template>
          <el-button v-else size="small" type="primary" plain @click="importPreset(species)">
            添加到我的物种
          </el-button>
        </footer>
      </article>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editing ? '编辑物种' : '新建物种'"
      width="min(560px, 92vw)"
    >
      <el-form label-position="top">
        <el-form-item label="类别" required>
          <el-select v-model="form.category">
            <el-option v-for="[value, label] in categoryOptions" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="物种名称" required>
          <el-input v-model="form.commonName" maxlength="60" placeholder="例如：银杏" />
        </el-form-item>
        <div class="dialog-grid">
          <el-form-item label="学名">
            <el-input v-model="form.scientificName" maxlength="120" placeholder="Ginkgo biloba" />
          </el-form-item>
          <el-form-item label="科">
            <el-input v-model="form.family" maxlength="60" placeholder="银杏科" />
          </el-form-item>
        </div>
        <el-form-item label="识别要点">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="1000" show-word-limit />
        </el-form-item>

        <el-form-item label="物候阶段">
          <div class="phase-editor">
            <div v-for="(phase, index) in phases" :key="`${phase.id ?? 'new'}-${index}`" class="phase-editor__row">
              <span class="species__phase-dot" :style="{ background: phase.color }"></span>
              <span>{{ phase.name }}</span>
              <el-tag v-if="phase.isDefault" size="small" type="success">默认</el-tag>
              <span class="spacer"></span>
              <el-button size="small" text :icon="Delete" aria-label="删除阶段" @click="removePhase(index)" />
            </div>
            <div class="phase-editor__add">
              <el-input v-model="phaseDraft.name" placeholder="新阶段名称，如：展叶" maxlength="30" />
              <el-color-picker v-model="phaseDraft.color" />
              <el-button @click="addPhase">添加</el-button>
            </div>
          </div>
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

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.toolbar__select {
  width: 150px;
}

.toolbar__input {
  width: 200px;
}

.species-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.species {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
}

.species__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.species__name {
  margin: 0;
  font-size: 16px;
}

.species__latin {
  margin: 0;
  font-size: 12px;
  font-style: italic;
}

.species__family,
.species__description {
  margin: 0;
  font-size: 13px;
}

.species__phases {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 6px 0;
  font-size: 13px;
}

.species__phase {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.species__phase-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.species__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 8px;
}

.species__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.species__count {
  font-size: 12px;
}

.dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.phase-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.phase-editor__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.phase-editor__add {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 767px) {
  .dialog-grid {
    grid-template-columns: 1fr;
  }
  .toolbar__select,
  .toolbar__input {
    width: 100%;
  }
}
</style>
