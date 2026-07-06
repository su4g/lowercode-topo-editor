<script setup lang="ts">
import { createExpressionContext, evaluateExpressionConditionGroup, isConditionGroup, normalizeExpressionPath, readExpressionPath, resolveExpressionValue, resolveTemplateString, type ConditionGroup, type DataSourceReference, type DisplayRule, type ExpressionContext, type LinkRuntime, type LinkRuntimeRule, type NodeRuntime, type NodeTypeDefinition, type TopologyData, type TopologyEvent, type TopologyLink, type TopologyNode } from "@topo-editor/topology-shared";
import { ElMessage } from "element-plus";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ModuleNav from "../components/ModuleNav.vue";
import PropertyPanel from "../components/PropertyPanel/index.vue";
import TopologyCanvas from "../components/TopologyCanvas/index.vue";
import { listNodeTypes } from "../services/nodeTypeApi";
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
const previewApiDialogVisible = ref(false);
const previewMockTexts = ref<Record<string, string>>({});
const previewApplying = ref(false);
const previewDataSources = computed(() => currentTemplateTopology()?.dataSources ?? []);
const previewEventLogs = ref<PreviewEventLog[]>([]);
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
  const raw = sessionStorage.getItem(`topology-preview:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TopologyData;
  } catch {
    return null;
  }
}

function cloneTopology(data: TopologyData) {
  return JSON.parse(JSON.stringify(data)) as TopologyData;
}

function currentTemplateTopology() {
  return templateTopology.value ?? topology.value;
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function handleCanvasEvent(event: TopologyEvent) {
  if ("nodeKey" in event) selectedKey.value = event.nodeKey;
  if (event.type === "LINK_CLICK") selectedKey.value = event.linkKey;

  if (!isPreview.value || event.type !== "NODE_EVENT") return;
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

function persistPreviewTopology() {
  if (!isPreview.value || !templateTopology.value) return;
  sessionStorage.setItem(`topology-preview:${templateTopology.value.id}`, JSON.stringify(templateTopology.value));
}

function resetPreviewMockDrafts() {
  previewMockTexts.value = Object.fromEntries((currentTemplateTopology()?.dataSources ?? []).map((source, index) => [
    String(index),
    jsonText(source.config?.mockData ?? source.config?.data)
  ]));
}

function openPreviewApiDialog() {
  resetPreviewMockDrafts();
  previewApiDialogVisible.value = true;
}

function updatePreviewMockDraft(index: number, value: string) {
  previewMockTexts.value = {
    ...previewMockTexts.value,
    [String(index)]: value
  };
}

async function applyPreviewMockData() {
  const base = currentTemplateTopology();
  if (!base) return;

  const nextDataSources: DataSourceReference[] = [];
  for (const [index, source] of (base.dataSources ?? []).entries()) {
    const parsed = parseJsonObject(previewMockTexts.value[String(index)] ?? "{}", `${source.sourceId || source.name || `接口 ${index + 1}`} Mock`);
    if (!parsed) return;
    nextDataSources.push({
      ...source,
      config: {
        ...(source.config ?? {}),
        mockData: parsed
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
    await refreshRuntime();
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
    if (!isPreview.value && isWebSocketSource(data, node.dataBinding.sourceId)) continue;
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
        if (!isPreview.value && isWebSocketSource(data, target)) continue;
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
        const ruleNode = data.nodes.find((item) => item.key === target);
        if (ruleNode?.dataBinding?.sourceId) {
          if (!isPreview.value && isWebSocketSource(data, ruleNode.dataBinding.sourceId)) continue;
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
        if (!isPreview.value && isWebSocketSource(data, target)) continue;
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
        const node = data.nodes.find((item) => item.key === target);
        if (node?.dataBinding?.sourceId) {
          if (!isPreview.value && isWebSocketSource(data, node.dataBinding.sourceId)) continue;
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
        if (!isPreview.value && isWebSocketSource(data, target)) continue;
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

function defaultRuntimeSource(data: TopologyData) {
  const sources = (data.dataSources ?? []).filter((source) => source.enabled !== false);
  return sources.length === 1 ? sources[0] : null;
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
  const isKnownRuntimeTarget = data.nodes.some((node) => node.key === target)
    || data.dataSources?.some((source) => source.sourceId === target);
  return isKnownRuntimeTarget || !(target in metaData);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function configuredNodeIdentifier(node: TopologyNode) {
  const identifier = node.props?.identifier;
  return typeof identifier === "string" ? identifier.trim() : "";
}

function nodeDataKeys(node: TopologyNode) {
  return [configuredNodeIdentifier(node), node.key, node.label, node.typeId]
    .filter(Boolean)
    .flatMap((value) => {
      const text = String(value);
      return [text, text.toLowerCase(), normalizeKey(text)];
    })
    .filter(Boolean);
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
    if (value !== undefined) context[`${node.key}.${fieldName}`] = value;
  }
  for (const key of candidates) {
    const directRecord = readExpressionPath(sourceData, key);
    const dataRecord = readExpressionPath(sourceData, `data.${key}`);
    const record = isRecord(dataRecord) ? dataRecord : isRecord(directRecord) ? directRecord : null;
    if (!record) continue;
    for (const [field, value] of Object.entries(record)) {
      context[`${node.key}.${field}`] = value;
      context[`${node.key}.${key}.${field}`] = value;
      context[`${node.key}.data.${key}.${field}`] = value;
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

function applyLinkRule(runtime: LinkRuntime, rule: LinkRuntimeRule): LinkRuntime {
  const style = rule.action.style;
  return {
    ...runtime,
    state: rule.action.state ?? runtime.state,
    ...style,
    flow: style?.flow ? { ...(runtime.flow ?? {}), ...style.flow } : runtime.flow,
    glow: style?.glow ? { ...(runtime.glow ?? {}), ...style.glow } : runtime.glow
  };
}

function applyNodeRule(runtime: NodeRuntime, rule: DisplayRule): NodeRuntime {
  return {
    ...runtime,
    visible: rule.action.visible ?? runtime.visible,
    status: rule.action.status ?? runtime.status,
    color: rule.action.color ?? runtime.color,
    text: rule.action.text ?? runtime.text,
    backgroundColor: rule.action.backgroundColor ?? runtime.backgroundColor,
    borderColor: rule.action.borderColor ?? runtime.borderColor,
    opacity: rule.action.opacity ?? runtime.opacity
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
  return [...(link.rules ?? [])]
    .sort((left, right) => left.priority - right.priority)
    .reduce((nextRuntime, rule) => {
      return evaluateExpressionConditionGroup(rule.condition, context)
        ? applyLinkRule(nextRuntime, rule)
        : nextRuntime;
    }, buildDefaultLinkRuntime(link));
}

function resolveNodeRuntime(node: TopologyNode, context: ExpressionContext, text?: string): NodeRuntime {
  const baseRuntime = buildRuleCleanNodeRuntime(node, text);

  return [...(node.displayRules ?? [])]
    .sort((left, right) => left.priority - right.priority)
    .reduce((nextRuntime, rule) => {
      return evaluateExpressionConditionGroup(rule.condition, context)
        ? applyNodeRule(nextRuntime, rule)
        : nextRuntime;
    }, baseRuntime);
}

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
  if (!base || isPreview.value) return;
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

function applyRuntimeData(runtime: Record<string, unknown>) {
  const base = currentTemplateTopology();
  if (!base) return;
  lastRuntimeSnapshot.value = runtime;
  const metaData = readExpressionMetaData();
  const runtimeContext = buildRuntimeContext(base, runtime, metaData);

  topology.value = {
    ...base,
    nodes: base.nodes.map((node: TopologyNode) => {
      const sourceId = node.dataBinding?.sourceId;
      const sourceData = sourceId ? runtime[sourceId] as Record<string, unknown> | undefined : undefined;

      const values = sourceData
        ? Object.fromEntries(Object.entries(node.dataBinding?.mappings ?? {}).map(([name, path]) => [name, readMappedRuntimeValue(sourceData, path)]))
        : {};
      const textTemplate = typeof node.props?.textTemplate === "string" ? node.props.textTemplate : undefined;
      const text = textTemplate
        ? resolveTemplateString(textTemplate, {
          ...runtimeContext,
          ...values,
          node: values
        })
        : node.runtime?.text;

      return {
        ...node,
        runtime: resolveNodeRuntime(node, runtimeContext, text)
      };
    }),
    links: base.links.map((link) => ({
      ...link,
      runtime: resolveLinkRuntime(link, runtimeContext)
    }))
  };
}

async function refreshRuntime() {
  const base = currentTemplateTopology();
  if (!base) return;
  const query = collectRuntimeQuery(base);
  const metaData = readExpressionMetaData();

  lastHttpRuntime = query.sourceIds.length
    ? await queryRuntime(base.id, query.sourceIds, query.fields, {
      preview: isPreview.value,
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

function runtimePollingInterval() {
  const intervals = (currentTemplateTopology()?.dataSources ?? [])
    .filter((source) => source.enabled !== false && (isPreview.value || source.type !== "websocket"))
    .map((source) => source.config?.interval ?? 3000)
    .filter((interval) => interval > 0);
  return intervals.length ? Math.min(...intervals) : 0;
}

onMounted(async () => {
  nodeTypes.value = await listNodeTypes();
  const id = String(route.params.id ?? "");
  if (!id) {
    ElMessage.warning("缺少拓扑 ID");
    return;
  }

  const loadedTopology = isPreview.value ? readPreviewTopology(id) : await getTopology(id);
  if (!loadedTopology) {
    ElMessage.warning(isPreview.value ? "预览数据不存在，请从编辑器重新进入预览" : "拓扑不存在，请先在编辑器保存");
    return;
  }
  templateTopology.value = cloneTopology(loadedTopology);
  topology.value = cloneTopology(loadedTopology);

  await refreshRuntime();
  openWebSocketSources();
  const interval = runtimePollingInterval();
  if (interval > 0) timer = window.setInterval(refreshRuntime, interval);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
  closeWebSocketSources();
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <span class="topbar-title">{{ isPreview ? "拓扑预览" : "拓扑运行态" }}</span>
      <ModuleNav />
      <span class="topbar-spacer" />
      <el-button v-if="!isPreview" @click="router.push('/runtime-list')">返回展示列表</el-button>
      <el-button v-if="isPreview" :disabled="!topology" @click="openPreviewApiDialog">接口预览测试</el-button>
      <el-button :disabled="!topology" @click="router.push(`/topologies/${topology?.id}/editor`)">编辑</el-button>
      <el-button @click="refreshRuntime">刷新数据</el-button>
    </header>
    <section
      class="workspace"
      :style="{ gridTemplateColumns: isPreview ? '0 minmax(0, 1fr) 360px' : '0 minmax(0, 1fr) 300px' }"
    >
      <div />
      <div class="canvas-wrap">
        <TopologyCanvas
          mode="runtime"
          :topology-data="topology"
          :node-types="nodeTypes"
          :selected-key="selectedKey"
          :event-context="eventContext"
          @event="handleCanvasEvent"
          @selection-change="selectedKey = $event"
        />
      </div>
      <aside class="runtime-right-panel">
        <section v-if="isPreview" class="preview-event-log">
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
        <PropertyPanel
          class="right-panel"
          :topology="topology"
          :node-types="nodeTypes"
          :selected-node="selectedNode"
          :selected-link="selectedLink"
          @select-item="selectedKey = $event"
        />
      </aside>
    </section>
    <el-dialog v-model="previewApiDialogVisible" title="接口预览测试" width="980px" class="preview-api-dialog">
      <div class="preview-api-header">
        <div>
          <div class="preview-api-title">Mock 数据</div>
          <div class="preview-api-hint">修改后点击应用刷新，预览态会重新计算节点与连线规则。</div>
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
              <textarea
                :value="previewMockTexts[String(index)] ?? '{}'"
                rows="10"
                spellcheck="false"
                @input="updatePreviewMockDraft(index, ($event.target as HTMLTextAreaElement).value)"
              />
            </label>
            <label>
              当前运行态数据
              <textarea
                :value="jsonText(lastRuntimeSnapshot[source.sourceId])"
                rows="10"
                readonly
                spellcheck="false"
              />
            </label>
          </div>
        </section>
      </div>
      <div v-else class="preview-empty">暂无接口配置。</div>
    </el-dialog>
  </main>
</template>

<style scoped>
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
