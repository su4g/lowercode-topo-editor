<script setup lang="ts">
import type { NodeTypeDefinition, TopologyData, TopologyLink, TopologyNode } from "@topo-editor/topology-shared";
import { computed, ref } from "vue";

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

  for (const node of nodes.filter((item) => !item.group || !nodes.some((parent) => parent.key === item.group))) {
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

function nodeByKey(key: string) {
  return props.topology?.nodes.find((node) => node.key === key) ?? null;
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

function linkTreeLabel(link: TopologyLink) {
  return link.label || `${nodeByKey(link.from)?.label ?? link.from} -> ${nodeByKey(link.to)?.label ?? link.to}`;
}

function selectItem(key: string) {
  emit("selectItem", key);
}
</script>

<template>
  <div class="object-navigator">
    <div class="navigator-header">
      <div>
        <div class="navigator-title">对象树</div>
        <div class="navigator-count">
          {{ topology?.nodes.length ?? 0 }} 节点 / {{ topology?.links.length ?? 0 }} 连线
        </div>
      </div>
      <button type="button" class="navigator-close" @click="emit('close')">关闭</button>
    </div>

    <input
      v-model="keyword"
      class="navigator-search"
      placeholder="搜索名称、key、类型或连线端点"
    />

    <div v-if="topology" class="navigator-body">
      <section class="navigator-section">
        <div class="navigator-section-title">
          <span>节点</span>
          <span>{{ filteredNodeRows.length }}</span>
        </div>
        <button
          v-for="row in filteredNodeRows"
          :key="row.node.key"
          type="button"
          class="navigator-item"
          :class="{ active: selectedKey === row.node.key }"
          :style="{ paddingLeft: `${10 + row.level * 16}px` }"
          @click="selectItem(row.node.key)"
        >
          <span class="navigator-kind">{{ nodeTreeTypeLabel(row.node) }}</span>
          <span class="navigator-name">{{ row.node.label }}</span>
          <span class="navigator-key">{{ row.node.key }}</span>
        </button>
        <div v-if="!filteredNodeRows.length" class="navigator-empty">暂无匹配节点</div>
      </section>

      <section class="navigator-section">
        <div class="navigator-section-title">
          <span>连线</span>
          <span>{{ filteredLinks.length }}</span>
        </div>
        <button
          v-for="link in filteredLinks"
          :key="link.key"
          type="button"
          class="navigator-item"
          :class="{ active: selectedKey === link.key }"
          @click="selectItem(link.key)"
        >
          <span class="navigator-kind">线</span>
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
  gap: 10px;
  width: min(360px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  padding: 12px;
  overflow: hidden;
  background: rgb(255 255 255 / 96%);
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 18px 42px rgb(15 23 42 / 18%);
}

.navigator-header,
.navigator-section-title,
.navigator-item {
  display: flex;
  align-items: center;
}

.navigator-header,
.navigator-section-title {
  justify-content: space-between;
  gap: 12px;
}

.navigator-title {
  color: #111827;
  font-size: 14px;
  font-weight: 700;
}

.navigator-count,
.navigator-section-title,
.navigator-empty,
.navigator-key {
  color: #64748b;
  font-size: 12px;
}

.navigator-close {
  height: 28px;
  padding: 0 10px;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
}

.navigator-search {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  color: #111827;
  background: #f8fafc;
  border: 1px solid #d8dde6;
  border-radius: 6px;
}

.navigator-body {
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.navigator-section {
  display: grid;
  gap: 5px;
}

.navigator-section-title {
  font-weight: 700;
}

.navigator-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 7px;
  min-height: 32px;
  padding: 6px 8px;
  color: #334155;
  text-align: left;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
}

.navigator-item:hover {
  background: #eef6ff;
}

.navigator-item.active {
  color: #0f172a;
  background: #e0f2fe;
  border-color: #38bdf8;
}

.navigator-kind {
  min-width: 28px;
  color: #64748b;
  font-size: 11px;
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
  max-width: 86px;
}

.navigator-empty {
  padding: 8px;
  background: #f8fafc;
  border: 1px dashed #d8dde6;
  border-radius: 6px;
}

.navigator-empty.large {
  padding: 16px;
  text-align: center;
}
</style>
