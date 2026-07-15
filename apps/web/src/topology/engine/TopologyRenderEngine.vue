<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import TopologyCanvas from '../components/TopologyCanvas/index.vue';
import { listEnabledNodeTypes } from '../services/nodeTypeApi';
import { queryRuntime } from '../services/runtimeApi';
import { getTopology } from '../services/topologyApi';
import {
  buildTopologyExpressionContext,
  defaultRuntimeSource,
  nodeIdentifier,
  nodeRuleIdentityCandidates,
  readExpressionPath,
  resolveLinkRuntimeWithTrace,
  resolveNodeRuntimeWithTrace,
  resolveTemplateString,
  type ExpressionContext,
  type LinkRuntime,
  type NodeRuntime,
  type NodeTypeDefinition,
  type TopologyData,
  type TopologyEvent,
  type TopologyLink,
  type TopologyNode
} from '@topo-editor/topology-shared';

const props = withDefaults(
  defineProps<{
    topologyId: string;
    metaData?: Record<string, unknown>;
    params?: Record<string, unknown>;
    autoRefresh?: boolean;
    transparent?: boolean;
  }>(),
  {
    autoRefresh: true,
    transparent: true
  }
);

const emit = defineEmits<{
  'event-emit': [event: Extract<TopologyEvent, { type: 'NODE_EVENT' }>];
  loaded: [topology: TopologyData];
  error: [error: unknown];
}>();

const nodeTypes = ref<NodeTypeDefinition[]>([]);
const topology = ref<TopologyData | null>(null);
const templateTopology = ref<TopologyData | null>(null);
const selectedKey = ref('');
const loading = ref(false);
const loadStage = ref('');
const canvasReady = ref(false);
const lastRuntimeSnapshot = ref<Record<string, unknown>>({});
const canvasRef = ref<{
  applyRuntimePatch: (patch: {
    nodes: Array<{ key: string; runtime: TopologyNode['runtime'] }>;
    links: Array<{ key: string; runtime: TopologyLink['runtime'] }>;
  }) => boolean;
} | null>(null);

let timer: number | undefined;
let lastFullyAppliedBase: TopologyData | null = null;
let refreshToken = 0;
let canvasReadyResolver: (() => void) | null = null;

function resetCanvasReady() {
  canvasReady.value = false;
  canvasReadyResolver?.();
  canvasReadyResolver = null;
}

function handleCanvasReady() {
  canvasReady.value = true;
  canvasReadyResolver?.();
  canvasReadyResolver = null;
}

function waitForCanvasReady() {
  if (canvasReady.value) return Promise.resolve();
  return new Promise<void>((resolve) => {
    canvasReadyResolver = resolve;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneTopology(data: TopologyData) {
  return structuredClone(data);
}

function expressionBaseContext(metaData = props.metaData ?? {}, params = props.params ?? {}): ExpressionContext {
  return {
    ...params,
    ...metaData,
    params,
    metaData
  };
}

const eventContext = computed(() => ({
  ...expressionBaseContext(),
  ...lastRuntimeSnapshot.value,
  runtimeData: lastRuntimeSnapshot.value
}));

function enabledRuntimeSources(data: TopologyData) {
  return (data.dataSources ?? []).filter((source) => source.enabled !== false && source.type !== 'websocket');
}

function nodeDataKeys(node: TopologyNode) {
  return nodeRuleIdentityCandidates(node);
}

function writeNodeFieldAliases(context: ExpressionContext, node: TopologyNode, field: string, value: unknown) {
  context[`${node.key}.${field}`] = value;
  const identifier = nodeIdentifier(node);
  if (identifier) context[`${identifier}.${field}`] = value;
}

function readDefaultNodeField(sourceData: Record<string, unknown>, node: TopologyNode, fieldName: string) {
  const candidates = nodeDataKeys(node);
  const fieldNames = fieldName === 'state' ? ['state', 'status'] : fieldName === 'status' ? ['status', 'state'] : [fieldName];
  for (const key of candidates) {
    for (const itemFieldName of fieldNames) {
      const directValue = readExpressionPath(sourceData, `${key}.${itemFieldName}`);
      if (directValue !== undefined) return directValue;
      const dataValue = readExpressionPath(sourceData, `data.${key}.${itemFieldName}`);
      if (dataValue !== undefined) return dataValue;
    }
  }
  return fieldNames.map((itemFieldName) => readExpressionPath(sourceData, itemFieldName)).find((value) => value !== undefined);
}

function exposeNodeFieldsFromRecord(context: ExpressionContext, node: TopologyNode, sourceData: Record<string, unknown>) {
  const candidates = nodeDataKeys(node);
  for (const fieldName of ['status', 'state']) {
    const value = readDefaultNodeField(sourceData, node, fieldName);
    if (value !== undefined) writeNodeFieldAliases(context, node, fieldName, value);
  }
  for (const key of candidates) {
    const directRecord = readExpressionPath(sourceData, key);
    const dataRecord = readExpressionPath(sourceData, `data.${key}`);
    const record = isRecord(dataRecord) ? dataRecord : isRecord(directRecord) ? directRecord : null;
    if (!record) continue;
    for (const [field, value] of Object.entries(record)) {
      writeNodeFieldAliases(context, node, field, value);
      context[`${node.key}.${key}.${field}`] = value;
      context[`${node.key}.data.${key}.${field}`] = value;
      const identifier = nodeIdentifier(node);
      if (identifier) {
        context[`${identifier}.${key}.${field}`] = value;
        context[`${identifier}.data.${key}.${field}`] = value;
      }
    }
  }
}

function exposeSourceNodeAliases(context: ExpressionContext, sourceId: string, sourceData: Record<string, unknown>, nodes: TopologyNode[]) {
  for (const node of nodes) {
    for (const key of nodeDataKeys(node)) {
      const directRecord = readExpressionPath(sourceData, key);
      const dataRecord = readExpressionPath(sourceData, `data.${key}`);
      const record = isRecord(dataRecord) ? dataRecord : isRecord(directRecord) ? directRecord : null;
      if (!record) continue;
      for (const [field, value] of Object.entries(record)) {
        context[`${sourceId}.${key}.${field}`] = value;
        context[`${sourceId}.data.${key}.${field}`] = value;
      }
    }
  }
}

function exposeSourceFieldAliases(context: ExpressionContext, sourceId: string, sourceData: Record<string, unknown>, exposeShortAlias: boolean) {
  for (const [field, value] of Object.entries(sourceData)) {
    if (field.startsWith('_')) continue;
    if (field === 'data' && isRecord(value)) {
      for (const [dataField, dataValue] of Object.entries(value)) {
        if (dataField.startsWith('_')) continue;
        context[`${sourceId}.data.${dataField}`] = dataValue;
        if (exposeShortAlias && context[dataField] === undefined) context[dataField] = dataValue;
      }
      continue;
    }
    if (context[`${sourceId}.data.${field}`] === undefined) context[`${sourceId}.data.${field}`] = value;
    if (exposeShortAlias && context[field] === undefined) context[field] = value;
  }
}

function buildRuntimeContext(data: TopologyData, runtime: Record<string, unknown>): ExpressionContext {
  return buildTopologyExpressionContext(data, runtime, expressionBaseContext());
}

function buildDefaultLinkRuntime(link: TopologyLink): LinkRuntime {
  return {
    visible: link.runtime?.visible,
    state: link.defaultState ?? 'off',
    color: link.defaultStyle?.color ?? '#42B0FF',
    width: link.defaultStyle?.width ?? 2,
    opacity: link.defaultStyle?.opacity ?? 1,
    lineCap: link.defaultStyle?.lineCap ?? 'butt',
    animated: link.defaultStyle?.animated ?? false,
    flowDirection: link.defaultStyle?.flowDirection ?? 'fromTo',
    dash: link.defaultStyle?.dash,
    flow: link.defaultStyle?.flow,
    glow: link.defaultStyle?.glow,
    visibility: link.runtime?.visibility
  };
}

function buildRuleCleanNodeRuntime(node: TopologyNode, text?: string): NodeRuntime {
  const baseRuntime: NodeRuntime = {
    ...node.runtime,
    text: text ?? node.runtime?.text
  };
  const dynamicFields = new Set<string>();

  for (const rule of node.displayRules ?? []) {
    for (const [field, value] of Object.entries(rule.action)) {
      if (value !== undefined) dynamicFields.add(field);
    }
  }

  const cleanRuntime = { ...baseRuntime } as Record<string, unknown>;
  for (const field of dynamicFields) delete cleanRuntime[field];
  if (typeof node.props?.buttonDefaultVisible === 'boolean') cleanRuntime.visible = node.props.buttonDefaultVisible;
  if (text !== undefined) cleanRuntime.text = text;
  return cleanRuntime as NodeRuntime;
}

function readMappedRuntimeValue(sourceData: Record<string, unknown>, path: string) {
  const value = readExpressionPath(sourceData, path);
  if (value !== undefined) return value;
  if (path.startsWith('data.')) return readExpressionPath(sourceData, path.slice(5));
  return readExpressionPath(sourceData, `data.${path}`);
}

function resolveRuntimeNodeText(node: TopologyNode, runtime: Record<string, unknown>, runtimeContext: ExpressionContext) {
  const sourceId = node.dataBinding?.sourceId;
  const sourceData = sourceId ? (runtime[sourceId] as Record<string, unknown> | undefined) : undefined;
  const values = sourceData
    ? Object.fromEntries(Object.entries(node.dataBinding?.mappings ?? {}).map(([name, path]) => [name, readMappedRuntimeValue(sourceData, path)]))
    : {};
  const textTemplate = typeof node.props?.textTemplate === 'string' ? node.props.textTemplate : undefined;
  return textTemplate
    ? resolveTemplateString(textTemplate, {
        ...runtimeContext,
        ...values,
        node: values
      })
    : node.runtime?.text;
}

function resolveNodeRuntime(node: TopologyNode, context: ExpressionContext, text?: string): NodeRuntime {
  return resolveNodeRuntimeWithTrace(node.displayRules ?? [], context, buildRuleCleanNodeRuntime(node, text), templateTopology.value ?? undefined).runtime;
}

function resolveLinkRuntime(link: TopologyLink, context: ExpressionContext): LinkRuntime {
  return resolveLinkRuntimeWithTrace(link.rules ?? [], context, buildDefaultLinkRuntime(link), templateTopology.value ?? undefined).runtime;
}

function runtimeSignature(value: unknown) {
  return JSON.stringify(value ?? null);
}

function applyRuntimeData(runtime: Record<string, unknown>) {
  const base = templateTopology.value;
  if (!base) return;
  lastRuntimeSnapshot.value = runtime;
  const runtimeContext = buildRuntimeContext(base, runtime);

  const nextNodeRuntimes = base.nodes.map((node) => ({
    key: node.key,
    runtime: resolveNodeRuntime(node, runtimeContext, resolveRuntimeNodeText(node, runtime, runtimeContext))
  }));
  const nextLinkRuntimes = base.links.map((link) => ({
    key: link.key,
    runtime: resolveLinkRuntime(link, runtimeContext)
  }));

  const current = topology.value;
  const canPatchIncrementally =
    current && lastFullyAppliedBase === base && current.nodes.length === base.nodes.length && current.links.length === base.links.length;

  if (!canPatchIncrementally) {
    topology.value = {
      ...base,
      nodes: base.nodes.map((node, index) => ({ ...node, runtime: nextNodeRuntimes[index].runtime })),
      links: base.links.map((link, index) => ({ ...link, runtime: nextLinkRuntimes[index].runtime }))
    };
    lastFullyAppliedBase = base;
    return;
  }

  const nodePatches = nextNodeRuntimes.filter((item, index) => runtimeSignature(item.runtime) !== runtimeSignature(current.nodes[index].runtime));
  const linkPatches = nextLinkRuntimes.filter((item, index) => runtimeSignature(item.runtime) !== runtimeSignature(current.links[index].runtime));
  if (!nodePatches.length && !linkPatches.length) return;

  const applied = canvasRef.value?.applyRuntimePatch({ nodes: nodePatches, links: linkPatches }) ?? false;
  const nodesByKey = new Map(current.nodes.map((node) => [node.key, node]));
  const linksByKey = new Map(current.links.map((link) => [link.key, link]));
  for (const { key, runtime: nodeRuntime } of nodePatches) {
    const node = nodesByKey.get(key);
    if (node) node.runtime = nodeRuntime;
  }
  for (const { key, runtime: linkRuntime } of linkPatches) {
    const link = linksByKey.get(key);
    if (link) link.runtime = linkRuntime;
  }
  if (!applied) {
    topology.value = { ...current, nodes: [...current.nodes], links: [...current.links] };
    lastFullyAppliedBase = base;
  }
}

async function refreshRuntimeData() {
  const base = templateTopology.value;
  if (!base) return;
  const sources = enabledRuntimeSources(base);
  const runtime = sources.length
    ? await queryRuntime(
        base.id,
        sources.map((source) => source.sourceId),
        undefined,
        {
          preview: false,
          parentParams: props.params ?? {},
          params: props.params ?? {},
          metaData: props.metaData ?? {},
          sources: base.dataSources
        }
      )
    : {};
  applyRuntimeData(runtime);
}

async function safeRefreshRuntimeData() {
  try {
    await refreshRuntimeData();
  } catch (error) {
    emit('error', error);
    applyRuntimeData(lastRuntimeSnapshot.value);
  }
}

function runtimePollingInterval() {
  const intervals = enabledRuntimeSources(templateTopology.value ?? { dataSources: [], nodes: [], links: [], id: '', name: '', version: '' })
    .map((source) => source.config?.interval ?? 3000)
    .filter((interval) => interval > 0);
  return intervals.length ? Math.min(...intervals) : 0;
}

function stopPolling() {
  if (timer) window.clearInterval(timer);
  timer = undefined;
}

function startPolling() {
  stopPolling();
  if (!props.autoRefresh) return;
  const interval = runtimePollingInterval();
  if (interval > 0) {
    timer = window.setInterval(() => {
      if (document.hidden) return;
      void safeRefreshRuntimeData();
    }, interval);
  }
}

async function nextPaintFrame() {
  await nextTick();
  await new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve(null));
  });
}

async function loadEngine() {
  const token = ++refreshToken;
  stopPolling();
  if (!props.topologyId) return;
  loading.value = true;
  loadStage.value = '加载拓扑';
  try {
    const loadedTopology = await getTopology(props.topologyId);
    if (token !== refreshToken) return;
    if (!loadedTopology) throw new Error('拓扑不存在');

    templateTopology.value = cloneTopology(loadedTopology);

    loadStage.value = '加载节点类型';
    try {
      nodeTypes.value = await listEnabledNodeTypes();
    } catch {
      nodeTypes.value = [];
    }
    if (token !== refreshToken) return;

    resetCanvasReady();
    topology.value = cloneTopology(loadedTopology);
    lastFullyAppliedBase = templateTopology.value;

    loadStage.value = '加载运行数据';
    await nextPaintFrame();
    await safeRefreshRuntimeData();
    if (token !== refreshToken) return;
    loadStage.value = '加载节点图片';
    await waitForCanvasReady();
    if (token !== refreshToken) return;
    startPolling();
    if (topology.value) emit('loaded', topology.value);
  } catch (error) {
    emit('error', error);
  } finally {
    if (token === refreshToken) {
      loading.value = false;
      loadStage.value = '';
    }
  }
}

function handleCanvasEvent(event: TopologyEvent) {
  if ('nodeKey' in event) selectedKey.value = event.nodeKey;
  if (event.type === 'LINK_CLICK') selectedKey.value = event.linkKey;
  if (event.type === 'NODE_EVENT') emit('event-emit', event);
}

function handleVisibilityChange() {
  if (!document.hidden && topology.value) void safeRefreshRuntimeData();
}

defineExpose({
  refreshRuntimeData: safeRefreshRuntimeData
});

onMounted(() => {
  void loadEngine();
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  canvasReadyResolver?.();
  canvasReadyResolver = null;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  stopPolling();
});

watch(
  () => props.topologyId,
  () => {
    void loadEngine();
  }
);

watch(
  () => [props.metaData, props.params],
  () => {
    void safeRefreshRuntimeData();
  },
  { deep: true }
);

watch(() => props.autoRefresh, startPolling);
</script>

<template>
  <div class="topology-render-engine" :class="{ 'is-transparent': transparent }">
    <TopologyCanvas
      ref="canvasRef"
      mode="runtime"
      :topology-data="topology"
      :node-types="nodeTypes"
      :selected-key="selectedKey"
      :event-context="eventContext"
      :editor-background-theme="transparent ? 'transparent' : 'light'"
      :show-canvas-boundary="false"
      :enable-wheel-zoom="false"
      :auto-fit="true"
      @event="handleCanvasEvent"
      @selection-change="selectedKey = $event"
      @ready="handleCanvasReady"
    />
    <div v-if="loading" class="topology-render-engine__loading">{{ loadStage || '加载中' }}...</div>
  </div>
</template>

<style scoped>
.topology-render-engine {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 240px;
  overflow: hidden;
  background: #ffffff;
}

.topology-render-engine.is-transparent {
  background: transparent;
}

.topology-render-engine :deep(.topology-canvas-shell),
.topology-render-engine :deep(.topology-canvas) {
  width: 100%;
  height: 100%;
  background: transparent;
}

.topology-render-engine__loading {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  background: rgb(255 255 255 / 36%);
  backdrop-filter: blur(1px);
  pointer-events: none;
}

.topology-render-engine.is-transparent .topology-render-engine__loading {
  background: transparent;
}
</style>
