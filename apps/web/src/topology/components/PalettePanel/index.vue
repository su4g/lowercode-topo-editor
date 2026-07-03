<script setup lang="ts">
import type { NodeTypeDefinition } from "@topo-editor/topology-shared";
import { computed } from "vue";

const props = defineProps<{
  nodeTypes: NodeTypeDefinition[];
}>();

const categoryOptions: Array<{ label: string; value: NodeTypeDefinition["category"] }> = [
  { label: "设备", value: "equipment" },
  { label: "容器", value: "container" },
  { label: "标注", value: "annotation" },
  { label: "控件", value: "control" }
];

const groupedNodeTypes = computed(() => categoryOptions.map((category) => ({
  ...category,
  items: props.nodeTypes.filter((nodeType) => nodeType.category === category.value)
})));

function handleDragStart(event: DragEvent, nodeType: NodeTypeDefinition) {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-topology-node-type", nodeType.id);
  event.dataTransfer.setData("text/plain", nodeType.id);
}

function isImageIcon(icon?: string) {
  return !!icon && (
    /^https?:\/\//.test(icon)
    || icon.startsWith("data:image/")
    || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(icon)
  );
}
</script>

<template>
  <aside class="palette">
    <div class="panel-header">节点库</div>
    <div class="palette-body">
      <div
        v-for="group in groupedNodeTypes"
        :key="group.value"
        class="palette-group"
      >
        <div class="palette-title">
          <span>{{ group.label }}</span>
          <small>{{ group.items.length }}</small>
        </div>
        <div
          v-for="nodeType in group.items"
          :key="nodeType.id"
          class="palette-item"
          draggable="true"
          role="button"
          tabindex="0"
          @dragstart="handleDragStart($event, nodeType)"
        >
          <span class="palette-icon">
            <img v-if="isImageIcon(nodeType.icon)" :src="nodeType.icon" :alt="nodeType.name" />
            <span v-else>{{ nodeType.icon || nodeType.id.slice(0, 1).toUpperCase() }}</span>
          </span>
          <span>
            <strong>{{ nodeType.name }}</strong>
            <small>{{ nodeType.category }}</small>
          </span>
        </div>
        <div v-if="!group.items.length" class="palette-empty">暂无节点</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.palette {
  height: 100%;
}

.palette-body {
  padding: 12px;
  overflow: auto;
  height: calc(100% - 42px);
}

.palette-group {
  margin-bottom: 16px;
}

.palette-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
}

.palette-title small {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  color: #0f766e;
  background: #ccfbf1;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.palette-item {
  display: grid;
  grid-template-columns: 32px 1fr;
  align-items: center;
  width: 100%;
  gap: 8px;
  padding: 8px;
  margin-bottom: 8px;
  text-align: left;
  background: #f9fafb;
  border: 1px solid #d8dde6;
  border-radius: 6px;
  cursor: grab;
  user-select: none;
}

.palette-item:active {
  cursor: grabbing;
}

.palette-item:hover {
  background: #eef6ff;
  border-color: #60a5fa;
}

.palette-empty {
  padding: 10px 8px;
  color: #9ca3af;
  background: #f9fafb;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  font-size: 12px;
  text-align: center;
}

.palette-icon {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: #155e75;
  background: #cffafe;
  border-radius: 6px;
  font-size: 12px;
  overflow: hidden;
}

.palette-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

small {
  display: block;
  color: #6b7280;
}
</style>
