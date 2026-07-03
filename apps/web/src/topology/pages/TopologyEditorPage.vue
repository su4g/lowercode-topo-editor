<script setup lang="ts">
import type { DataSourceReference, DataSourceType, NodeTypeDefinition, TopologyData, TopologyLink, TopologyNode } from "@topo-editor/topology-shared";
import { ElMessage } from "element-plus";
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ModuleNav from "../components/ModuleNav.vue";
import PalettePanel from "../components/PalettePanel/index.vue";
import PropertyPanel from "../components/PropertyPanel/index.vue";
import TopologyCanvas from "../components/TopologyCanvas/index.vue";
import { listNodeTypes } from "../services/nodeTypeApi";
import { getTopology, saveTopology } from "../services/topologyApi";

const route = useRoute();
const router = useRouter();
const nodeTypes = ref<NodeTypeDefinition[]>([]);
const topology = ref<TopologyData | null>(null);
const saving = ref(false);
const selectedKey = ref("");
const apiDialogVisible = ref(false);
const canvasRef = ref<{
  exportTopology: () => TopologyData | null;
  updateNodeDataFromProps: (nodeKey: string, patch: Partial<TopologyNode>) => void;
  updateLinkDataFromProps: (linkKey: string, patch: Partial<TopologyLink>) => void;
  undo: () => void;
  redo: () => void;
  deleteSelection: () => void;
  fitView: () => void;
  autoLayout: () => void;
  exportSvg: () => void;
} | null>(null);
const selectedNode = computed(() => topology.value?.nodes.find((node) => node.key === selectedKey.value) ?? null);
const selectedLink = computed(() => topology.value?.links.find((link) => link.key === selectedKey.value) ?? null);

function createEmptyTopology(id: string): TopologyData {
  return {
    id,
    name: "新建拓扑",
    version: "1.0.0",
    dataSources: [],
    nodes: [],
    links: []
  };
}

function canDropIntoGroup(nodeType: NodeTypeDefinition, groupKey?: string) {
  if (!topology.value || !groupKey) return false;
  const groupNode = topology.value.nodes.find((node) => node.key === groupKey && node.isGroup);
  if (!groupNode) return false;
  const groupType = nodeTypes.value.find((item) => item.id === groupNode.typeId);
  if (!groupType) return false;
  if (nodeType.isGroup && !groupType.allowNestedGroup) return false;
  if (!groupType.canContain?.length) return true;
  return groupType.canContain.includes(nodeType.id) || groupType.canContain.includes(nodeType.category);
}

function getDefaultSize(nodeType: NodeTypeDefinition) {
  if (nodeType.defaultSize) return nodeType.defaultSize;
  if (nodeType.isGroup) return { width: 320, height: 220 };
  if (nodeType.category === "annotation") return { width: 140, height: 64 };
  if (nodeType.category === "control") return { width: 112, height: 42 };
  return { width: 104, height: 92 };
}

function normalizeNodeSizes(data: TopologyData) {
  return {
    ...data,
    dataSources: data.dataSources ?? [],
    nodes: data.nodes.map((node) => {
      if (node.size) return node;
      const nodeType = nodeTypes.value.find((item) => item.id === node.typeId);
      const size = getDefaultSize(nodeType ?? {
        id: node.typeId,
        name: node.typeId,
        category: node.isGroup ? "container" : "equipment",
        template: "",
        isGroup: node.isGroup
      });
      return { ...node, size: `${size.width} ${size.height}` };
    })
  };
}

function createDataSource(): DataSourceReference {
  const index = (topology.value?.dataSources?.length ?? 0) + 1;
  return {
    sourceId: `source_${String(index).padStart(3, "0")}`,
    name: `接口 ${index}`,
    type: "http",
    enabled: true,
    fields: [],
    config: {
      url: "/lab/latest/${params.instanceId}",
      method: "GET",
      interval: 3000,
      query: {},
      headers: {},
      body: {},
      mockData: {
        data: {
          qf1: {
            status: "closed"
          }
        },
        result: true
      },
      responseMapping: {}
    }
  };
}

function updateDataSource(index: number, patch: Partial<DataSourceReference>) {
  if (!topology.value) return;
  const dataSources = [...(topology.value.dataSources ?? [])];
  dataSources[index] = {
    ...dataSources[index],
    ...patch
  };
  topology.value = {
    ...topology.value,
    dataSources
  };
}

function updateDataSourceConfig(index: number, patch: NonNullable<DataSourceReference["config"]>) {
  if (!topology.value) return;
  const source = topology.value.dataSources?.[index];
  if (!source) return;
  updateDataSource(index, {
    config: {
      ...(source.config ?? {}),
      ...patch,
      responseMapping: {
        ...(source.config?.responseMapping ?? {}),
        ...(patch.responseMapping ?? {})
      },
      ws: {
        ...(source.config?.ws ?? {}),
        ...(patch.ws ?? {})
      }
    }
  });
}

function updateDataSourceWsConfig(index: number, patch: NonNullable<NonNullable<DataSourceReference["config"]>["ws"]>) {
  updateDataSourceConfig(index, { ws: patch });
}

function addDataSource() {
  if (!topology.value) return;
  topology.value = {
    ...topology.value,
    dataSources: [
      ...(topology.value.dataSources ?? []),
      createDataSource()
    ]
  };
}

function removeDataSource(index: number) {
  if (!topology.value) return;
  topology.value = {
    ...topology.value,
    dataSources: (topology.value.dataSources ?? []).filter((_item, itemIndex) => itemIndex !== index)
  };
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonObject(value: string, fallbackLabel: string) {
  try {
    const parsed = value.trim() ? JSON.parse(value) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      ElMessage.error(`${fallbackLabel} 必须是 JSON 对象`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    ElMessage.error(`${fallbackLabel} 不是合法 JSON`);
    return null;
  }
}

function updateDataSourceJson(index: number, field: "query" | "headers" | "body" | "mockData", value: string) {
  const parsed = parseJsonObject(value, field);
  if (!parsed) return;
  updateDataSourceConfig(index, { [field]: parsed });
}

function updateDataSourceWsJson(index: number, field: "subscribeMessage", value: string) {
  const parsed = parseJsonObject(value, field);
  if (!parsed) return;
  updateDataSourceWsConfig(index, { [field]: parsed });
}

function updateDataSourceFields(index: number, value: string) {
  updateDataSource(index, {
    fields: value.split(",").map((item) => item.trim()).filter(Boolean)
  });
}

function addNode(payload: { nodeType: NodeTypeDefinition; loc?: string; groupKey?: string }) {
  if (!topology.value) return;
  const { nodeType, loc, groupKey } = payload;
  const index = topology.value.nodes.filter((node) => node.typeId === nodeType.id).length + 1;
  const key = `${nodeType.id}_${String(index).padStart(3, "0")}`;
  const props = Object.fromEntries((nodeType.formSchema ?? []).map((field) => [field.field, field.defaultValue ?? ""]));
  const size = getDefaultSize(nodeType);
  const targetGroup = canDropIntoGroup(nodeType, groupKey) ? groupKey : undefined;
  const zOrder = Math.max(0, ...topology.value.nodes.map((node) => Number.isFinite(node.zOrder) ? Number(node.zOrder) : 0)) + 1;

  topology.value = {
    ...topology.value,
    nodes: [
      ...topology.value.nodes,
      {
        key,
        typeId: nodeType.id,
        isGroup: nodeType.isGroup,
        label: `${nodeType.name}${index}`,
        loc: loc ?? `${160 + index * 36} ${120 + index * 24}`,
        size: `${size.width} ${size.height}`,
        zOrder,
        group: targetGroup,
        props,
        runtime: nodeType.isGroup
          ? { backgroundColor: "#eef6ff", borderColor: "#3b82f6" }
          : {}
      }
    ]
  };
  selectedKey.value = key;
}

function updateTopology(next: TopologyData) {
  topology.value = next;
  if (
    selectedKey.value
    && !next.nodes.some((node) => node.key === selectedKey.value)
    && !next.links.some((link) => link.key === selectedKey.value)
  ) {
    selectedKey.value = "";
  }
}

function updateNode(key: string, patch: Partial<TopologyNode>) {
  if (!topology.value) return;
  canvasRef.value?.updateNodeDataFromProps(key, patch);

  topology.value = {
    ...topology.value,
    nodes: topology.value.nodes.map((node) => {
      if (node.key !== key) return node;
      return {
        ...node,
        ...patch,
        runtime: patch.runtime ? { ...node.runtime, ...patch.runtime } : node.runtime
      };
    })
  };
}

function updateLink(key: string, patch: Partial<TopologyLink>) {
  if (!topology.value) return;
  canvasRef.value?.updateLinkDataFromProps(key, patch);

  topology.value = {
    ...topology.value,
    links: topology.value.links.map((link) => {
      if (link.key !== key) return link;
      return {
        ...link,
        ...patch,
        runtime: patch.runtime ? { ...link.runtime, ...patch.runtime } : link.runtime
      };
    })
  };
}

async function save() {
  if (!topology.value) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await nextTick();
  const latestTopology = canvasRef.value?.exportTopology() ?? topology.value;
  topology.value = latestTopology;
  saving.value = true;
  try {
    topology.value = await saveTopology(latestTopology);
    ElMessage.success("拓扑已保存");
  } finally {
    saving.value = false;
  }
}

async function previewRuntime() {
  if (!topology.value) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await nextTick();
  const latestTopology = canvasRef.value?.exportTopology() ?? topology.value;
  topology.value = latestTopology;
  sessionStorage.setItem(`topology-preview:${latestTopology.id}`, JSON.stringify(latestTopology));
  router.push(`/runtime/${topology.value.id}?preview=1`);
}

function undo() {
  canvasRef.value?.undo();
}

function redo() {
  canvasRef.value?.redo();
}

function deleteSelection() {
  canvasRef.value?.deleteSelection();
}

function fitView() {
  canvasRef.value?.fitView();
}

function autoLayout() {
  canvasRef.value?.autoLayout();
}

function exportSvg() {
  canvasRef.value?.exportSvg();
}

onMounted(async () => {
  nodeTypes.value = await listNodeTypes();
  const id = String(route.params.id ?? "topology_001");
  topology.value = normalizeNodeSizes(await getTopology(id) ?? createEmptyTopology(id));
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <span class="topbar-title">拓扑编辑器</span>
      <ModuleNav />
      <span class="topbar-spacer" />
      <el-button :disabled="!topology" @click="undo">撤销</el-button>
      <el-button :disabled="!topology" @click="redo">重做</el-button>
      <el-button :disabled="!topology" @click="fitView">适配</el-button>
      <el-button :disabled="!topology" @click="autoLayout">整理</el-button>
      <el-button :disabled="!topology" type="danger" plain @click="deleteSelection">删除</el-button>
      <el-button :disabled="!topology" @click="apiDialogVisible = true">接口配置</el-button>
      <el-button :disabled="!topology" @click="exportSvg">导出 SVG</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      <el-button @click="router.push('/topologies')">返回列表</el-button>
      <el-button :disabled="!topology" @click="previewRuntime">预览运行态</el-button>
    </header>
    <section class="workspace">
      <PalettePanel class="side-panel" :node-types="nodeTypes" />
      <div class="canvas-wrap">
        <TopologyCanvas
          ref="canvasRef"
          mode="edit"
          :topology-data="topology"
          :node-types="nodeTypes"
          :selected-key="selectedKey"
          @change="updateTopology"
          @drop-node="addNode"
          @selection-change="selectedKey = $event"
        />
      </div>
      <PropertyPanel
        class="right-panel"
        :topology="topology"
        :node-types="nodeTypes"
        :selected-node="selectedNode"
        :selected-link="selectedLink"
        @update-node="updateNode"
        @update-link="updateLink"
        @select-item="selectedKey = $event"
      />
    </section>
    <el-dialog v-model="apiDialogVisible" title="拓扑接口配置" width="980px" class="api-config-dialog">
      <div class="api-config-header">
        <div>
          <div class="api-config-title">运行态数据源</div>
          <div class="api-config-hint">预览运行态读取 mockData，真实运行态读取接口。URL、query、body、headers 支持 ${xxx.xxx} 或 {xxx.xxx} 通用表达式。</div>
        </div>
        <el-button type="primary" @click="addDataSource">新增接口</el-button>
      </div>
      <div v-if="topology?.dataSources?.length" class="api-source-list">
        <section v-for="(source, index) in topology.dataSources" :key="index" class="api-source-card">
          <div class="api-source-top">
            <div class="api-source-title">{{ source.name || source.sourceId }}</div>
            <el-button type="danger" plain @click="removeDataSource(index)">删除</el-button>
          </div>
          <div class="api-form-grid">
            <label>
              接口编码
              <input
                :value="source.sourceId"
                @input="updateDataSource(index, { sourceId: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              名称
              <input
                :value="source.name ?? ''"
                @input="updateDataSource(index, { name: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              类型
              <select
                :value="source.type ?? 'http'"
                @change="updateDataSource(index, { type: ($event.target as HTMLSelectElement).value as DataSourceType })"
              >
                <option value="http">HTTP</option>
                <option value="websocket">WebSocket</option>
                <option value="static">静态</option>
              </select>
            </label>
            <label class="api-checkbox">
              <input
                type="checkbox"
                :checked="source.enabled !== false"
                @change="updateDataSource(index, { enabled: ($event.target as HTMLInputElement).checked })"
              />
              启用
            </label>
          </div>
          <div class="api-form-grid wide">
            <label>
              {{ source.type === 'websocket' ? 'HTTP/WS URL' : 'URL' }}
              <input
                :value="source.config?.url ?? ''"
                :placeholder="source.type === 'websocket' ? 'ws://localhost:3000/ws/${params.instanceId}' : '/lab/latest/${params.instanceId}'"
                @input="updateDataSourceConfig(index, { url: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              方法
              <select
                :value="source.config?.method ?? 'GET'"
                @change="updateDataSourceConfig(index, { method: ($event.target as HTMLSelectElement).value as 'GET' | 'POST' })"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </label>
            <label>
              响应根路径
              <input
                :value="source.config?.responseMapping?.rootPath ?? ''"
                placeholder="可选；HTTP 规则默认使用完整响应 api1.data.xxx"
                @input="updateDataSourceConfig(index, { responseMapping: { rootPath: ($event.target as HTMLInputElement).value } })"
              />
            </label>
            <label>
              轮询间隔 ms
              <input
                type="number"
                :value="source.config?.interval ?? 3000"
                placeholder="3000"
                @input="updateDataSourceConfig(index, { interval: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })"
              />
            </label>
          </div>
          <div v-if="source.type === 'websocket'" class="api-form-grid ws">
            <label>
              WS 地址
              <input
                :value="source.config?.ws?.url ?? ''"
                placeholder="为空时复用上方 URL，支持 ${xxx.xxx}"
                @input="updateDataSourceWsConfig(index, { url: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              消息 key 路径
              <input
                :value="source.config?.ws?.messageKeyPath ?? ''"
                placeholder="例如 key / data.deviceCode"
                @input="updateDataSourceWsConfig(index, { messageKeyPath: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              消息数据根路径
              <input
                :value="source.config?.ws?.dataRootPath ?? ''"
                placeholder="例如 data"
                @input="updateDataSourceWsConfig(index, { dataRootPath: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              心跳间隔 ms
              <input
                type="number"
                :value="source.config?.ws?.heartbeatInterval ?? 0"
                placeholder="0 表示不开启"
                @input="updateDataSourceWsConfig(index, { heartbeatInterval: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })"
              />
            </label>
          </div>
          <label>
            字段列表
            <input
              :value="(source.fields ?? []).join(', ')"
              placeholder="HTTP: data.qf1.status；WS: qf1.data.status"
              @input="updateDataSourceFields(index, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <div class="api-json-grid">
            <label>
              Query 参数 JSON
              <textarea
                :value="jsonText(source.config?.query)"
                rows="6"
                spellcheck="false"
                placeholder='{"id":"${params.instanceId}"}'
                @change="updateDataSourceJson(index, 'query', ($event.target as HTMLTextAreaElement).value)"
              />
            </label>
            <label>
              Headers JSON
              <textarea
                :value="jsonText(source.config?.headers)"
                rows="6"
                spellcheck="false"
                placeholder='{"Authorization":"Bearer ${token}"}'
                @change="updateDataSourceJson(index, 'headers', ($event.target as HTMLTextAreaElement).value)"
              />
            </label>
            <label>
              Body JSON
              <textarea
                :value="jsonText(source.config?.body)"
                rows="6"
                spellcheck="false"
                placeholder='{"id":"${params.instanceId}"}'
                @change="updateDataSourceJson(index, 'body', ($event.target as HTMLTextAreaElement).value)"
              />
            </label>
            <label v-if="source.type === 'websocket'">
              WS 订阅消息 JSON
              <textarea
                :value="jsonText(source.config?.ws?.subscribeMessage)"
                rows="6"
                spellcheck="false"
                placeholder='{"type":"subscribe","id":"${params.instanceId}"}'
                @change="updateDataSourceWsJson(index, 'subscribeMessage', ($event.target as HTMLTextAreaElement).value)"
              />
            </label>
            <label>
              Mock JSON
              <textarea
                :value="jsonText(source.config?.mockData ?? source.config?.data)"
                rows="6"
                spellcheck="false"
                placeholder='{"data":{"qf1":{"status":"closed"},"deviceB":{"outputVoltage":220}}}'
                @change="updateDataSourceJson(index, 'mockData', ($event.target as HTMLTextAreaElement).value)"
              />
            </label>
          </div>
        </section>
      </div>
      <div v-else class="module-empty">暂无接口配置。</div>
    </el-dialog>
  </main>
</template>

<style scoped>
.api-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.api-config-title {
  color: #111827;
  font-weight: 700;
}

.api-config-hint {
  margin-top: 4px;
  color: #6b7280;
  font-size: 12px;
}

.api-source-list {
  display: grid;
  gap: 12px;
  max-height: 68vh;
  overflow: auto;
  padding-right: 4px;
}

.api-source-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #d8dde6;
  border-radius: 8px;
}

.api-source-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.api-source-title {
  font-weight: 700;
}

.api-form-grid {
  display: grid;
  grid-template-columns: 1.2fr 1.2fr 120px 90px;
  gap: 10px;
}

.api-form-grid.wide {
  grid-template-columns: minmax(240px, 1fr) 100px 150px 120px;
}

.api-form-grid.ws {
  grid-template-columns: minmax(240px, 1fr) 150px 150px 120px;
}

.api-json-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

label {
  display: grid;
  gap: 6px;
  color: #4b5563;
  font-size: 13px;
}

input,
select,
textarea {
  width: 100%;
  padding: 8px;
  color: #111827;
  background: #f9fafb;
  border: 1px solid #d8dde6;
  border-radius: 6px;
}

textarea {
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.api-checkbox {
  grid-template-columns: 16px 1fr;
  align-items: center;
  align-self: end;
  min-height: 36px;
}

.api-checkbox input {
  width: 16px;
  height: 16px;
  padding: 0;
}
</style>
