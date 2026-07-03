<script setup lang="ts">
import type { NodeStatusKey, NodeTypeDefinition } from "@topo-editor/topology-shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import ModuleNav from "../components/ModuleNav.vue";
import { uploadImageAsset } from "../services/assetApi";
import { deleteNodeType, listNodeTypes, saveNodeType } from "../services/nodeTypeApi";

type NodeTypeForm = {
  id: string;
  name: string;
  category: NodeTypeDefinition["category"];
  template: string;
  icon: string;
  statusImages: Record<NodeStatusKey, string>;
  defaultWidth: number;
  defaultHeight: number;
  configJson: string;
};

const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);
const uploadingStatus = ref<NodeStatusKey | "icon" | "">("");
const dialogVisible = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const nodeTypes = ref<NodeTypeDefinition[]>([]);
const activeCategory = ref<NodeTypeDefinition["category"]>("equipment");

const categoryOptions: Array<{ label: string; value: NodeTypeDefinition["category"] }> = [
  { label: "设备", value: "equipment" },
  { label: "容器", value: "container" },
  { label: "标注", value: "annotation" },
  { label: "控件", value: "control" }
];

const statusOptions: Array<{ label: string; value: NodeStatusKey }> = [
  { label: "默认", value: "default" },
  { label: "运行", value: "running" },
  { label: "故障", value: "fault" },
  { label: "离线", value: "offline" }
];

function createEmptyStatusImages(): Record<NodeStatusKey, string> {
  return {
    default: "",
    running: "",
    fault: "",
    offline: ""
  };
}

const form = reactive<NodeTypeForm>({
  id: "",
  name: "",
  category: "equipment",
  template: "basicEquipmentTemplate",
  icon: "",
  statusImages: createEmptyStatusImages(),
  defaultWidth: 104,
  defaultHeight: 92,
  configJson: "{}"
});

const dialogTitle = computed(() => (nodeTypes.value.some((item) => item.id === form.id) ? "编辑节点类型" : "新增节点类型"));
const filteredNodeTypes = computed(() => nodeTypes.value.filter((item) => item.category === activeCategory.value));
const categoryCounts = computed(() => Object.fromEntries(
  categoryOptions.map((option) => [option.value, nodeTypes.value.filter((item) => item.category === option.value).length])
) as Record<NodeTypeDefinition["category"], number>);

function isImageIcon(icon?: string) {
  return !!icon && (
    /^https?:\/\//.test(icon)
    || icon.startsWith("data:image/")
    || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(icon)
  );
}

function getFallbackSize(category: NodeTypeDefinition["category"], isGroup?: boolean) {
  if (isGroup || category === "container") return { width: 320, height: 220 };
  if (category === "annotation") return { width: 140, height: 64 };
  if (category === "control") return { width: 112, height: 42 };
  return { width: 104, height: 92 };
}

function toConfigJson(nodeType?: NodeTypeDefinition) {
  return JSON.stringify({
    description: nodeType?.description,
    isGroup: nodeType?.isGroup,
    canContain: nodeType?.canContain,
    allowNestedGroup: nodeType?.allowNestedGroup,
    ports: nodeType?.ports ?? [],
    formSchema: nodeType?.formSchema ?? [],
    bindableFields: nodeType?.bindableFields ?? [],
    connectionCapabilities: nodeType?.connectionCapabilities ?? [],
    actions: nodeType?.actions ?? []
  }, null, 2);
}

function openCreate() {
  const defaultSize = getFallbackSize("equipment");
  Object.assign(form, {
    id: "",
    name: "",
    category: "equipment",
    template: "basicEquipmentTemplate",
    icon: "",
    statusImages: createEmptyStatusImages(),
    defaultWidth: defaultSize.width,
    defaultHeight: defaultSize.height,
    configJson: toConfigJson()
  });
  dialogVisible.value = true;
}

function openEdit(nodeType: NodeTypeDefinition) {
  const defaultSize = nodeType.defaultSize ?? getFallbackSize(nodeType.category, nodeType.isGroup);
  Object.assign(form, {
    id: nodeType.id,
    name: nodeType.name,
    category: nodeType.category,
    template: nodeType.template,
    icon: nodeType.icon ?? "",
    statusImages: {
      ...createEmptyStatusImages(),
      ...(nodeType.statusImages ?? {})
    },
    defaultWidth: defaultSize.width,
    defaultHeight: defaultSize.height,
    configJson: toConfigJson(nodeType)
  });
  dialogVisible.value = true;
}

function applyCategoryDefaultSize() {
  const defaultSize = getFallbackSize(form.category);
  form.defaultWidth = defaultSize.width;
  form.defaultHeight = defaultSize.height;
}

async function load() {
  loading.value = true;
  try {
    nodeTypes.value = await listNodeTypes();
  } finally {
    loading.value = false;
  }
}

async function submit() {
  let config: Partial<NodeTypeDefinition>;
  try {
    config = JSON.parse(form.configJson) as Partial<NodeTypeDefinition>;
  } catch {
    ElMessage.error("扩展配置不是合法 JSON");
    return;
  }

  if (!form.id.trim() || !form.name.trim()) {
    ElMessage.error("请填写类型编码和名称");
    return;
  }

  if (!Number.isFinite(form.defaultWidth) || !Number.isFinite(form.defaultHeight) || form.defaultWidth <= 0 || form.defaultHeight <= 0) {
    ElMessage.error("请填写有效的默认尺寸");
    return;
  }

  const { defaultSize: _defaultSize, ...restConfig } = config;
  void _defaultSize;

  saving.value = true;
  try {
    await saveNodeType({
      ...restConfig,
      id: form.id.trim(),
      name: form.name.trim(),
      category: form.category,
      template: form.template.trim(),
      icon: form.icon.trim() || undefined,
      statusImages: Object.fromEntries(Object.entries(form.statusImages).filter(([, value]) => value.trim())) as NodeTypeDefinition["statusImages"],
      defaultSize: {
        width: Math.round(form.defaultWidth),
        height: Math.round(form.defaultHeight)
      }
    });
    ElMessage.success("节点类型已保存");
    dialogVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

function chooseImage() {
  uploadingStatus.value = "icon";
  fileInputRef.value?.click();
}

function chooseStatusImage(status: NodeStatusKey) {
  uploadingStatus.value = status;
  fileInputRef.value?.click();
}

async function handleImageChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  const isSvg = file.name.toLowerCase().endsWith(".svg");
  if (!file.type.startsWith("image/") && !isSvg) {
    ElMessage.error("请选择图片文件");
    return;
  }

  uploading.value = true;
  try {
    const result = await uploadImageAsset(file);
    if (uploadingStatus.value && uploadingStatus.value !== "icon") {
      form.statusImages[uploadingStatus.value] = result.url;
    } else {
      form.icon = result.url;
    }
    ElMessage.success("图片已上传");
  } finally {
    uploading.value = false;
    uploadingStatus.value = "";
  }
}

async function remove(nodeType: NodeTypeDefinition) {
  await ElMessageBox.confirm(`确认停用节点类型「${nodeType.name}」？`, "停用节点类型", {
    confirmButtonText: "停用",
    cancelButtonText: "取消",
    type: "warning"
  });
  await deleteNodeType(nodeType.id);
  ElMessage.success("节点类型已停用");
  await load();
}

onMounted(load);
</script>

<template>
  <main class="module-page">
    <header class="topbar">
      <span class="topbar-title">节点库管理</span>
      <ModuleNav />
      <span class="topbar-spacer" />
      <el-button type="primary" @click="openCreate">新增节点类型</el-button>
      <el-button @click="load">刷新</el-button>
    </header>

    <section class="module-body">
      <div class="module-card">
        <div class="module-card-header">
          <div>
            <div class="module-card-title">节点库</div>
            <div class="module-card-subtitle">管理节点类型、模板、端口、动态表单和可绑定字段</div>
          </div>
        </div>

        <el-tabs v-model="activeCategory" class="node-type-tabs">
          <el-tab-pane
            v-for="category in categoryOptions"
            :key="category.value"
            :name="category.value"
            :label="`${category.label}（${categoryCounts[category.value] ?? 0}）`"
          />
        </el-tabs>

        <el-table v-loading="loading" :data="filteredNodeTypes" height="calc(100vh - 186px)">
          <el-table-column label="图片" width="76">
            <template #default="{ row }">
              <div class="node-type-icon">
                <img v-if="isImageIcon(row.icon)" :src="row.icon" :alt="row.name" />
                <span v-else>{{ row.icon || row.id.slice(0, 1).toUpperCase() }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="160" />
          <el-table-column prop="id" label="类型编码" min-width="150" />
          <el-table-column prop="category" label="分类" width="120" />
          <el-table-column prop="template" label="模板" min-width="180" />
          <el-table-column label="默认尺寸" width="120">
            <template #default="{ row }">
              {{ row.defaultSize ? `${row.defaultSize.width} x ${row.defaultSize.height}` : "-" }}
            </template>
          </el-table-column>
          <el-table-column label="端口" width="80">
            <template #default="{ row }">{{ row.ports?.length ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="表单字段" width="100">
            <template #default="{ row }">{{ row.formSchema?.length ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="绑定字段" width="100">
            <template #default="{ row }">{{ row.bindableFields?.length ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="remove(row)">停用</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="720px">
      <el-form label-width="96px">
        <el-form-item label="类型编码">
          <el-input v-model="form.id" placeholder="例如 breaker" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="例如 断路器" />
        </el-form-item>
        <el-form-item label="分类">
          <div class="category-row">
            <el-select v-model="form.category" style="width: 100%;">
              <el-option
                v-for="category in categoryOptions"
                :key="category.value"
                :label="category.label"
                :value="category.value"
              />
            </el-select>
            <el-button @click="applyCategoryDefaultSize">使用默认尺寸</el-button>
          </div>
        </el-form-item>
        <el-form-item label="模板">
          <el-input v-model="form.template" placeholder="basicEquipmentTemplate" />
        </el-form-item>
        <el-form-item label="默认尺寸">
          <div class="default-size-row">
            <el-input-number v-model="form.defaultWidth" controls-position="right" />
            <span class="size-separator">x</span>
            <el-input-number v-model="form.defaultHeight" controls-position="right" />
          </div>
        </el-form-item>
        <el-form-item label="图标">
          <div class="icon-upload-row">
            <div class="icon-preview">
              <img v-if="isImageIcon(form.icon)" :src="form.icon" alt="节点图片" />
              <span v-else>{{ form.icon || "无" }}</span>
            </div>
            <div class="icon-upload-actions">
              <el-input v-model="form.icon" placeholder="图片地址或文本图标" />
              <div class="icon-upload-buttons">
                <el-button :loading="uploading" @click="chooseImage">上传图片</el-button>
                <el-button :disabled="!form.icon" @click="form.icon = ''">清空</el-button>
              </div>
              <input
                ref="fileInputRef"
                class="hidden-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
                @change="handleImageChange"
              />
            </div>
          </div>
        </el-form-item>
        <el-form-item label="状态图片">
          <div class="status-image-grid">
            <div v-for="status in statusOptions" :key="status.value" class="status-image-item">
              <div class="status-image-title">{{ status.label }}</div>
              <div class="icon-preview">
                <img v-if="isImageIcon(form.statusImages[status.value])" :src="form.statusImages[status.value]" :alt="status.label" />
                <span v-else>{{ form.statusImages[status.value] || "无" }}</span>
              </div>
              <el-input v-model="form.statusImages[status.value]" placeholder="状态图片地址" />
              <div class="icon-upload-buttons">
                <el-button :loading="uploading && uploadingStatus === status.value" @click="chooseStatusImage(status.value)">上传</el-button>
                <el-button :disabled="!form.statusImages[status.value]" @click="form.statusImages[status.value] = ''">清空</el-button>
              </div>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="扩展配置">
          <el-input
            v-model="form.configJson"
            type="textarea"
            :rows="16"
            spellcheck="false"
            placeholder="JSON 配置"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.node-type-icon,
.icon-preview {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  overflow: hidden;
  color: #155e75;
  background: #cffafe;
  border: 1px solid #a5f3fc;
  border-radius: 6px;
  font-size: 12px;
}

.node-type-icon img,
.icon-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.node-type-tabs {
  padding: 0 12px;
}

.icon-upload-row {
  display: grid;
  grid-template-columns: 48px 1fr;
  align-items: start;
  gap: 10px;
  width: 100%;
}

.category-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  width: 100%;
}

.default-size-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.size-separator {
  color: #6b7280;
  font-size: 13px;
}

.icon-upload-actions {
  display: grid;
  gap: 8px;
}

.icon-upload-buttons {
  display: flex;
  gap: 8px;
}

.hidden-file-input {
  display: none;
}

.status-image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}

.status-image-item {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid #d8dde6;
  border-radius: 8px;
}

.status-image-title {
  color: #111827;
  font-size: 13px;
  font-weight: 700;
}
</style>
