<script setup lang="ts">
import type { NodeTypeDefinition, TopologyData, TopologyLink, TopologyNode } from "@topo-editor/topology-shared";
import { Close, Connection, Search } from "@element-plus/icons-vue";
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps<{
  topology: TopologyData | null;
  nodeTypes?: NodeTypeDefinition[];
  selectedKey?: string;
}>();

const emit = defineEmits<{
  close: [];
  selectItem: [key: string];
}>();

type NodeTreeRow = {
  node: TopologyNode;
  level: number;
};

const keyword = ref("");
const navigatorBodyRef = ref<HTMLElement | null>(null);

const normalizedKeyword = computed(() => keyword.value.trim().toLowerCase());

const nodeTreeRows = computed<NodeTreeRow[]>(() => {
  const nodes = props.topology?.nodes ?? [];
  const childrenByGroup = new Map<string, TopologyNode[]>();
  for (const node of nodes) {
    if (!node.group) continue;
    const children = childrenByGroup.get(node.group) ?? [];
    children.push(node);
    childrenByGroup.set(node.group, children);
  }

  const rows: NodeTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (node: TopologyNode, level: number) => {
    if (visited.has(node.key)) return;
    visited.add(node.key);
    rows.push({ node, level });
    for (const child of childrenByGroup.get(node.key) ?? []) visit(child, level + 1);
  };

  const nodeKeys = new Set(nodes.map((item) => item.key));
  for (const node of nodes.filter((item) => !item.group || !nodeKeys.has(item.group))) {
    visit(node, 0);
  }
  for (const node of nodes) visit(node, 0);
  return rows;
});

const filteredNodeRows = computed(() => {
  const value = normalizedKeyword.value;
  if (!value) return nodeTreeRows.value;
  return nodeTreeRows.value.filter(({ node }) => {
    return [node.label, node.key, node.typeId].some((item) => item?.toLowerCase().includes(value));
  });
});

const filteredLinks = computed(() => {
  const links = props.topology?.links ?? [];
  const value = normalizedKeyword.value;
  if (!value) return links;
  return links.filter((link) => {
    return [link.label, link.key, link.from, link.to, link.fromPort, link.toPort, linkTreeLabel(link)]
      .some((item) => item?.toLowerCase().includes(value));
  });
});

const nodeMapByKey = computed(() => new Map((props.topology?.nodes ?? []).map((node) => [node.key, node])));

function nodeByKey(key: string) {
  return nodeMapByKey.value.get(key) ?? null;
}

function nodeTypeOf(typeId: string) {
  return props.nodeTypes?.find((nodeType) => nodeType.id === typeId);
}

function nodeTreeTypeLabel(node: TopologyNode) {
  if (node.isGroup) return "组";
  const nodeType = nodeTypeOf(node.typeId);
  if (nodeType?.category === "annotation") return "标注";
  if (nodeType?.category === "control") return "控件";
  return "节点";
}

function nodeKindClass(node: TopologyNode) {
  if (node.isGroup) return "is-container";
  const category = nodeTypeOf(node.typeId)?.category;
  if (category === "annotation") return "is-annotation";
  if (category === "control") return "is-control";
  return "is-equipment";
}

function linkTreeLabel(link: TopologyLink) {
  return link.label || `${nodeByKey(link.from)?.label ?? link.from} -> ${nodeByKey(link.to)?.label ?? link.to}`;
}

function selectItem(key: string) {
  emit("selectItem", key);
}

watch(
  () => props.selectedKey,
  async (key) => {
    if (!key) return;
    await nextTick();
    const target = Array.from(navigatorBodyRef.value?.querySelectorAll<HTMLElement>("[data-key]") ?? [])
      .find((item) => item.dataset.key === key);
    target?.scrollIntoView({ block: "nearest" });
  }
);
</script>

<template>
  <div class="object-navigator">
    <div class="navigator-header">
      <div class="navigator-heading">
        <div class="navigator-title">对象树</div>
        <div class="navigator-count">
          {{ topology?.nodes.length ?? 0 }} 节点 · {{ topology?.links.length ?? 0 }} 连线
        </div>
      </div>
      <button type="button" class="navigator-close" title="关闭对象树" @click="emit('close')">
        <el-icon><Close /></el-icon>
      </button>
    </div>

    <div class="navigator-search">
      <el-input v-model="keyword" placeholder="搜索名称、key、类型或连线端点" clearable :prefix-icon="Search" />
    </div>

    <div v-if="topology" ref="navigatorBodyRef" class="navigator-body">
      <section class="navigator-section">
        <div class="navigator-section-title">
          <span>节点</span>
          <small>{{ filteredNodeRows.length }}</small>
        </div>
        <button
          v-for="row in filteredNodeRows"
          :key="row.node.key"
          type="button"
          class="navigator-item"
          :class="{ active: selectedKey === row.node.key }"
          :data-key="row.node.key"
          :style="{ paddingLeft: `${10 + row.level * 16}px` }"
          @click="selectItem(row.node.key)"
        >
          <span class="navigator-kind" :class="nodeKindClass(row.node)">{{ nodeTreeTypeLabel(row.node) }}</span>
          <span class="navigator-name">{{ row.node.label }}</span>
          <span class="navigator-key">{{ row.node.key }}</span>
        </button>
        <div v-if="!filteredNodeRows.length" class="navigator-empty">暂无匹配节点</div>
      </section>

      <section class="navigator-section">
        <div class="navigator-section-title">
          <span>连线</span>
          <small>{{ filteredLinks.length }}</small>
        </div>
        <button
          v-for="link in filteredLinks"
          :key="link.key"
          type="button"
          class="navigator-item"
          :class="{ active: selectedKey === link.key }"
          :data-key="link.key"
          @click="selectItem(link.key)"
        >
          <span class="navigator-kind is-link">
            <el-icon class="navigator-kind-icon"><Connection /></el-icon>
            线
          </span>
          <span class="navigator-name">{{ linkTreeLabel(link) }}</span>
          <span class="navigator-key">{{ link.key }}</span>
        </button>
        <div v-if="!filteredLinks.length" class="navigator-empty">暂无匹配连线</div>
      </section>
    </div>

    <div v-else class="navigator-empty large">拓扑加载后可查看节点和连线。</div>
  </div>
</template>

<style scoped>
.object-navigator {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 20;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 10px;
  width: min(360px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  padding: 12px;
  overflow: hidden;
  background: rgb(255 255 255 / 97%);
  backdrop-filter: blur(6px);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 10px;
  box-shadow: 0 18px 42px rgb(15 23 42 / 16%);
}

.navigator-header,
.navigator-section-title,
.navigator-item {
  display: flex;
  align-items: center;
}

.navigator-header {
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
}

.navigator-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.navigator-heading::before {
  content: "";
  flex: none;
  width: 3px;
  height: 14px;
  background: var(--el-color-primary, #009688);
  border-radius: 2px;
}

.navigator-title {
  color: var(--el-text-color-primary, #303133);
  font-size: 14px;
  font-weight: 700;
}

.navigator-count {
  padding: 1px 8px;
  color: var(--el-color-primary, #009688);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.navigator-close {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--el-text-color-secondary, #909399);
  background: transparent;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.navigator-close:hover {
  color: var(--el-color-danger, #f56c6c);
  background: var(--el-color-danger-light-9, #fef0f0);
  border-color: var(--el-color-danger-light-7, #fab6b6);
}

.navigator-body {
  display: grid;
  gap: 14px;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.navigator-section {
  display: grid;
  gap: 6px;
}

.navigator-section-title {
  justify-content: space-between;
  gap: 12px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  font-weight: 600;
}

.navigator-section-title small {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  background: var(--el-fill-color, #f0f2f5);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.navigator-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  color: var(--el-text-color-regular, #606266);
  text-align: left;
  background: #ffffff;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.navigator-item:hover {
  border-color: var(--el-color-primary-light-5, #7fc8c3);
  box-shadow: 0 2px 10px rgb(15 23 42 / 8%);
  transform: translateY(-1px);
}

.navigator-item.active {
  color: var(--el-color-primary, #009688);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-color: var(--el-color-primary-light-5, #7fc8c3);
}

.navigator-kind {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  min-width: 34px;
  height: 20px;
  padding: 0 7px;
  color: var(--el-color-primary, #009688);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.navigator-kind.is-container {
  color: #2f7fd6;
  background: #eaf3fd;
}

.navigator-kind.is-annotation {
  color: #b57a1e;
  background: #fdf3e3;
}

.navigator-kind.is-control {
  color: #6354c9;
  background: #efedfd;
}

.navigator-kind.is-link {
  color: var(--el-text-color-secondary, #909399);
  background: var(--el-fill-color, #f0f2f5);
}

.navigator-kind-icon {
  font-size: 12px;
}

.navigator-name,
.navigator-key {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.navigator-name {
  font-weight: 600;
}

.navigator-key {
  max-width: 92px;
  color: var(--el-text-color-placeholder, #a8abb2);
  font-size: 11px;
}

.navigator-empty {
  padding: 8px 10px;
  color: var(--el-text-color-placeholder, #a8abb2);
  background: var(--el-fill-color-lighter, #fafafa);
  border: 1px dashed var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  font-size: 12px;
}

.navigator-empty.large {
  padding: 16px;
  text-align: center;
}
</style>
