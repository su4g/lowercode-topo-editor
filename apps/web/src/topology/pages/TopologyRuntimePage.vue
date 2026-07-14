<script setup lang="ts">
import { createExpressionContext, defaultRuntimeSource, findNodeByRuleIdentity, isConditionGroup, nodeIdentifier, nodeRuleIdentityCandidates, normalizeExpressionPath, readExpressionPath, resolveExpressionValue, resolveLinkRuntimeWithTrace, resolveNodeRuntimeWithTrace, resolveTemplateString, type ConditionGroup, type DataSourceReference, type ExpressionContext, type LinkRuntime, type NodeRuntime, type NodeTypeDefinition, type RuleOverviewGroup, type TopologyData, type TopologyEvent, type TopologyLink, type TopologyNode } from "@topo-editor/topology-shared";
import { ElMessage } from "element-plus";
import { ArrowLeft, Connection, Edit, Refresh, Tickets } from "@element-plus/icons-vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import JsonTextEditor from "../components/JsonTextEditor.vue";
import RuleOverviewPanel from "../components/RuleOverviewPanel/index.vue";
import TopologyCanvas from "../components/TopologyCanvas/index.vue";
import { listEnabledNodeTypes } from "../services/nodeTypeApi";
import { queryRuntime } from "../services/runtimeApi";
import { getTopology } from "../services/topologyApi";

const route = useRoute();
const router = useRouter();
const nodeTypes = ref<NodeTypeDefinition[]>([]);
const topology = ref<TopologyData | null>(null);
const templateTopology = ref<TopologyData | null>(null);
const selectedKey = ref("");
const selectedNode = computed(() => topology.value?.nodes.find((node) => node.key === selectedKey.value) ?? null);
const selectedLink = computed(() => topology.value?.links.find((link) => link.key === selectedKey.value) ?? null);
const eventContext = computed(() => {
  const metaData = readExpressionMetaData();
  return {
    ...metaData,
    ...lastRuntimeSnapshot.value,
    metaData,
    mateData: metaData,
    runtimeData: lastRuntimeSnapshot.value
  };
});
const isPreview = computed(() => route.query.preview === "1");
const isDebugRuntime = computed(() => isPreview.value || route.query.debug === "1");
const previewApiDialogVisible = ref(false);
const canvasPreviewTheme = ref<"light" | "dark">("light");
const previewMockData = ref<Record<string, Record<string, unknown>>>({});
const previewApplying = ref(false);
const previewDataSources = computed(() => currentTemplateTopology()?.dataSources ?? []);
const previewEventLogs = ref<PreviewEventLog[]>([]);
const ruleOverviewOpen = ref(false);
const canvasRef = ref<{
  applyRuntimePatch: (patch: {
    nodes: Array<{ key: string; runtime: TopologyNode["runtime"] }>;
    links: Array<{ key: string; runtime: TopologyLink["runtime"] }>;
  }) => boolean;
} | null>(null);
let lastFullyAppliedBase: TopologyData | null = null;
const initialLoading = ref(false);
const loadProgress = ref(0);
const loadStage = ref("");
const canvasReady = ref(false);
let canvasReadyResolver: (() => void) | null = null;
let timer: number | undefined;
let wsConnections: WebSocket[] = [];
let wsHeartbeatTimers: number[] = [];
const lastRuntimeSnapshot = ref<Record<string, unknown>>({});
let lastHttpRuntime: Record<string, unknown> = {};
const wsRuntimeData = ref<Record<string, Record<string, unknown>>>({});

type PreviewEventLog = {
  id: string;
  time: string;
  eventName: string;
  eventKey: string;
  trigger: string;
  nodeKey: string;
  nodeLabel: string;
  bindNodeKey?: string;
  data: Record<string, unknown>;
};

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

type ParentParamWindow = Window & {
  __TOPOLOGY_PARENT_PARAMS__?: Record<string, string | number | boolean>;
  __TOPOLOGY_META_DATA__?: Record<string, unknown>;
};

function readMetaData() {
  const windowParams = (window as ParentParamWindow).__TOPOLOGY_PARENT_PARAMS__ ?? {};
  const windowMetaData = (window as ParentParamWindow).__TOPOLOGY_META_DATA__ ?? {};
  const routeParams = Object.fromEntries(Object.entries(route.query)
    .filter(([key]) => key !== "preview")
    .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return {
    ...windowParams,
    ...windowMetaData,
    ...routeParams
  };
}

function readExpressionMetaData() {
  return createExpressionContext(readMetaData()).metaData as Record<string, unknown>;
}

function readPreviewTopology(id: string) {
  const raw = sessionStorage.getItem(`topology-preview:${id}`) ?? sessionStorage.getItem("topology-preview:last");
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as TopologyData;
    return data.id === id ? data : { ...data, id };
  } catch {
    return null;
  }
}

function cloneTopology(data: TopologyData) {
  // 入参始终是接口 / sessionStorage 反序列化出的纯 JSON 对象，structuredClone 比 JSON 往返更快
  return structuredClone(data);
}

function currentTemplateTopology() {
  return templateTopology.value ?? topology.value;
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function jsonObject(value: unknown) {
  return isRecord(value) ? value : {};
}

function nodeTypeName(typeId: string) {
  return nodeTypes.value.find((nodeType) => nodeType.id === typeId)?.name ?? typeId;
}

function selectedLinkLabel(link: TopologyLink) {
  const from = topology.value?.nodes.find((node) => node.key === link.from)?.label ?? link.from;
  const to = topology.value?.nodes.find((node) => node.key === link.to)?.label ?? link.to;
  return link.label || `${from} -> ${to}`;
}

function runtimeStatusText(node: TopologyNode) {
  const runtime = node.runtime as (NodeRuntime & { state?: string }) | undefined;
  return runtime?.status ?? runtime?.state ?? "默认";
}

function handleCanvasEvent(event: TopologyEvent) {
  if ("nodeKey" in event) selectedKey.value = event.nodeKey;
  if (event.type === "LINK_CLICK") selectedKey.value = event.linkKey;

  if (!isDebugRuntime.value || event.type !== "NODE_EVENT") return;
  previewEventLogs.value = [
    {
      id: `${Date.now()}_${Math.round(Math.random() * 1000)}`,
      time: new Date().toLocaleTimeString(),
      eventName: event.eventName,
      eventKey: event.eventKey,
      trigger: event.trigger,
      nodeKey: event.nodeKey,
      nodeLabel: event.nodeData.label || event.nodeKey,
      bindNodeKey: event.bindNodeKey,
      data: event.data
    },
    ...previewEventLogs.value
  ].slice(0, 50);
}

function clearPreviewEventLogs() {
  previewEventLogs.value = [];
}

function persistPreviewTopology() {
  if (!isPreview.value || !templateTopology.value) return;
  const previewPayload = JSON.stringify(templateTopology.value);
  sessionStorage.setItem(`topology-preview:${templateTopology.value.id}`, previewPayload);
  sessionStorage.setItem("topology-preview:last", previewPayload);
}

function resetPreviewMockDrafts() {
  previewMockData.value = Object.fromEntries((currentTemplateTopology()?.dataSources ?? []).map((source, index) => [
    String(index),
    jsonObject(source.config?.mockData ?? source.config?.data)
  ]));
}

function openPreviewApiDialog() {
  resetPreviewMockDrafts();
  previewApiDialogVisible.value = true;
}

function updatePreviewMockDraft(index: number, value: Record<string, unknown>) {
  previewMockData.value = {
    ...previewMockData.value,
    [String(index)]: value
  };
}

async function applyPreviewMockData() {
  const base = currentTemplateTopology();
  if (!base) return;

  const nextDataSources: DataSourceReference[] = [];
  for (const [index, source] of (base.dataSources ?? []).entries()) {
    nextDataSources.push({
      ...source,
      config: {
        ...(source.config ?? {}),
        mockData: previewMockData.value[String(index)] ?? {}
      }
    });
  }

  previewApplying.value = true;
  try {
    templateTopology.value = {
      ...base,
      dataSources: nextDataSources
    };
    persistPreviewTopology();
    await safeRefreshRuntime(true);
    ElMessage.success("预览 Mock 已应用");
  } finally {
    previewApplying.value = false;
  }
}

function collectRuntimeQuery(data: TopologyData) {
  const sourceIds = new Set<string>();
  const fields = new Set<string>();
  let shouldQueryFullPayload = false;
  const metaData = readExpressionMetaData();

  for (const node of data.nodes) {
    if (!node.dataBinding?.enabled || !node.dataBinding.sourceId) continue;
    if (!isDebugRuntime.value && isWebSocketSource(data, node.dataBinding.sourceId)) continue;
    sourceIds.add(node.dataBinding.sourceId);
    for (const field of Object.values(node.dataBinding.mappings ?? {})) fields.add(field);
  }

  for (const node of data.nodes) {
    const textTemplate = typeof node.props?.textTemplate === "string" ? node.props.textTemplate : "";
    for (const field of collectTemplateFields(textTemplate)) {
      const [target, fieldName] = splitRuntimeField(field);
      if (!target || !fieldName) {
        const defaultSource = defaultRuntimeSource(data);
        if (defaultSource) {
          sourceIds.add(defaultSource.sourceId);
          shouldQueryFullPayload = true;
        }
        continue;
      }
      if (!shouldQueryRuntimeField(data, target, metaData)) continue;
      if (data.dataSources?.some((source) => source.sourceId === target)) {
        if (!isDebugRuntime.value && isWebSocketSource(data, target)) continue;
        sourceIds.add(target);
        shouldQueryFullPayload = true;
        continue;
      }
      const defaultSource = defaultRuntimeSource(data);
      if (defaultSource) {
        sourceIds.add(defaultSource.sourceId);
        shouldQueryFullPayload = true;
      }
    }

    for (const rule of node.displayRules ?? []) {
      for (const field of collectConditionFields(rule.condition)) {
        const [target, fieldName] = splitRuntimeField(field);
        if (!target || !fieldName) {
          const defaultSource = defaultRuntimeSource(data);
          if (defaultSource) {
            sourceIds.add(defaultSource.sourceId);
            shouldQueryFullPayload = true;
          }
          continue;
        }
        if (!shouldQueryRuntimeField(data, target, metaData)) continue;
        const ruleNode = findRuntimeNode(data, target);
        if (ruleNode?.dataBinding?.sourceId) {
          if (!isDebugRuntime.value && isWebSocketSource(data, ruleNode.dataBinding.sourceId)) continue;
          sourceIds.add(ruleNode.dataBinding.sourceId);
          fields.add(ruleNode.dataBinding.mappings?.[fieldName] ?? fieldName);
          continue;
        }
        const defaultSource = ruleNode ? defaultRuntimeSource(data) : null;
        if (defaultSource) {
          sourceIds.add(defaultSource.sourceId);
          shouldQueryFullPayload = true;
          continue;
        }
        if (!isDebugRuntime.value && isWebSocketSource(data, target)) continue;
        sourceIds.add(target);
        shouldQueryFullPayload = true;
      }
    }
  }

  for (const link of data.links) {
    for (const rule of link.rules ?? []) {
      for (const field of collectConditionFields(rule.condition)) {
        const [target, fieldName] = splitRuntimeField(field);
        if (!target || !fieldName) {
          const defaultSource = defaultRuntimeSource(data);
          if (defaultSource) {
            sourceIds.add(defaultSource.sourceId);
            shouldQueryFullPayload = true;
          }
          continue;
        }
        if (!shouldQueryRuntimeField(data, target, metaData)) continue;
        const node = findRuntimeNode(data, target);
        if (node?.dataBinding?.sourceId) {
          if (!isDebugRuntime.value && isWebSocketSource(data, node.dataBinding.sourceId)) continue;
          sourceIds.add(node.dataBinding.sourceId);
          fields.add(node.dataBinding.mappings?.[fieldName] ?? fieldName);
          continue;
        }
        const defaultSource = node ? defaultRuntimeSource(data) : null;
        if (defaultSource) {
          sourceIds.add(defaultSource.sourceId);
          shouldQueryFullPayload = true;
          continue;
        }
        if (!isDebugRuntime.value && isWebSocketSource(data, target)) continue;
        sourceIds.add(target);
        shouldQueryFullPayload = true;
      }
    }
  }

  return { sourceIds: [...sourceIds], fields: shouldQueryFullPayload ? undefined : [...fields] };
}

function dataSourceById(data: TopologyData, sourceId: string) {
  return data.dataSources?.find((source) => source.sourceId === sourceId);
}

function isWebSocketSource(data: TopologyData, sourceId: string) {
  return dataSourceById(data, sourceId)?.type === "websocket";
}

function collectConditionFields(group: ConditionGroup): string[] {
  return group.conditions.flatMap((condition) => {
    if (isConditionGroup(condition)) return collectConditionFields(condition);
    return condition.field ? [condition.field] : [];
  });
}

function collectTemplateFields(template: string) {
  return [...template.matchAll(/\$\{\s*([a-zA-Z0-9_.-]+)\s*\}|\{([a-zA-Z0-9_.-]+)\}/g)]
    .map((match) => match[1] ?? match[2])
    .filter(Boolean);
}

function splitRuntimeField(field: string) {
  const normalizedField = normalizeExpressionPath(field);
  const index = normalizedField.indexOf(".");
  if (index < 0) return [normalizedField, ""] as const;
  return [normalizedField.slice(0, index), normalizedField.slice(index + 1)] as const;
}

function shouldQueryRuntimeField(data: TopologyData, target: string, metaData: Record<string, unknown>) {
  if (["metaData", "mateData", "runtimeData"].includes(target)) return false;
  const isKnownRuntimeTarget = Boolean(findRuntimeNode(data, target))
    || data.dataSources?.some((source) => source.sourceId === target);
  return isKnownRuntimeTarget || !(target in metaData);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findRuntimeNode(data: TopologyData, target: string) {
  return findNodeByRuleIdentity(data.nodes, target);
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
  const fieldNames = fieldName === "state"
    ? ["state", "status"]
    : fieldName === "status"
      ? ["status", "state"]
      : [fieldName];
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
  for (const fieldName of ["status", "state"]) {
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
    if (field.startsWith("_")) continue;

    if (field === "data" && isRecord(value)) {
      for (const [dataField, dataValue] of Object.entries(value)) {
        if (dataField.startsWith("_")) continue;
        context[`${sourceId}.data.${dataField}`] = dataValue;
        if (exposeShortAlias && context[dataField] === undefined) context[dataField] = dataValue;
      }
      continue;
    }

    if (context[`${sourceId}.data.${field}`] === undefined) context[`${sourceId}.data.${field}`] = value;
    if (exposeShortAlias && context[field] === undefined) context[field] = value;
  }
}

function buildRuntimeContext(data: TopologyData, runtime: Record<string, unknown>, metaData: Record<string, unknown>): ExpressionContext {
  const context: ExpressionContext = {
    ...createExpressionContext(metaData),
    runtimeData: runtime,
    ...runtime
  };
  const defaultSource = defaultRuntimeSource(data);

  for (const source of data.dataSources ?? []) {
    const sourceData = runtime[source.sourceId];
    if (isRecord(sourceData)) {
      exposeSourceFieldAliases(context, source.sourceId, sourceData, defaultSource?.sourceId === source.sourceId);
      exposeSourceNodeAliases(context, source.sourceId, sourceData, data.nodes);
    }
  }
  const defaultSourceData = defaultSource ? runtime[defaultSource.sourceId] as Record<string, unknown> | undefined : undefined;

  for (const node of data.nodes) {
    const sourceId = node.dataBinding?.sourceId;
    if (!sourceId) {
      if (isRecord(defaultSourceData)) exposeNodeFieldsFromRecord(context, node, defaultSourceData);
      continue;
    }
    const sourceData = runtime[sourceId] as Record<string, unknown> | undefined;
    if (!sourceData) continue;

    for (const [field, value] of Object.entries(sourceData)) {
      context[`${sourceId}.${field}`] = value;
      context[`${node.key}.${field}`] = value;
    }

    for (const [alias, path] of Object.entries(node.dataBinding?.mappings ?? {})) {
      context[`${node.key}.${alias}`] = readExpressionPath(sourceData, path);
    }
  }

  if (defaultSource && isRecord(defaultSourceData)) {
    for (const key of ["status", "state"]) {
      const value = readExpressionPath(defaultSourceData, key);
      if (value !== undefined) context[key] = value;
    }
  }

  return context;
}

function buildDefaultLinkRuntime(link: TopologyLink): LinkRuntime {
  return {
    visible: link.runtime?.visible,
    state: link.defaultState ?? "off",
    color: link.defaultStyle?.color ?? "#42B0FF",
    width: link.defaultStyle?.width ?? 2,
    opacity: link.defaultStyle?.opacity ?? 1,
    lineCap: link.defaultStyle?.lineCap ?? "butt",
    animated: link.defaultStyle?.animated ?? false,
    flowDirection: link.defaultStyle?.flowDirection ?? "fromTo",
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
  if (typeof node.props?.buttonDefaultVisible === "boolean") cleanRuntime.visible = node.props.buttonDefaultVisible;
  if (text !== undefined) cleanRuntime.text = text;
  return cleanRuntime as NodeRuntime;
}

function resolveLinkRuntime(link: TopologyLink, context: ExpressionContext): LinkRuntime {
  return resolveLinkRuntimeWithTrace(link.rules ?? [], context, buildDefaultLinkRuntime(link)).runtime;
}

function resolveNodeRuntime(node: TopologyNode, context: ExpressionContext, text?: string): NodeRuntime {
  return resolveNodeRuntimeWithTrace(node.displayRules ?? [], context, buildRuleCleanNodeRuntime(node, text)).runtime;
}

// 规则总览使用与画布完全一致的求值上下文，随运行快照变化自动刷新
const runtimeEvalContext = computed<ExpressionContext>(() => {
  const base = currentTemplateTopology();
  if (!base) return {};
  return buildRuntimeContext(base, lastRuntimeSnapshot.value, readExpressionMetaData());
});

function countEvaluations(evaluations: RuleOverviewGroup["evaluations"]) {
  return {
    active: evaluations.filter((item) => item.status === "active").length,
    overridden: evaluations.filter((item) => item.status === "overridden").length,
    inactive: evaluations.filter((item) => item.status === "inactive").length,
    total: evaluations.length
  };
}

const ruleOverview = computed<{ nodes: RuleOverviewGroup[]; links: RuleOverviewGroup[] }>(() => {
  // computed 惰性求值：面板关闭时不会被读取，对轮询性能零影响
  const base = currentTemplateTopology();
  if (!ruleOverviewOpen.value || !base) return { nodes: [], links: [] };
  const context = runtimeEvalContext.value;

  const nodes = base.nodes.map((node) => {
    const { runtime, evaluations } = resolveNodeRuntimeWithTrace(node.displayRules ?? [], context, buildRuleCleanNodeRuntime(node));
    return {
      kind: "node" as const,
      key: node.key,
      label: node.label || node.key,
      typeName: node.isGroup ? "分组" : nodeTypeName(node.typeId),
      statusText: (runtime as NodeRuntime & { state?: string }).status ?? "默认",
      visible: runtime.visible !== false,
      evaluations,
      counts: countEvaluations(evaluations)
    };
  });

  const links = base.links.map((link) => {
    const { runtime, evaluations } = resolveLinkRuntimeWithTrace(link.rules ?? [], context, buildDefaultLinkRuntime(link));
    return {
      kind: "link" as const,
      key: link.key,
      label: selectedLinkLabel(link),
      typeName: "连线",
      statusText: runtime.state ?? link.defaultState ?? "默认",
      visible: runtime.visible !== false,
      evaluations,
      counts: countEvaluations(evaluations)
    };
  });

  return { nodes, links };
});

function resolveRecord<T extends Record<string, unknown>>(value: T | undefined, context: ExpressionContext) {
  return resolveExpressionValue(value ?? {}, context) as T;
}

function createWebSocketUrl(source: DataSourceReference, context: ExpressionContext) {
  const rawUrl = source.config?.ws?.url || source.config?.url;
  if (!rawUrl) return "";
  const query = resolveRecord(source.config?.query, context) as Record<string, string>;
  const url = new URL(resolveTemplateString(rawUrl, context), window.location.href);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function readMappedRuntimeValue(sourceData: Record<string, unknown>, path: string) {
  const value = readExpressionPath(sourceData, path);
  if (value !== undefined) return value;
  const normalizedPath = normalizeExpressionPath(path);
  if (normalizedPath.startsWith("data.")) return readExpressionPath(sourceData, normalizedPath.slice(5));
  return readExpressionPath(sourceData, `data.${normalizedPath}`);
}

function mergeWebSocketPayload(source: DataSourceReference, message: unknown) {
  if (typeof message !== "object" || message === null) return;
  const rootPath = source.config?.ws?.dataRootPath || source.config?.responseMapping?.rootPath;
  const sourceData = rootPath
    ? readExpressionPath(message as Record<string, unknown>, rootPath)
    : message;
  if (typeof sourceData !== "object" || sourceData === null) return;

  const keyPath = source.config?.ws?.messageKeyPath;
  const messageKey = keyPath ? readExpressionPath(message as Record<string, unknown>, keyPath) : undefined;
  const previous = wsRuntimeData.value[source.sourceId] ?? {};
  wsRuntimeData.value = {
    ...wsRuntimeData.value,
    [source.sourceId]: typeof messageKey === "string" || typeof messageKey === "number"
      ? {
        ...previous,
        [String(messageKey)]: {
          ...(sourceData as Record<string, unknown>),
          data: sourceData
        }
      }
      : {
        ...previous,
        ...(sourceData as Record<string, unknown>)
      }
  };
}

function closeWebSocketSources() {
  wsConnections.forEach((socket) => socket.close());
  wsHeartbeatTimers.forEach((heartbeatTimer) => window.clearInterval(heartbeatTimer));
  wsConnections = [];
  wsHeartbeatTimers = [];
}

function openWebSocketSources() {
  closeWebSocketSources();
  const base = currentTemplateTopology();
  if (!base || isDebugRuntime.value) return;
  const metaData = readExpressionMetaData();
  const context = {
    ...metaData,
    metaData
  };

  for (const source of base.dataSources ?? []) {
    if (source.type !== "websocket" || source.enabled === false) continue;
    const url = createWebSocketUrl(source, context);
    if (!url) continue;
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      const subscribeMessage = resolveExpressionValue(source.config?.ws?.subscribeMessage ?? source.config?.body, context);
      if (subscribeMessage && typeof subscribeMessage === "object" && Object.keys(subscribeMessage).length) {
        socket.send(JSON.stringify(subscribeMessage));
      }
      const heartbeatInterval = source.config?.ws?.heartbeatInterval ?? 0;
      if (heartbeatInterval > 0) {
        wsHeartbeatTimers.push(window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
        }, heartbeatInterval));
      }
    });
    socket.addEventListener("message", (event) => {
      try {
        mergeWebSocketPayload(source, JSON.parse(String(event.data)));
        applyRuntimeData({
          ...lastHttpRuntime,
          ...wsRuntimeData.value
        });
      } catch {
        // Ignore malformed runtime messages and wait for the next payload.
      }
    });
    wsConnections.push(socket);
  }
}

function resolveRuntimeNodeText(node: TopologyNode, runtime: Record<string, unknown>, runtimeContext: ExpressionContext) {
  const sourceId = node.dataBinding?.sourceId;
  const sourceData = sourceId ? runtime[sourceId] as Record<string, unknown> | undefined : undefined;

  const values = sourceData
    ? Object.fromEntries(Object.entries(node.dataBinding?.mappings ?? {}).map(([name, path]) => [name, readMappedRuntimeValue(sourceData, path)]))
    : {};
  const textTemplate = typeof node.props?.textTemplate === "string" ? node.props.textTemplate : undefined;
  return textTemplate
    ? resolveTemplateString(textTemplate, {
      ...runtimeContext,
      ...values,
      node: values
    })
    : node.runtime?.text;
}

function runtimeSignature(value: unknown) {
  return JSON.stringify(value ?? null);
}

function applyRuntimeData(runtime: Record<string, unknown>) {
  const base = currentTemplateTopology();
  if (!base) return;
  lastRuntimeSnapshot.value = runtime;
  const metaData = readExpressionMetaData();
  const runtimeContext = buildRuntimeContext(base, runtime, metaData);

  const nextNodeRuntimes = base.nodes.map((node: TopologyNode) => ({
    key: node.key,
    runtime: resolveNodeRuntime(node, runtimeContext, resolveRuntimeNodeText(node, runtime, runtimeContext))
  }));
  const nextLinkRuntimes = base.links.map((link) => ({
    key: link.key,
    runtime: resolveLinkRuntime(link, runtimeContext)
  }));

  // 模板未变且结构一致时走增量补丁，避免整棵 GoJS 模型重建与视口重置
  const current = topology.value;
  const canPatchIncrementally = current
    && lastFullyAppliedBase === base
    && current.nodes.length === base.nodes.length
    && current.links.length === base.links.length;

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
  // 原地更新 runtime：引用不变使画布 watcher 不触发，深层响应式保证检查面板实时刷新
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

async function refreshRuntime() {
  const base = currentTemplateTopology();
  if (!base) return;
  const query = collectRuntimeQuery(base);
  const metaData = readExpressionMetaData();

  lastHttpRuntime = query.sourceIds.length
    ? await queryRuntime(base.id, query.sourceIds, query.fields, {
      preview: isDebugRuntime.value,
      parentParams: metaData,
      metaData,
      sources: base.dataSources
    })
    : {};
  applyRuntimeData({
    ...lastHttpRuntime,
    ...wsRuntimeData.value
  });
}

async function safeRefreshRuntime(showWarning = false) {
  try {
    await refreshRuntime();
  } catch {
    applyRuntimeData(wsRuntimeData.value);
    if (showWarning) ElMessage.warning("运行数据加载失败，已保留拓扑画布");
  }
}

function runtimePollingInterval() {
  const intervals = (currentTemplateTopology()?.dataSources ?? [])
    .filter((source) => source.enabled !== false && (isDebugRuntime.value || source.type !== "websocket"))
    .map((source) => source.config?.interval ?? 3000)
    .filter((interval) => interval > 0);
  return intervals.length ? Math.min(...intervals) : 0;
}

async function nextPaintFrame() {
  await nextTick();
  await new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve(null));
  });
}

function handleVisibilityChange() {
  if (!document.hidden && topology.value) void safeRefreshRuntime();
}

onMounted(async () => {
  const id = typeof route.query.id === "string" && route.query.id ? route.query.id : "";
  if (!id) {
    ElMessage.warning("缺少拓扑 ID");
    return;
  }

  initialLoading.value = true;
  loadStage.value = "加载拓扑数据";
  loadProgress.value = 10;
  try {
    const loadedTopology = (isPreview.value ? readPreviewTopology(id) : null) ?? await getTopology(id);
    if (!loadedTopology) {
      ElMessage.warning("拓扑不存在，请先在编辑器保存");
      return;
    }
    templateTopology.value = cloneTopology(loadedTopology);

    loadStage.value = "加载节点类型";
    loadProgress.value = 35;
    try {
      nodeTypes.value = await listEnabledNodeTypes();
    } catch {
      nodeTypes.value = [];
      ElMessage.warning("节点类型加载失败，已使用拓扑数据继续预览");
    }

    loadStage.value = "构建画布";
    loadProgress.value = 60;
    // 先绘制进度帧，再执行同步的 GoJS 画布构建；拓扑在节点类型就绪后赋值，避免重复全量渲染
    await nextPaintFrame();
    resetCanvasReady();
    topology.value = cloneTopology(loadedTopology);
    // 固定模板引用，画布完成首次建模后运行数据即可持续走增量补丁。
    lastFullyAppliedBase = templateTopology.value;

    loadStage.value = "加载运行数据";
    loadProgress.value = 80;
    await nextPaintFrame();
    await safeRefreshRuntime(true);

    loadStage.value = "加载节点图片";
    loadProgress.value = 90;
    await waitForCanvasReady();

    loadStage.value = "渲染完成";
    loadProgress.value = 100;
    await nextPaintFrame();
  } finally {
    initialLoading.value = false;
  }

  openWebSocketSources();
  const interval = runtimePollingInterval();
  if (interval > 0) timer = window.setInterval(() => {
    if (document.hidden) return;
    void safeRefreshRuntime();
  }, interval);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
  canvasReadyResolver?.();
  canvasReadyResolver = null;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (timer) window.clearInterval(timer);
  closeWebSocketSources();
});
</script>

<template>
  <main class="app-shell" :style="isDebugRuntime && ruleOverviewOpen ? { gridTemplateRows: '48px minmax(0, 1fr) min(340px, 42vh)' } : undefined">
    <header class="topbar">
      <el-tooltip v-if="!isPreview" content="返回调试运行列表" placement="bottom" :show-after="300">
        <el-button text class="topbar-back" :icon="ArrowLeft" @click="router.push('/topology/runtime')" />
      </el-tooltip>
      <div class="topbar-heading">
        <span class="topbar-title">拓扑调试运行页</span>
        <span v-if="topology" class="topbar-sub">{{ topology.name }}</span>
      </div>
      <span class="topbar-spacer" />
      <el-segmented
        v-model="canvasPreviewTheme"
        :disabled="!topology"
        :options="[
          { label: '白底', value: 'light' },
          { label: '深底', value: 'dark' }
        ]"
        size="small"
      />
      <el-button v-if="isDebugRuntime" text :icon="Tickets" :disabled="!topology" :type="ruleOverviewOpen ? 'primary' : undefined" @click="ruleOverviewOpen = !ruleOverviewOpen">规则总览</el-button>
      <el-button v-if="isDebugRuntime" text :icon="Connection" :disabled="!topology" @click="openPreviewApiDialog">接口调试</el-button>
      <el-button text :icon="Edit" :disabled="!topology" @click="router.push(`/topology/list?id=${encodeURIComponent(topology?.id ?? '')}`)">编辑</el-button>
      <el-button type="primary" :icon="Refresh" @click="safeRefreshRuntime(true)">刷新数据</el-button>
    </header>
    <section
      class="workspace"
      :style="{ gridTemplateColumns: isDebugRuntime ? '0 minmax(0, 1fr) 360px' : '0 minmax(0, 1fr) 300px' }"
    >
      <div />
      <div class="canvas-wrap">
        <TopologyCanvas
          ref="canvasRef"
          mode="runtime"
          :topology-data="topology"
          :node-types="nodeTypes"
          :selected-key="selectedKey"
          :event-context="eventContext"
          :editor-background-theme="canvasPreviewTheme"
          @event="handleCanvasEvent"
          @selection-change="selectedKey = $event"
          @ready="handleCanvasReady"
        />
      </div>
      <aside class="runtime-right-panel">
        <section v-if="isDebugRuntime" class="preview-event-log">
          <div class="preview-event-log-header">
            <div>
              <div class="preview-event-log-title">事件日志</div>
              <div class="preview-event-log-hint">点击节点后展示已配置 NODE_EVENT 的 emit 信息。</div>
            </div>
            <button type="button" :disabled="!previewEventLogs.length" @click="clearPreviewEventLogs">清空</button>
          </div>
          <div v-if="previewEventLogs.length" class="preview-event-log-list">
            <article v-for="log in previewEventLogs" :key="log.id" class="preview-event-log-item">
              <div class="preview-event-log-item-top">
                <strong>{{ log.eventName }}</strong>
                <span>{{ log.time }}</span>
              </div>
              <div class="preview-event-log-meta">
                <span>key: {{ log.eventKey }}</span>
                <span>trigger: {{ log.trigger }}</span>
                <span>node: {{ log.nodeLabel }}（{{ log.nodeKey }}）</span>
                <span v-if="log.bindNodeKey">bind: {{ log.bindNodeKey }}</span>
              </div>
              <pre>{{ jsonText(log.data) }}</pre>
            </article>
          </div>
          <div v-else class="preview-event-log-empty">暂无事件日志。</div>
        </section>
        <section class="runtime-inspector">
          <template v-if="selectedNode">
            <div class="runtime-inspector-title">{{ selectedNode.label }}</div>
            <div class="runtime-inspector-kind">{{ selectedNode.isGroup ? "分组" : nodeTypeName(selectedNode.typeId) }}</div>
            <div class="runtime-inspector-grid">
              <span>Key</span>
              <strong>{{ selectedNode.key }}</strong>
              <span>状态</span>
              <strong>{{ runtimeStatusText(selectedNode) }}</strong>
              <span>显示</span>
              <strong>{{ selectedNode.runtime?.visible === false ? "隐藏" : "显示" }}</strong>
              <span>位置</span>
              <strong>{{ selectedNode.loc || "-" }}</strong>
            </div>
            <div v-if="selectedNode.eventConfig?.length" class="runtime-inspector-list">
              <div class="runtime-inspector-subtitle">事件</div>
              <div v-for="event in selectedNode.eventConfig" :key="event.id ?? `${event.eventName}_${event.eventKey}`" class="runtime-inspector-item">
                <strong>{{ event.eventName }}</strong>
                <span>{{ event.trigger }} / {{ event.eventKey }}</span>
              </div>
            </div>
          </template>
          <template v-else-if="selectedLink">
            <div class="runtime-inspector-title">{{ selectedLinkLabel(selectedLink) }}</div>
            <div class="runtime-inspector-kind">连线</div>
            <div class="runtime-inspector-grid">
              <span>Key</span>
              <strong>{{ selectedLink.key }}</strong>
              <span>起点</span>
              <strong>{{ selectedLink.from }}{{ selectedLink.fromPort ? ` / ${selectedLink.fromPort}` : "" }}</strong>
              <span>终点</span>
              <strong>{{ selectedLink.to }}{{ selectedLink.toPort ? ` / ${selectedLink.toPort}` : "" }}</strong>
              <span>状态</span>
              <strong>{{ selectedLink.runtime?.state ?? selectedLink.defaultState ?? "默认" }}</strong>
            </div>
          </template>
          <template v-else>
            <div class="runtime-inspector-title">{{ topology?.name ?? "拓扑" }}</div>
            <div class="runtime-inspector-kind">调试运行态</div>
            <div class="runtime-inspector-grid">
              <span>节点</span>
              <strong>{{ topology?.nodes.length ?? 0 }}</strong>
              <span>连线</span>
              <strong>{{ topology?.links.length ?? 0 }}</strong>
              <span>版本</span>
              <strong>{{ topology?.version ?? "-" }}</strong>
            </div>
            <div class="runtime-inspector-empty">点击画布中的节点或连线查看调试运行详情。</div>
          </template>
        </section>
      </aside>
    </section>
    <RuleOverviewPanel
      v-if="isDebugRuntime && ruleOverviewOpen"
      :node-groups="ruleOverview.nodes"
      :link-groups="ruleOverview.links"
      :selected-key="selectedKey"
      @select="selectedKey = $event"
      @close="ruleOverviewOpen = false"
    />
    <el-dialog v-model="previewApiDialogVisible" title="接口调试" width="980px" class="preview-api-dialog">
      <div class="preview-api-header">
        <div>
          <div class="preview-api-title">Mock 数据</div>
          <div class="preview-api-hint">修改后点击应用刷新，调试运行页会重新计算节点与连线规则。</div>
        </div>
        <div class="preview-api-actions">
          <el-button @click="resetPreviewMockDrafts">重置草稿</el-button>
          <el-button type="primary" :loading="previewApplying" @click="applyPreviewMockData">应用并刷新</el-button>
        </div>
      </div>
      <div v-if="previewDataSources.length" class="preview-source-list">
        <section v-for="(source, index) in previewDataSources" :key="index" class="preview-source-card">
          <div class="preview-source-top">
            <div>
              <div class="preview-source-name">{{ source.name || source.sourceId }}</div>
              <div class="preview-source-meta">{{ source.sourceId }} / {{ source.type ?? 'http' }}</div>
            </div>
            <div class="preview-source-meta">root: {{ source.config?.responseMapping?.rootPath || '-' }}</div>
          </div>
          <div class="preview-json-grid">
            <label>
              Mock JSON
              <JsonTextEditor
                :model-value="previewMockData[String(index)]"
                :height="220"
                @update:model-value="updatePreviewMockDraft(index, $event)"
              />
            </label>
            <label>
              当前运行态数据
              <JsonTextEditor
                :model-value="jsonObject(lastRuntimeSnapshot[source.sourceId])"
                :height="220"
                readonly
              />
            </label>
          </div>
        </section>
      </div>
      <div v-else class="preview-empty">暂无接口配置。</div>
    </el-dialog>
    <div v-if="initialLoading" class="page-loading-overlay">
      <div class="page-loading-card">
        <el-progress :percentage="loadProgress" :stroke-width="10" :show-text="false" />
        <div class="page-loading-text">{{ loadStage }}（{{ loadProgress }}%）</div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.app-shell {
  position: relative;
}

.page-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(255 255 255 / 72%);
  backdrop-filter: blur(2px);
}

.page-loading-card {
  width: min(360px, 72vw);
  padding: 20px 24px;
  background: #ffffff;
  border: 1px solid #d8dde6;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgb(15 23 42 / 10%);
}

.page-loading-text {
  margin-top: 10px;
  color: #4b5563;
  font-size: 13px;
  text-align: center;
}

.runtime-right-panel {
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  background: #f8fafc;
  border-left: 1px solid #d8dde6;
  overflow: hidden;
}

.runtime-right-panel > .right-panel {
  min-height: 0;
  border: 1px solid #d8dde6;
  border-radius: 8px;
}

.runtime-inspector {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  padding: 12px;
  overflow: auto;
  background: #ffffff;
  border: 1px solid #d8dde6;
  border-radius: 8px;
}

.runtime-inspector-title {
  min-width: 0;
  overflow: hidden;
  color: #111827;
  font-size: 16px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-inspector-kind {
  width: fit-content;
  padding: 3px 8px;
  color: #155e75;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
}

.runtime-inspector-grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 10px;
  padding: 10px;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
}

.runtime-inspector-grid strong {
  min-width: 0;
  overflow: hidden;
  color: #111827;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-inspector-list {
  display: grid;
  gap: 8px;
}

.runtime-inspector-subtitle {
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.runtime-inspector-item {
  display: grid;
  gap: 3px;
  padding: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.runtime-inspector-item strong {
  color: #111827;
  font-size: 13px;
}

.runtime-inspector-item span,
.runtime-inspector-empty {
  color: #64748b;
  font-size: 12px;
}

.runtime-inspector-empty {
  padding: 12px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  line-height: 1.5;
}

.preview-event-log {
  display: grid;
  gap: 10px;
  max-height: 360px;
  min-height: 168px;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #d8dde6;
  border-radius: 8px;
  overflow: hidden;
}

.preview-event-log-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.preview-event-log-title {
  color: #111827;
  font-weight: 700;
}

.preview-event-log-hint {
  margin-top: 4px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.4;
}

.preview-event-log-header button {
  padding: 5px 10px;
  color: #475569;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
}

.preview-event-log-header button:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}

.preview-event-log-list {
  display: grid;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.preview-event-log-item {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.preview-event-log-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.preview-event-log-item-top strong {
  min-width: 0;
  color: #0f172a;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.preview-event-log-item-top span,
.preview-event-log-meta {
  color: #64748b;
  font-size: 12px;
}

.preview-event-log-meta {
  display: grid;
  gap: 3px;
}

.preview-event-log-item pre {
  max-height: 150px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  color: #1e293b;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
}

.preview-event-log-empty {
  display: grid;
  min-height: 84px;
  place-items: center;
  color: #94a3b8;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
}

.preview-api-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.preview-api-title,
.preview-source-name {
  color: #111827;
  font-weight: 700;
}

.preview-api-hint,
.preview-source-meta {
  margin-top: 4px;
  color: #6b7280;
  font-size: 12px;
}

.preview-api-actions {
  display: flex;
  gap: 8px;
}

.preview-source-list {
  display: grid;
  gap: 12px;
  max-height: 68vh;
  overflow: auto;
  padding-right: 4px;
}

.preview-source-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #d8dde6;
  border-radius: 8px;
}

.preview-source-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.preview-json-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.preview-json-grid label {
  display: grid;
  gap: 6px;
  color: #4b5563;
  font-size: 13px;
}

.preview-json-grid textarea {
  width: 100%;
  padding: 8px;
  color: #111827;
  background: #f9fafb;
  border: 1px solid #d8dde6;
  border-radius: 6px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.preview-json-grid textarea[readonly] {
  color: #475569;
  background: #f8fafc;
}

.preview-empty {
  padding: 24px;
  color: #6b7280;
  text-align: center;
}
</style>
