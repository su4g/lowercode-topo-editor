<script setup lang="ts">
import { buildTopologyExpressionContext, createSourceRefId, DEFAULT_TOPOLOGY_CANVAS, migrateTopologyRulesV2, resolveLinkRuntimeWithTrace, resolveNodeRuntimeWithTrace, resolveTopologyTextColor, type ContainerStyle, type DataSourceReference, type DataSourceType, type LinkStyle, type NodeRuntime, type NodeTypeDefinition, type RuleOverviewGroup, type TopologyData, type TopologyLink, type TopologyNode } from "@topo-editor/topology-shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Connection, Delete, Download, FullScreen, List, QuestionFilled, RefreshLeft, RefreshRight, Tickets, VideoPlay } from "@element-plus/icons-vue";
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import JsonTextEditor from "../components/JsonTextEditor.vue";
import ObjectNavigator from "../components/ObjectNavigator/index.vue";
import PalettePanel from "../components/PalettePanel/index.vue";
import PropertyPanel from "../components/PropertyPanel/index.vue";
import RuleOverviewPanel from "../components/RuleOverviewPanel/index.vue";
import TopologyCanvas from "../components/TopologyCanvas/index.vue";
import { listEnabledNodeTypes } from "../services/nodeTypeApi";
import { normalizeTopologyCanvas } from "../services/adapters";
import { getTopology, saveTopology } from "../services/topologyApi";

const route = useRoute();
const router = useRouter();
const nodeTypes = ref<NodeTypeDefinition[]>([]);
const topology = ref<TopologyData | null>(null);
const saving = ref(false);
const selectedKey = ref("");
const apiDialogVisible = ref(false);
const objectNavigatorVisible = ref(false);
const ruleOverviewOpen = ref(false);
const initialLoading = ref(false);
const loadProgress = ref(0);
const loadStage = ref("");
const canvasPreviewTheme = ref<"light" | "dark">("light");
const operationHelpGroups = [
  {
    title: "画布操作",
    items: [
      { action: "创建节点", description: "从左侧节点库拖拽到画布；拖入容器可直接加入分组" },
      { action: "选择与多选", description: "单击选择，按住 Ctrl / ⌘ 单击可追加或取消选择" },
      { action: "移动与视图", description: "拖拽所选对象移动；拖拽画布空白区域平移，滚轮缩放" },
      { action: "连线与调整", description: "选中节点后拖拽四周端口连线；拖动节点控制点可缩放、旋转" }
    ]
  },
  {
    title: "顶部操作",
    items: [
      { action: "撤销 / 重做", description: "回退或恢复最近一次画布编辑" },
      { action: "适配画布", description: "自动缩放并居中显示完整画布" },
      { action: "对象树", description: "按层级浏览节点、容器与连线，并快速定位对象" },
      { action: "接口配置", description: "维护运行态数据源、请求参数和 Mock 数据" },
      { action: "导出 / 预览 / 保存", description: "导出 SVG、检查运行效果或保存当前拓扑" }
    ]
  }
] as const;

const shortcutGroups = [
  {
    title: "常用编辑",
    items: [
      { keys: ["Ctrl / ⌘", "Z"], description: "撤销" },
      { keys: ["Ctrl / ⌘", "Y"], description: "重做" },
      { keys: ["Ctrl / ⌘", "C"], description: "复制所选" },
      { keys: ["Ctrl / ⌘", "V"], description: "粘贴" },
      { keys: ["Ctrl / ⌘", "X"], description: "剪切所选" },
      { keys: ["Delete / Backspace"], description: "删除所选" },
      { keys: ["Ctrl / ⌘", "A"], description: "全选画布对象" }
    ]
  },
  {
    title: "精细操作",
    items: [
      { keys: ["方向键"], description: "所选对象移动 1 px" },
      { keys: ["Shift", "方向键"], description: "所选对象移动 10 px" },
      { keys: ["Option / Alt", "单击"], description: "循环选择当前位置重叠的节点、容器或连线" },
      { keys: ["Option / Alt", "双击 / 右键"], description: "打开当前位置的重叠对象列表并指定选择" }
    ]
  }
] as const;
const canvasRef = ref<{
  exportTopology: () => TopologyData | null;
  updateNodeDataFromProps: (nodeKey: string, patch: Partial<TopologyNode>) => void;
  updateLinkDataFromProps: (linkKey: string, patch: Partial<TopologyLink>) => void;
  previewLinkStyle: (linkKey: string, style: LinkStyle) => void;
  clearLinkStylePreview: (linkKey?: string) => void;
  previewContainerStyle: (nodeKey: string, style: ContainerStyle) => void;
  clearContainerStylePreview: (nodeKey?: string) => void;
  undo: () => void;
  redo: () => void;
  deleteSelection: () => void;
  fitView: () => void;
  exportSvg: () => void;
} | null>(null);
const selectedNode = computed(() => topology.value?.nodes.find((node) => node.key === selectedKey.value) ?? null);
const selectedLink = computed(() => topology.value?.links.find((link) => link.key === selectedKey.value) ?? null);

function createEmptyTopology(id: string): TopologyData {
  return {
    schemaVersion: 2,
    id,
    name: "新建拓扑",
    version: "1.0.0",
    canvas: { ...DEFAULT_TOPOLOGY_CANVAS },
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

function formSchemaDefaultProps(nodeType: NodeTypeDefinition) {
  return Object.fromEntries((nodeType.formSchema ?? []).map((field) => [field.field, field.defaultValue ?? ""]));
}

function nodeTypeDefaultProps(nodeType: NodeTypeDefinition) {
  const props: Record<string, unknown> = formSchemaDefaultProps(nodeType);

  if (nodeType.category === "annotation") {
    props.textColor = resolveTopologyTextColor(nodeType.annotationDefaults?.textColor, props.textColor);
    props.textSize = nodeType.annotationDefaults?.textSize ?? props.textSize ?? 14;
    props.fontWeight = nodeType.annotationDefaults?.fontWeight ?? props.fontWeight ?? "400";
    props.fontStyle = nodeType.annotationDefaults?.fontStyle ?? props.fontStyle ?? "normal";
    props.textDecoration = nodeType.annotationDefaults?.textDecoration ?? props.textDecoration ?? "none";
    props.textAlign = nodeType.annotationDefaults?.textAlign ?? props.textAlign ?? "left";
    props.lineHeight = nodeType.annotationDefaults?.lineHeight ?? props.lineHeight ?? Math.round(Number(props.textSize) * 1.4);
  }

  if (nodeType.category === "control" || nodeType.template === "buttonTemplate") {
    props.buttonText = nodeType.buttonDefaults?.buttonText ?? props.buttonText ?? "按钮";
    props.buttonRenderMode = nodeType.buttonDefaults?.buttonRenderMode ?? props.buttonRenderMode ?? "text";
    props.icon = nodeType.buttonDefaults?.icon ?? nodeType.icon ?? props.icon ?? "";
    props.buttonDefaultVisible = nodeType.buttonDefaults?.buttonDefaultVisible ?? props.buttonDefaultVisible ?? true;
    if (props.buttonRenderMode !== "image") {
      props.buttonStyleBackgroundColor = nodeType.buttonStyleDefaults?.backgroundColor ?? "#eff6ff";
      props.buttonStyleBorderColor = nodeType.buttonStyleDefaults?.borderColor ?? "#2563eb";
      props.buttonStyleTextColor = nodeType.buttonStyleDefaults?.textColor ?? "#1d4ed8";
      props.buttonStyleTextSize = nodeType.buttonStyleDefaults?.textSize ?? 13;
      props.buttonStyleBorderWidth = nodeType.buttonStyleDefaults?.borderWidth ?? 1.5;
      props.buttonStyleBorderRadius = nodeType.buttonStyleDefaults?.borderRadius ?? 6;
      props.buttonStylePaddingX = nodeType.buttonStyleDefaults?.paddingX ?? 10;
      props.buttonStylePaddingY = nodeType.buttonStyleDefaults?.paddingY ?? 5;
    }
  }

  if (nodeType.isGroup || nodeType.category === "container") {
    props.showLabel = false;
    props.backgroundOpacity = nodeType.groupStyleDefaults?.backgroundOpacity ?? props.backgroundOpacity ?? 100;
    props.transparentBackground = nodeType.groupStyleDefaults?.transparentBackground ?? props.transparentBackground ?? false;
    props.dashedBorder = nodeType.groupStyleDefaults?.dashedBorder ?? props.dashedBorder ?? false;
  }

  return props;
}

function defaultNodeRuntime(nodeType: NodeTypeDefinition) {
  if (!nodeType.isGroup && nodeType.category !== "container") return {};
  return {
    backgroundColor: nodeType.groupStyleDefaults?.backgroundColor ?? "#eef6ff",
    borderColor: nodeType.groupStyleDefaults?.borderColor ?? "#3b82f6"
  };
}

function normalizeNodeSizes(data: TopologyData) {
  return {
    ...data,
    canvas: normalizeTopologyCanvas(data.canvas),
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
    refId: createSourceRefId(`source_${index}`, index),
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

function updateDataSourceId(index: number, event: Event) {
  const input = event.target as HTMLInputElement;
  const sourceId = input.value.trim();
  const previous = topology.value?.dataSources?.[index]?.sourceId ?? "";
  if (!sourceId || topology.value?.dataSources?.some((source, sourceIndex) => sourceIndex !== index && source.sourceId === sourceId)) {
    input.value = previous;
    ElMessage.error(!sourceId ? "接口编码不能为空" : `接口编码「${sourceId}」已被使用`);
    return;
  }
  updateDataSource(index, { sourceId });
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

function updateDataSourceJson(index: number, field: "query" | "headers" | "body" | "mockData", value: Record<string, unknown>) {
  updateDataSourceConfig(index, { [field]: value } as NonNullable<DataSourceReference["config"]>);
}

function updateDataSourceWsJson(index: number, field: "subscribeMessage", value: Record<string, unknown>) {
  updateDataSourceWsConfig(index, { [field]: value });
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
  const props = nodeTypeDefaultProps(nodeType);
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
        labelPosition: "bottom",
        loc: loc ?? `${160 + index * 36} ${120 + index * 24}`,
        size: `${size.width} ${size.height}`,
        zOrder,
        group: targetGroup,
        props,
        runtime: defaultNodeRuntime(nodeType)
      }
    ]
  };
  selectedKey.value = key;
}

function updateTopology(next: TopologyData) {
  topology.value = {
    ...next,
    canvas: normalizeTopologyCanvas(next.canvas)
  };
  if (
    selectedKey.value
    && !next.nodes.some((node) => node.key === selectedKey.value)
    && !next.links.some((link) => link.key === selectedKey.value)
  ) {
    selectedKey.value = "";
  }
}

function updateTopologyMeta(patch: Partial<TopologyData>) {
  if (!topology.value) return;
  topology.value = {
    ...topology.value,
    ...patch,
    canvas: patch.canvas ? normalizeTopologyCanvas(patch.canvas) : topology.value.canvas
  };
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
        defaultStyle: patch.defaultStyle
          ? {
              ...link.defaultStyle,
              ...patch.defaultStyle,
              flow: patch.defaultStyle.flow
                ? { ...(link.defaultStyle?.flow ?? {}), ...patch.defaultStyle.flow }
                : link.defaultStyle?.flow,
              glow: patch.defaultStyle.glow
                ? { ...(link.defaultStyle?.glow ?? {}), ...patch.defaultStyle.glow }
                : link.defaultStyle?.glow
            }
          : link.defaultStyle,
        runtime: patch.runtime ? { ...link.runtime, ...patch.runtime } : link.runtime
      };
    })
  };
}

function previewLinkStyle(linkKey: string, style: LinkStyle) {
  canvasRef.value?.previewLinkStyle(linkKey, style);
}

function clearLinkStylePreview(linkKey?: string) {
  canvasRef.value?.clearLinkStylePreview(linkKey);
}

function previewContainerStyle(nodeKey: string, style: ContainerStyle) {
  canvasRef.value?.previewContainerStyle(nodeKey, style);
}

function clearContainerStylePreview(nodeKey?: string) {
  canvasRef.value?.clearContainerStylePreview(nodeKey);
}

function ruleCounts(evaluations: RuleOverviewGroup["evaluations"]) {
  return {
    active: evaluations.filter((item) => item.status === "active").length,
    overridden: evaluations.filter((item) => item.status === "overridden").length,
    inactive: evaluations.filter((item) => item.status === "inactive").length,
    invalid: evaluations.filter((item) => item.status === "invalid").length,
    total: evaluations.length
  };
}

const editorRuleOverview = computed<{ nodes: RuleOverviewGroup[]; links: RuleOverviewGroup[] }>(() => {
  const data = topology.value;
  if (!data) return { nodes: [], links: [] };
  const tested = (data.dataSources ?? []).some((source) => source.config?.mockData !== undefined || source.config?.data !== undefined);
  const runtime = Object.fromEntries((data.dataSources ?? []).map((source) => [source.sourceId, source.config?.mockData ?? source.config?.data ?? {}]));
  const context = buildTopologyExpressionContext(data, runtime);
  const nodes = data.nodes.map((node) => {
    const { runtime: result, evaluations } = resolveNodeRuntimeWithTrace(node.displayRules ?? [], context, node.runtime ?? {}, data);
    return { kind: "node" as const, key: node.key, label: node.label || node.key, typeName: node.isGroup ? "分组" : nodeTypes.value.find((item) => item.id === node.typeId)?.name ?? node.typeId, statusText: tested ? (result as NodeRuntime & { state?: string }).status ?? (result as NodeRuntime & { state?: string }).state ?? "默认" : "未调试", visible: result.visible !== false, tested, evaluations, counts: ruleCounts(evaluations) };
  });
  const links = data.links.map((link) => {
    const { runtime: result, evaluations } = resolveLinkRuntimeWithTrace(link.rules ?? [], context, link.runtime ?? { state: link.defaultState ?? "off" }, data);
    const from = data.nodes.find((node) => node.key === link.from)?.label ?? link.from;
    const to = data.nodes.find((node) => node.key === link.to)?.label ?? link.to;
    return { kind: "link" as const, key: link.key, label: link.label || `${from} → ${to}`, typeName: "连线", statusText: tested ? result.state ?? "默认" : "未调试", visible: result.visible !== false, tested, evaluations, counts: ruleCounts(evaluations) };
  });
  return { nodes, links };
});

const invalidRuleCount = computed(() => [...editorRuleOverview.value.nodes, ...editorRuleOverview.value.links].reduce((count, group) => count + group.counts.invalid, 0));

async function deleteRuleFromOverview(kind: "node" | "link", ownerKey: string, ruleId: string) {
  const group = [...editorRuleOverview.value.nodes, ...editorRuleOverview.value.links].find((item) => item.key === ownerKey);
  const evaluation = group?.evaluations.find((item) => item.ruleId === ruleId);
  try { await ElMessageBox.confirm(`确认删除规则“${evaluation?.description || evaluation?.name || ruleId}”吗？`, "删除规则", { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }); } catch { return; }
  if (kind === "node") {
    const owner = topology.value?.nodes.find((node) => node.key === ownerKey);
    if (owner) updateNode(ownerKey, { displayRules: (owner.displayRules ?? []).filter((rule) => rule.id !== ruleId) });
  } else {
    const owner = topology.value?.links.find((link) => link.key === ownerKey);
    if (owner) updateLink(ownerKey, { rules: (owner.rules ?? []).filter((rule) => rule.id !== ruleId) });
  }
}

async function save() {
  if (!topology.value) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await nextTick();
  const latestTopology = migrateTopologyRulesV2(canvasRef.value?.exportTopology() ?? topology.value);
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
  const latestTopology = migrateTopologyRulesV2(canvasRef.value?.exportTopology() ?? topology.value);
  topology.value = latestTopology;
  const previewPayload = JSON.stringify(latestTopology);
  sessionStorage.setItem(`topology-preview:${latestTopology.id}`, previewPayload);
  sessionStorage.setItem("topology-preview:last", previewPayload);
  router.push(`/runtime/${encodeURIComponent(latestTopology.id)}?preview=1`);
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

function exportSvg() {
  canvasRef.value?.exportSvg();
}

async function nextPaintFrame() {
  await nextTick();
  await new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve(null));
  });
}

onMounted(async () => {
  initialLoading.value = true;
  loadStage.value = "加载节点类型与拓扑数据";
  loadProgress.value = 10;
  try {
    const id = typeof route.params.id === "string" && route.params.id ? route.params.id : "topology_001";
    const [types, data] = await Promise.all([listEnabledNodeTypes(), getTopology(id)]);
    nodeTypes.value = types;

    loadStage.value = "构建画布";
    loadProgress.value = 60;
    // 先绘制进度帧，再执行同步的 GoJS 画布构建
    await nextPaintFrame();
    topology.value = normalizeNodeSizes(data ?? createEmptyTopology(id));

    loadStage.value = "渲染完成";
    loadProgress.value = 100;
    await nextPaintFrame();
  } finally {
    initialLoading.value = false;
  }
});
</script>

<template>
  <main class="app-shell" :style="ruleOverviewOpen ? { gridTemplateRows: '48px minmax(0, 1fr) min(340px, 42vh)' } : undefined">
    <header class="topbar">
      <el-tooltip content="返回列表" placement="bottom" :show-after="300">
        <el-button text class="topbar-back" :icon="ArrowLeft" @click="router.push('/topologies')" />
      </el-tooltip>
      <div class="topbar-heading">
        <span class="topbar-title">拓扑编辑器</span>
        <span v-if="topology" class="topbar-sub">{{ topology.name }} · v{{ topology.version }}</span>
      </div>
      <el-popover
        placement="bottom-start"
        :width="720"
        trigger="click"
        popper-class="topology-help-popover"
      >
        <template #reference>
          <el-button text class="topbar-help" :icon="QuestionFilled">操作说明</el-button>
        </template>
        <div class="operation-help">
          <div class="operation-help-header">
            <div>
              <div class="operation-help-title">操作说明与快捷键</div>
              <div class="operation-help-subtitle">快捷键需先点击画布使其获得焦点；在输入框中编辑时不会触发画布快捷键。</div>
            </div>
            <el-tag size="small" type="info" effect="plain">编辑模式</el-tag>
          </div>

          <div class="operation-help-content">
            <section class="operation-help-column">
              <div v-for="group in operationHelpGroups" :key="group.title" class="operation-help-section">
                <h4>{{ group.title }}</h4>
                <dl class="operation-help-list">
                  <div v-for="item in group.items" :key="item.action" class="operation-help-row is-operation">
                    <dt>{{ item.action }}</dt>
                    <dd>{{ item.description }}</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section class="operation-help-column">
              <div v-for="group in shortcutGroups" :key="group.title" class="operation-help-section">
                <h4>{{ group.title }}</h4>
                <dl class="operation-help-list">
                  <div v-for="item in group.items" :key="`${group.title}-${item.description}`" class="operation-help-row is-shortcut">
                    <dt class="shortcut-keys">
                      <template v-for="(key, index) in item.keys" :key="key">
                        <span v-if="index" class="shortcut-plus">+</span>
                        <kbd>{{ key }}</kbd>
                      </template>
                    </dt>
                    <dd>{{ item.description }}</dd>
                  </div>
                </dl>
              </div>
            </section>
          </div>

          <div class="operation-help-tip">
            <el-icon><QuestionFilled /></el-icon>
            <span>对象重叠时可使用 Option / Alt 辅助选择，也可打开顶部“对象树”按层级定位。</span>
          </div>
        </div>
      </el-popover>
      <span class="topbar-spacer" />

      <div class="topbar-group">
        <el-tooltip content="撤销" placement="bottom" :show-after="300">
          <el-button text :disabled="!topology" :icon="RefreshLeft" @click="undo" />
        </el-tooltip>
        <el-tooltip content="重做" placement="bottom" :show-after="300">
          <el-button text :disabled="!topology" :icon="RefreshRight" @click="redo" />
        </el-tooltip>
        <el-tooltip content="适配画布" placement="bottom" :show-after="300">
          <el-button text :disabled="!topology" :icon="FullScreen" @click="fitView" />
        </el-tooltip>
        <el-tooltip content="删除所选" placement="bottom" :show-after="300">
          <el-button text type="danger" :disabled="!topology" :icon="Delete" @click="deleteSelection" />
        </el-tooltip>
      </div>

      <span class="topbar-divider" />

      <el-segmented
        v-model="canvasPreviewTheme"
        :disabled="!topology"
        :options="[
          { label: '白底', value: 'light' },
          { label: '深底', value: 'dark' }
        ]"
        size="small"
      />

      <span class="topbar-divider" />

      <div class="topbar-group">
        <el-button text :icon="List" :type="objectNavigatorVisible ? 'primary' : ''" :disabled="!topology" @click="objectNavigatorVisible = !objectNavigatorVisible">对象树</el-button>
        <el-button text :icon="Connection" :disabled="!topology" @click="apiDialogVisible = true">接口配置</el-button>
        <el-button text :icon="Tickets" :type="ruleOverviewOpen ? 'primary' : ''" :disabled="!topology" @click="ruleOverviewOpen = !ruleOverviewOpen">规则总览<span v-if="invalidRuleCount" class="invalid-rule-count">{{ invalidRuleCount }}</span></el-button>
        <el-tooltip content="导出 SVG" placement="bottom" :show-after="300">
          <el-button text :disabled="!topology" :icon="Download" @click="exportSvg" />
        </el-tooltip>
      </div>

      <span class="topbar-divider" />

      <el-button :icon="VideoPlay" :disabled="!topology" @click="previewRuntime">预览运行态</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
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
          :editor-background-theme="canvasPreviewTheme"
          @change="updateTopology"
          @drop-node="addNode"
          @selection-change="selectedKey = $event"
        />
        <ObjectNavigator
          v-if="objectNavigatorVisible"
          :topology="topology"
          :node-types="nodeTypes"
          :selected-key="selectedKey"
          @close="objectNavigatorVisible = false"
          @select-item="selectedKey = $event"
        />
      </div>
      <PropertyPanel
        class="right-panel"
        :topology="topology"
        :node-types="nodeTypes"
        :selected-node="selectedNode"
        :selected-link="selectedLink"
        @update-topology="updateTopologyMeta"
        @update-node="updateNode"
        @update-link="updateLink"
        @select-item="selectedKey = $event"
        @preview-link-style="previewLinkStyle"
        @clear-link-style-preview="clearLinkStylePreview"
        @preview-container-style="previewContainerStyle"
        @clear-container-style-preview="clearContainerStylePreview"
      />
    </section>
    <RuleOverviewPanel
      v-if="ruleOverviewOpen"
      :node-groups="editorRuleOverview.nodes"
      :link-groups="editorRuleOverview.links"
      :selected-key="selectedKey"
      editor-mode
      @select="selectedKey = $event"
      @focus-rule="selectedKey = $event"
      @delete-rule="deleteRuleFromOverview"
      @close="ruleOverviewOpen = false"
    />
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
                @change="updateDataSourceId(index, $event)"
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
              <JsonTextEditor
                :model-value="source.config?.query"
                :height="150"
                placeholder='{"id":"${params.instanceId}"}'
                @update:model-value="updateDataSourceJson(index, 'query', $event)"
              />
            </label>
            <label>
              Headers JSON
              <JsonTextEditor
                :model-value="source.config?.headers"
                :height="150"
                placeholder='{"Authorization":"Bearer ${token}"}'
                @update:model-value="updateDataSourceJson(index, 'headers', $event)"
              />
            </label>
            <label>
              Body JSON
              <JsonTextEditor
                :model-value="source.config?.body"
                :height="150"
                placeholder='{"id":"${params.instanceId}"}'
                @update:model-value="updateDataSourceJson(index, 'body', $event)"
              />
            </label>
            <label v-if="source.type === 'websocket'">
              WS 订阅消息 JSON
              <JsonTextEditor
                :model-value="source.config?.ws?.subscribeMessage"
                :height="150"
                placeholder='{"type":"subscribe","id":"${params.instanceId}"}'
                @update:model-value="updateDataSourceWsJson(index, 'subscribeMessage', $event)"
              />
            </label>
            <label>
              Mock JSON
              <JsonTextEditor
                :model-value="source.config?.mockData ?? source.config?.data"
                :height="150"
                placeholder='{"data":{"qf1":{"status":"closed"},"deviceB":{"outputVoltage":220}}}'
                @update:model-value="updateDataSourceJson(index, 'mockData', $event)"
              />
            </label>
          </div>
        </section>
      </div>
      <div v-else class="module-empty">暂无接口配置。</div>
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

.topbar-help {
  flex: none;
  margin-left: 2px;
  color: var(--el-text-color-regular, #606266);
}

.operation-help {
  display: flex;
  flex-direction: column;
  max-height: min(680px, 78vh);
  color: var(--el-text-color-primary, #303133);
}

.operation-help-header {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
}

.operation-help-title {
  font-size: 16px;
  font-weight: 700;
}

.operation-help-subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 1.5;
}

.operation-help-content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 22px;
  min-height: 0;
  padding: 12px 2px 4px;
  overflow: auto;
}

.operation-help-column {
  min-width: 0;
}

.operation-help-section + .operation-help-section {
  margin-top: 16px;
}

.operation-help-section h4 {
  margin: 0 0 7px;
  color: var(--el-text-color-primary, #303133);
  font-size: 13px;
  font-weight: 700;
}

.operation-help-list {
  display: grid;
  gap: 2px;
  margin: 0;
}

.operation-help-row {
  display: grid;
  align-items: start;
  gap: 10px;
  min-height: 30px;
  padding: 5px 6px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.55;
}

.operation-help-row:nth-child(odd) {
  background: var(--el-fill-color-lighter, #fafafa);
}

.operation-help-row.is-operation {
  grid-template-columns: 74px minmax(0, 1fr);
}

.operation-help-row.is-shortcut {
  grid-template-columns: 166px minmax(0, 1fr);
  align-items: center;
}

.operation-help-row dt {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-weight: 600;
}

.operation-help-row dd {
  min-width: 0;
  margin: 0;
  color: var(--el-text-color-secondary, #909399);
}

.shortcut-keys {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.shortcut-keys kbd {
  display: inline-flex;
  align-items: center;
  min-height: 21px;
  padding: 1px 6px;
  color: var(--el-text-color-regular, #606266);
  background: #ffffff;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.shortcut-plus {
  color: var(--el-text-color-placeholder, #a8abb2);
  font-size: 10px;
}

.operation-help-tip {
  display: flex;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 9px 10px;
  margin-top: 8px;
  color: var(--el-color-primary-dark-2, #337ecc);
  background: var(--el-color-primary-light-9, #ecf5ff);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.45;
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

.invalid-rule-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: 5px;
  color: #fff;
  background: #dc2626;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

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
