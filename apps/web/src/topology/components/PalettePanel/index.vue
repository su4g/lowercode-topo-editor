<script setup lang="ts">
import type { NodeTypeDefinition } from "@topo-editor/topology-shared";
import { Rank, Search } from "@element-plus/icons-vue";
import { computed, ref, watch } from "vue";
import { displayAssetText, isImageAsset, isOssAssetRef, resolveAssetUrl } from "../../services/assetApi";

const props = defineProps<{
  nodeTypes: NodeTypeDefinition[];
}>();

const categoryOptions: Array<{ label: string; value: NodeTypeDefinition["category"] }> = [
  { label: "设备", value: "equipment" },
  { label: "容器", value: "container" },
  { label: "标注", value: "annotation" },
  { label: "控件", value: "control" }
];

const categoryLabelMap = Object.fromEntries(categoryOptions.map((option) => [option.value, option.label]));
const keyword = ref("");

const groupedNodeTypes = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  const groups = categoryOptions.map((category) => ({
    ...category,
    items: props.nodeTypes.filter((nodeType) => {
      if (nodeType.category !== category.value) return false;
      if (!query) return true;
      return nodeType.name.toLowerCase().includes(query)
        || nodeType.id.toLowerCase().includes(query)
        || category.label.includes(query);
    })
  }));
  return query ? groups.filter((group) => group.items.length) : groups;
});

const totalCount = computed(() => props.nodeTypes.length);
const assetUrlMap = ref<Record<string, string>>({});

function handleDragStart(event: DragEvent, nodeType: NodeTypeDefinition) {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-topology-node-type", nodeType.id);
  event.dataTransfer.setData("text/plain", nodeType.id);
}

function isImageIcon(icon?: string) {
  return isImageAsset(icon);
}

function assetPreviewUrl(value?: string) {
  return value ? assetUrlMap.value[value] || (!isOssAssetRef(value) ? value : "") : "";
}

function assetLabel(value?: string) {
  return displayAssetText(value);
}

async function ensureAssetUrl(value?: string) {
  if (!value || !isImageAsset(value) || assetUrlMap.value[value]) return;
  try {
    const url = await resolveAssetUrl(value);
    if (url) assetUrlMap.value = { ...assetUrlMap.value, [value]: url };
  } catch {
    // The persistent oss id remains usable once the URL can be resolved again.
  }
}

watch(() => props.nodeTypes, (nodeTypes) => {
  nodeTypes.forEach((nodeType) => void ensureAssetUrl(nodeType.icon));
}, { immediate: true, deep: true });
</script>

<template>
  <aside class="palette">
    <div class="panel-header">
      <span>节点库</span>
      <span class="panel-header-count">{{ totalCount }}</span>
    </div>
    <div class="palette-search">
      <el-input v-model="keyword" placeholder="搜索节点名称或类型" clearable :prefix-icon="Search" />
    </div>
    <div class="palette-body">
      <div
        v-for="group in groupedNodeTypes"
        :key="group.value"
        class="palette-group"
      >
        <div class="palette-title">
          <span class="palette-title-text">
            <i class="palette-dot" :class="`is-${group.value}`" />
            {{ group.label }}
          </span>
          <span class="palette-count">{{ group.items.length }}</span>
        </div>
        <div
          v-for="nodeType in group.items"
          :key="nodeType.id"
          class="palette-item"
          draggable="true"
          role="button"
          tabindex="0"
          :title="`拖拽到画布以创建「${nodeType.name}」`"
          @dragstart="handleDragStart($event, nodeType)"
        >
          <span class="palette-icon" :class="`is-${nodeType.category}`">
            <img v-if="isImageIcon(nodeType.icon) && assetPreviewUrl(nodeType.icon)" :src="assetPreviewUrl(nodeType.icon)" :alt="nodeType.name" />
            <span v-else>{{ assetLabel(nodeType.icon) || nodeType.id.slice(0, 1).toUpperCase() }}</span>
          </span>
          <span class="palette-item-text">
            <strong>{{ nodeType.name }}</strong>
            <small>{{ categoryLabelMap[nodeType.category] ?? nodeType.category }}</small>
          </span>
          <el-icon class="palette-drag-hint"><Rank /></el-icon>
        </div>
        <div v-if="!group.items.length" class="palette-empty">暂无节点</div>
      </div>
      <div v-if="keyword.trim() && !groupedNodeTypes.length" class="palette-empty">
        未找到与“{{ keyword.trim() }}”匹配的节点
      </div>
      <div v-else class="palette-tip">拖拽节点到画布即可创建</div>
    </div>
  </aside>
</template>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.palette-search {
  flex: none;
  padding: 10px 12px 2px;
}

.palette-body {
  flex: 1;
  min-height: 0;
  padding: 10px 12px 12px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.palette-group {
  margin-bottom: 14px;
}

.palette-group:last-of-type {
  margin-bottom: 8px;
}

.palette-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 18px;
  margin-bottom: 8px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  font-weight: 600;
}

.palette-title-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.palette-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--el-color-primary, #009688);
}

.palette-dot.is-container {
  background: #409eff;
}

.palette-dot.is-annotation {
  background: var(--el-color-warning, #e6a23c);
}

.palette-dot.is-control {
  background: #7c6cf2;
}

.palette-count {
  flex: none;
  align-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  color: var(--el-text-color-secondary, #909399);
  background: var(--el-fill-color, #f0f2f5);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  text-align: center;
}

.palette-item {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  gap: 10px;
  padding: 8px 10px;
  margin-bottom: 8px;
  text-align: left;
  background: #ffffff;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
  cursor: grab;
  user-select: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.palette-item:active {
  cursor: grabbing;
}

.palette-item:hover,
.palette-item:focus-visible {
  border-color: var(--el-color-primary-light-5, #7fc8c3);
  box-shadow: 0 2px 10px rgb(15 23 42 / 8%);
  transform: translateY(-1px);
  outline: none;
}

.palette-item:hover .palette-drag-hint,
.palette-item:focus-visible .palette-drag-hint {
  opacity: 1;
}

.palette-item-text {
  min-width: 0;
}

.palette-item-text strong {
  display: block;
  overflow: hidden;
  color: var(--el-text-color-primary, #303133);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-item-text small {
  display: block;
  margin-top: 1px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 11px;
}

.palette-drag-hint {
  color: var(--el-color-primary, #009688);
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.palette-empty {
  padding: 10px 8px;
  margin-bottom: 8px;
  color: var(--el-text-color-placeholder, #a8abb2);
  background: var(--el-fill-color-lighter, #fafafa);
  border: 1px dashed var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  font-size: 12px;
  text-align: center;
}

.palette-tip {
  padding: 8px 10px;
  color: var(--el-text-color-secondary, #909399);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-radius: 8px;
  font-size: 12px;
  text-align: center;
}

.palette-icon {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: var(--el-color-primary, #009688);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
}

.palette-icon.is-container {
  color: #2f7fd6;
  background: #eaf3fd;
}

.palette-icon.is-annotation {
  color: #b57a1e;
  background: #fdf3e3;
}

.palette-icon.is-control {
  color: #6354c9;
  background: #efedfd;
}

.palette-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
