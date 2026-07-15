<script setup lang="ts">
// @ts-nocheck
import "../../../core/go.js";
import { DEFAULT_TOPOLOGY_CANVAS, DEFAULT_TOPOLOGY_TEXT_COLOR, defaultNodePorts, nodeMatchesRuleIdentity, nodeRuleIdentity, nodeRuleIdentityCandidates, normalizeExpressionPath, normalizePortDefinition, portAlignmentFraction, readExpressionPath, resolveExpressionValue, resolveTopologyTextColor, VISUAL_PORT_ID_PREFIX, type ContainerStyle, type LinkStyle, type NodeEventConfig, type NodeLabelPosition, type NodeLabelStyle, type NodeTypeDefinition, type PortDefinition, type PortSide, type TopologyCanvasConfig, type TopologyData, type TopologyEvent, type TopologyLink, type TopologyNode } from "@topo-editor/topology-shared";
import { isImageAsset, isOssAssetRef, resolveAssetUrl } from "../../services/assetApi";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

const props = withDefaults(defineProps<{
  mode: "edit" | "runtime";
  topologyData: TopologyData | null;
  nodeTypes: NodeTypeDefinition[];
  selectedKey?: string;
  eventContext?: Record<string, unknown>;
  editorBackgroundTheme?: "light" | "dark" | "transparent";
  showCanvasBoundary?: boolean;
  enableWheelZoom?: boolean;
  autoFit?: boolean;
  fitPadding?: number;
  fitMaxScale?: number;
}>(), {
  showCanvasBoundary: undefined,
  enableWheelZoom: undefined,
  autoFit: undefined,
  fitPadding: undefined,
  fitMaxScale: undefined
});

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const emit = defineEmits<{
  change: [topology: TopologyData];
  event: [event: TopologyEvent];
  dropNode: [payload: { nodeType: NodeTypeDefinition; loc: string; groupKey?: string }];
  selectionChange: [key: string];
  ready: [];
}>();

defineExpose({
  exportTopology,
  updateNodeDataFromProps,
  updateLinkDataFromProps,
  applyRuntimePatch,
  previewLinkStyle,
  clearLinkStylePreview,
  previewContainerStyle,
  clearContainerStylePreview,
  undo,
  redo,
  deleteSelection,
  fitView,
  exportSvg
});

const canvasEl = ref<HTMLDivElement | null>(null);
const overviewEl = ref<HTMLDivElement | null>(null);
const miniViewEl = ref<HTMLDivElement | null>(null);
const assetUrlMap = ref<Record<string, string>>({});
const failedAssetValues = new Set<string>();
let diagram: GoJS.Diagram | null = null;
let overview: GoJS.Overview | null = null;
let canvasBoundaryPart: GoJS.Part | null = null;
let applyingModel = false;
let skipNextTopologyApply = false;
// props 增量回写产生的 commit 不再回发 change：父组件会自行应用同一补丁，避免每次编辑全量导出
let suppressChangeEmit = false;
let changeEmitScheduled = false;
let assetExpiryTimer: number | undefined;
let topologyApplyToken = 0;
let lastAppliedTopology: TopologyData | null = null;
let lastTopologyRenderSignature = "";
// 签名按需惰性计算：热路径（属性编辑回写）只做引用比较，避免整棵拓扑 JSON.stringify
let topologySignatureFresh = false;
let flowTimer: number | undefined;
let flowOffset = 0;
let hasAnimatedLinks = false;
let resizeObserver: ResizeObserver | null = null;
let linkStylePreview: { linkKey: string; style: LinkStyle } | null = null;
let containerStylePreview: { nodeKey: string; style: ContainerStyle } | null = null;
let miniViewDrag:
  | {
    didMove: boolean;
    pointerId: number;
    startDocumentPoint: GoJS.Point;
    startPosition: GoJS.Point;
  }
  | null = null;
let miniViewPanelDrag:
  | {
    didMove: boolean;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeft: number;
    startTop: number;
  }
  | null = null;

const SNAP_GRID_SIZE = 2;
const VISIBLE_GRID_SIZE = 10;
const KEYBOARD_NUDGE_STEP = 1;
const KEYBOARD_BIG_NUDGE_STEP = 10;
const EDITOR_BACKGROUND_COLORS = {
  light: "#ffffff",
  dark: "#0f172a",
  transparent: "transparent"
} as const;
const OVERVIEW_VIEWPORT_BOX_NAME = "VIEWPORT_BOX";
const CANVAS_BOUNDARY_SHAPE_NAME = "CANVAS_BOUNDARY_SHAPE";
const MINI_VIEW_MARGIN = 14;
const MINI_VIEW_STORAGE_KEY = "topology:miniview";
const PORT_VISUAL_OFFSET = 14;
const PORT_SIZE = 8;
const NODE_CLICK_PADDING = 6;
const ADORNMENT_PORT_HANDLE_SIZE = 12;
const RESIZE_HANDLE_SIZE = 4;
// 旋转手柄放在右上角对角方向，避开四边的端口手柄
const ROTATE_HANDLE_ANGLE = 315;
const ROTATE_HANDLE_DISTANCE = 10;
// 16x16 视口内的环形箭头（圆弧 + 实心三角箭头），用作旋转手柄图标
const ROTATE_ICON_GEOMETRY = "M12.76 5.25 B330 300 8 8 5.5 5.5 X F M7.8 0.6 L11.2 2.5 L7.8 4.4 Z";
const ASSET_REFRESH_INTERVAL_MS = 91_000;
const IMAGE_PRELOAD_TIMEOUT_MS = 8_000;

type MiniViewCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type DiagramPortData = PortDefinition & {
  side: PortSide;
  positionPercent: number;
};

type DiagramNodeData = TopologyNode & {
  __icon?: string;
  __iconText?: string;
  __hasImageIcon?: boolean;
  __isAnnotation?: boolean;
  __isContainer?: boolean;
  __isControl?: boolean;
  __ports?: DiagramPortData[];
};

type DiagramLinkData = TopologyLink;

type SerializablePoint = {
  x: number;
  y: number;
};

type PickCandidate = {
  key: string;
  label: string;
  kind: "node" | "group" | "link";
  zOrder: number;
  part: GoJS.Part;
};

type PickMenuState = {
  visible: boolean;
  x: number;
  y: number;
  candidates: PickCandidate[];
};

const pickMenu = shallowRef<PickMenuState | null>(null);
let lastPickCycle:
  | {
    pointKey: string;
    keys: string[];
    index: number;
  }
  | null = null;

const miniViewCorner = ref<MiniViewCorner>("bottom-right");
const miniViewCollapsed = ref(false);
const miniViewPanelPosition = ref<{ left: number; top: number } | null>(null);

const miniViewStyle = computed(() => {
  const floatingPosition = miniViewPanelPosition.value;
  if (floatingPosition) {
    return {
      left: `${floatingPosition.left}px`,
      top: `${floatingPosition.top}px`,
      right: "auto",
      bottom: "auto"
    };
  }

  const corner = miniViewCorner.value;
  return {
    top: corner.startsWith("top") ? `${MINI_VIEW_MARGIN}px` : "auto",
    right: corner.endsWith("right") ? `${MINI_VIEW_MARGIN}px` : "auto",
    bottom: corner.startsWith("bottom") ? `${MINI_VIEW_MARGIN}px` : "auto",
    left: corner.endsWith("left") ? `${MINI_VIEW_MARGIN}px` : "auto"
  };
});

function getGo() {
  const localGo = window.go as typeof GoJS | undefined;
  if (!localGo) {
    throw new Error("本地 GoJS 文件未加载成功：apps/web/src/core/go.js");
  }
  return localGo;
}

function cloneModelArray<T>(value: T[]): T[] {
  return JSON.parse(JSON.stringify(value)) as T[];
}

function cloneModelValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeCanvasConfig(canvas?: Partial<TopologyCanvasConfig> | null): TopologyCanvasConfig {
  const width = Number(canvas?.width);
  const height = Number(canvas?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : DEFAULT_TOPOLOGY_CANVAS.width,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : DEFAULT_TOPOLOGY_CANVAS.height
  };
}

type LinkCreationDefaults = {
  direction: NonNullable<TopologyLink["direction"]>;
  showArrow: boolean;
  linkType: NonNullable<TopologyLink["linkType"]>;
  defaultState: NonNullable<TopologyLink["defaultState"]>;
  defaultStyle: LinkStyle;
};

const INITIAL_LINK_DEFAULT_STYLE: LinkStyle = {
  color: "#42B0FF",
  width: 2,
  opacity: 1,
  lineCap: "butt",
  animated: false,
  flowDirection: "fromTo",
  flow: {
    color: "#ffffff",
    width: 3,
    opacity: 0.85,
    dash: [9, 9],
    speed: 4
  },
  glow: {
    enabled: false,
    color: "#42B0FF",
    width: 10,
    opacity: 0.28
  }
};

let linkCreationDefaults: LinkCreationDefaults = {
  direction: "forward",
  showArrow: false,
  linkType: "power-line",
  defaultState: "off",
  defaultStyle: cloneModelArray([INITIAL_LINK_DEFAULT_STYLE])[0]
};

function roundPointValue(value: number) {
  return Math.round(value * 100) / 100;
}

function isPointLike(value: unknown): value is { x: number; y: number } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { x?: unknown }).x === "number"
    && typeof (value as { y?: unknown }).y === "number";
}

function normalizePointArray(points: unknown): SerializablePoint[] | undefined {
  if (!points) return undefined;

  if (Array.isArray(points)) {
    if (points.every((item) => typeof item === "number")) {
      const nextPoints: SerializablePoint[] = [];
      for (let index = 0; index < points.length - 1; index += 2) {
        nextPoints.push({
          x: roundPointValue(points[index] as number),
          y: roundPointValue(points[index + 1] as number)
        });
      }
      return nextPoints.length ? nextPoints : undefined;
    }

    const nextPoints = points
      .filter(isPointLike)
      .map((point) => ({
        x: roundPointValue(point.x),
        y: roundPointValue(point.y)
      }));
    return nextPoints.length ? nextPoints : undefined;
  }

  const goListItems = (points as { s?: unknown }).s;
  if (Array.isArray(goListItems)) return normalizePointArray(goListItems);

  return undefined;
}

function stripDiagramNodeData(nodes: DiagramNodeData[]): TopologyData["nodes"] {
  return nodes.map((node) => {
    const { __hasImageIcon, __icon, __iconText, __isAnnotation, __isContainer, __isControl, __ports, ...topologyNode } = node;
    void __hasImageIcon;
    void __icon;
    void __iconText;
    void __isAnnotation;
    void __isContainer;
    void __isControl;
    void __ports;
    return topologyNode;
  });
}

function exportDiagramNodes(model: GoJS.GraphLinksModel): TopologyData["nodes"] {
  const nodes = cloneModelArray(model.nodeDataArray as DiagramNodeData[]);
  nodes.forEach((nodeData) => {
    if (nodeData.isGroup) return;
    const node = diagram?.findNodeForKey(nodeData.key);
    const rotatePanel = node?.findObject("ROTATE_PANEL");
    if (!rotatePanel) return;
    nodeData.angle = Math.round(Number(rotatePanel.angle) * 100) / 100;
  });
  return stripDiagramNodeData(nodes);
}

function nodeTypeOf(typeId: string) {
  return props.nodeTypes.find((item) => item.id === typeId);
}

function canContainNode(groupType: NodeTypeDefinition | undefined, nodeType: NodeTypeDefinition | undefined, nodeData: TopologyNode) {
  if (!groupType || !nodeType) return false;
  if (nodeData.isGroup && !groupType.allowNestedGroup) return false;
  if (!groupType.canContain?.length) return true;
  return groupType.canContain.includes(nodeType.id) || groupType.canContain.includes(nodeType.category);
}

function isImageIcon(icon?: string) {
  return isImageAsset(icon);
}

function normalizeIcon(icon: string) {
  const resolved = assetUrlMap.value[icon];
  if (resolved) return resolved;
  if (failedAssetValues.has(icon)) return "";
  if (isOssAssetRef(icon)) return "";
  if (icon.startsWith("/uploads/")) return `${API_BASE_URL}${icon}`;
  return icon;
}

function normalizeNodeStatus(status?: string) {
  if (status === "normal") return "default";
  if (status === "running" || status === "fault" || status === "offline" || status === "default") return status;
  return "default";
}

function resolveNodeIcon(node: TopologyNode) {
  const nodeType = nodeTypeOf(node.typeId);
  const statusIcon = nodeType?.category === "equipment"
    ? nodeType.statusImages?.[normalizeNodeStatus(node.runtime?.status)]
    : undefined;
  const propsIcon = typeof node.props?.icon === "string" ? node.props.icon : undefined;
  const directIcon = typeof (node as TopologyNode & { icon?: unknown }).icon === "string"
    ? (node as TopologyNode & { icon?: string }).icon
    : undefined;
  // 状态图尚未取得 OSS 签名地址时继续尝试默认图，避免节点短暂变成空白。
  const candidates = [statusIcon, propsIcon, directIcon, nodeType?.buttonDefaults?.icon, nodeType?.icon];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const icon = normalizeIcon(candidate);
    if (icon) return icon;
  }
  return "";
}

async function resolveAssetEntry(value: string, force = false) {
  if (!force && assetUrlMap.value[value]) return assetUrlMap.value[value];
  try {
    const url = await resolveAssetUrl(value);
    return url || "";
  } catch {
    return "";
  }
}

function topologyAssetValues(data: TopologyData, nodeTypes: NodeTypeDefinition[]) {
  const values = new Set<string>();
  const usedTypeIds = new Set(data.nodes.map((node) => node.typeId));
  const add = (value?: string) => {
    if (value && isImageAsset(value)) values.add(value);
  };

  for (const nodeType of nodeTypes) {
    if (!usedTypeIds.has(nodeType.id)) continue;
    add(nodeType.icon);
    Object.values(nodeType.statusImages ?? {}).forEach(add);
    add(nodeType.buttonDefaults?.icon);
  }
  for (const node of data.nodes) {
    add(typeof node.props?.icon === "string" ? node.props.icon : undefined);
    add(typeof (node as TopologyNode & { icon?: unknown }).icon === "string"
      ? (node as TopologyNode & { icon?: string }).icon
      : undefined);
  }
  return [...values];
}

function preloadImage(url: string) {
  return new Promise<boolean>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    const timer = window.setTimeout(() => finish(false), IMAGE_PRELOAD_TIMEOUT_MS);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
    if (image.complete) finish(image.naturalWidth > 0);
  });
}

async function prepareTopologyAssets(data: TopologyData, nodeTypes: NodeTypeDefinition[], force = false) {
  const values = topologyAssetValues(data, nodeTypes);
  const resolvedEntries = await Promise.all(values.map(async (value) => [value, await resolveAssetEntry(value, force)] as const));
  const preloadByUrl = new Map<string, Promise<boolean>>();
  for (const [, url] of resolvedEntries) {
    if (url && !preloadByUrl.has(url)) preloadByUrl.set(url, preloadImage(url));
  }
  const loadedByUrl = new Map<string, boolean>();
  await Promise.all([...preloadByUrl].map(async ([url, promise]) => loadedByUrl.set(url, await promise)));

  const nextMap = { ...assetUrlMap.value };
  for (const [value, url] of resolvedEntries) {
    if (url && loadedByUrl.get(url) === true) {
      nextMap[value] = url;
      failedAssetValues.delete(value);
    } else if (!nextMap[value]) {
      failedAssetValues.add(value);
    }
  }
  assetUrlMap.value = nextMap;
  scheduleAssetExpiryRefresh();
}

function scheduleAssetExpiryRefresh() {
  if (!diagram) return;
  if (assetExpiryTimer) window.clearTimeout(assetExpiryTimer);
  assetExpiryTimer = window.setTimeout(() => {
    assetExpiryTimer = undefined;
    if (!diagram || !props.topologyData) return;
    void prepareTopologyAssets(props.topologyData, props.nodeTypes, true).then(() => {
      refreshAllDerivedNodeData();
      diagram?.requestUpdate();
    });
  }, ASSET_REFRESH_INTERVAL_MS);
}

function refreshAllDerivedNodeData() {
  if (!diagram) return;
  const model = diagram.model as GoJS.GraphLinksModel;
  model.commit((m) => {
    (model.nodeDataArray as DiagramNodeData[]).forEach((nodeData) => {
      refreshDerivedNodeData(m as GoJS.GraphLinksModel, nodeData);
      m.updateTargetBindings(nodeData);
    });
  }, null);
}

function refreshInteractionBindings() {
  if (!diagram) return;
  const model = diagram.model as GoJS.GraphLinksModel;
  model.commit((m) => {
    (model.nodeDataArray as DiagramNodeData[]).forEach((nodeData) => m.updateTargetBindings(nodeData));
    (model.linkDataArray as DiagramLinkData[]).forEach((linkData) => m.updateTargetBindings(linkData));
  }, null);
}

function resolveIconText(node: TopologyNode, icon: string) {
  if (icon && !isImageIcon(icon)) return icon;
  return node.label?.slice(0, 1) || node.typeId.slice(0, 1).toUpperCase();
}

const DEFAULT_NODE_LABEL_STYLE = {
  color: DEFAULT_TOPOLOGY_TEXT_COLOR,
  fontSize: 13,
  fontWeight: "600",
  fontStyle: "normal" as const,
  textDecoration: "none",
  textAlign: "center" as const
};

function resolveNodeLabelStyle(node: DiagramNodeData): NodeLabelStyle {
  return node.labelStyle ?? {};
}

function resolveNodeLabelColor(node: DiagramNodeData) {
  const color = resolveNodeLabelStyle(node).color;
  return resolveTopologyTextColor(color, DEFAULT_NODE_LABEL_STYLE.color);
}

function resolveNodeLabelFontSize(node: DiagramNodeData) {
  const fontSize = Number(resolveNodeLabelStyle(node).fontSize);
  return Number.isFinite(fontSize) && fontSize > 0 ? Math.round(fontSize) : DEFAULT_NODE_LABEL_STYLE.fontSize;
}

function resolveNodeLabelFontWeight(node: DiagramNodeData) {
  const fontWeight = resolveNodeLabelStyle(node).fontWeight;
  if ((typeof fontWeight === "string" && fontWeight.trim()) || typeof fontWeight === "number") return fontWeight;
  return DEFAULT_NODE_LABEL_STYLE.fontWeight;
}

function resolveNodeLabelFontStyle(node: DiagramNodeData) {
  return resolveNodeLabelStyle(node).fontStyle === "italic" ? "italic" : DEFAULT_NODE_LABEL_STYLE.fontStyle;
}

function resolveNodeLabelFont(node: DiagramNodeData) {
  return `${resolveNodeLabelFontStyle(node)} normal ${resolveNodeLabelFontWeight(node)} ${resolveNodeLabelFontSize(node)}px sans-serif`;
}

function resolveNodeLabelTextDecoration(node: DiagramNodeData) {
  const textDecoration = resolveNodeLabelStyle(node).textDecoration;
  return typeof textDecoration === "string" && textDecoration.trim() ? textDecoration : DEFAULT_NODE_LABEL_STYLE.textDecoration;
}

function nodeLabelHasTextDecoration(node: DiagramNodeData, decoration: "underline" | "line-through") {
  return resolveNodeLabelTextDecoration(node).split(/\s+/).includes(decoration);
}

function resolveNodeLabelTextAlign(node: DiagramNodeData) {
  const textAlign = resolveNodeLabelStyle(node).textAlign;
  return textAlign === "left" || textAlign === "right" ? textAlign : DEFAULT_NODE_LABEL_STYLE.textAlign;
}

function isAnnotationNode(node: TopologyNode) {
  return nodeTypeOf(node.typeId)?.category === "annotation";
}

function isContainerNode(node: TopologyNode) {
  const nodeType = nodeTypeOf(node.typeId);
  return node.isGroup === true || nodeType?.category === "container" || nodeType?.isGroup === true;
}

function isControlNode(node: TopologyNode) {
  const nodeType = nodeTypeOf(node.typeId);
  return nodeType?.category === "control" || nodeType?.template === "buttonTemplate";
}

function resolveAnnotationText(node: DiagramNodeData) {
  const runtimeText = node.runtime?.text;
  if (typeof runtimeText === "string") return runtimeText;
  const template = node.props?.textTemplate;
  return typeof template === "string" && template.trim() ? template : node.label;
}

function resolveAnnotationTextColor(node: DiagramNodeData) {
  return resolveTopologyTextColor(node.props?.textColor, nodeTypeOf(node.typeId)?.annotationDefaults?.textColor);
}

function resolveAnnotationTextSize(node: DiagramNodeData) {
  const size = Number(node.props?.textSize);
  const defaultSize = nodeTypeOf(node.typeId)?.annotationDefaults?.textSize ?? 14;
  return Number.isFinite(size) && size > 0 ? Math.round(size) : Math.round(defaultSize);
}

function resolveAnnotationFontWeight(node: DiagramNodeData) {
  const value = node.props?.fontWeight;
  if ((typeof value === "string" && value.trim()) || typeof value === "number") return value;
  return nodeTypeOf(node.typeId)?.annotationDefaults?.fontWeight ?? "400";
}

function resolveAnnotationFontStyle(node: DiagramNodeData) {
  const value = node.props?.fontStyle;
  if (value === "italic") return value;
  return nodeTypeOf(node.typeId)?.annotationDefaults?.fontStyle === "italic" ? "italic" : "normal";
}

function resolveAnnotationTextFont(node: DiagramNodeData) {
  return `${resolveAnnotationFontStyle(node)} normal ${resolveAnnotationFontWeight(node)} ${resolveAnnotationTextSize(node)}px sans-serif`;
}

function resolveAnnotationTextAlign(node: DiagramNodeData) {
  const value = node.props?.textAlign;
  if (value === "left" || value === "center" || value === "right") return value;
  const defaultValue = nodeTypeOf(node.typeId)?.annotationDefaults?.textAlign;
  return defaultValue === "center" || defaultValue === "right" ? defaultValue : "left";
}

function resolveAnnotationTextDecoration(node: DiagramNodeData) {
  const value = node.props?.textDecoration;
  if (typeof value === "string" && value.trim()) return value;
  return nodeTypeOf(node.typeId)?.annotationDefaults?.textDecoration ?? "none";
}

function annotationHasTextDecoration(node: DiagramNodeData, decoration: "underline" | "line-through") {
  return resolveAnnotationTextDecoration(node).split(/\s+/).includes(decoration);
}

function resolveAnnotationLineHeight(node: DiagramNodeData) {
  const value = Number(node.props?.lineHeight);
  const defaultValue = Number(nodeTypeOf(node.typeId)?.annotationDefaults?.lineHeight);
  const fontSize = resolveAnnotationTextSize(node);
  const fallback = Math.round(fontSize * 1.4);
  if (Number.isFinite(value) && value > 0) return value;
  if (Number.isFinite(defaultValue) && defaultValue > 0) return defaultValue;
  return fallback;
}

function resolveAnnotationLineSpacing(node: DiagramNodeData) {
  return Math.max(0, (resolveAnnotationLineHeight(node) - resolveAnnotationTextSize(node)) / 2);
}

function controlRenderMode(node: DiagramNodeData) {
  const mode = node.props?.buttonRenderMode;
  if (mode === "image" || mode === "imageText" || mode === "text") return mode;
  const defaultMode = nodeTypeOf(node.typeId)?.buttonDefaults?.buttonRenderMode;
  return defaultMode === "image" || defaultMode === "imageText" || defaultMode === "text" ? defaultMode : "text";
}

function resolveControlText(node: DiagramNodeData) {
  const text = node.props?.buttonText;
  if (typeof text === "string" && text.trim()) return text;
  return nodeTypeOf(node.typeId)?.buttonDefaults?.buttonText ?? node.label;
}

function numberProp(node: DiagramNodeData, field: string, fallback: number) {
  const value = Number(node.props?.[field]);
  return Number.isFinite(value) ? value : fallback;
}

function stringProp(node: DiagramNodeData, field: string, fallback: string) {
  const value = node.props?.[field];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function resolveControlFill(node: DiagramNodeData) {
  return stringProp(node, "buttonStyleBackgroundColor", nodeTypeOf(node.typeId)?.buttonStyleDefaults?.backgroundColor ?? "#eff6ff");
}

function resolveControlStroke(node: DiagramNodeData) {
  return stringProp(node, "buttonStyleBorderColor", nodeTypeOf(node.typeId)?.buttonStyleDefaults?.borderColor ?? "#2563eb");
}

function resolveControlStrokeWidth(node: DiagramNodeData) {
  return Math.max(0, numberProp(node, "buttonStyleBorderWidth", nodeTypeOf(node.typeId)?.buttonStyleDefaults?.borderWidth ?? 1.5));
}

function resolveControlCorner(node: DiagramNodeData) {
  return Math.max(0, Math.round(numberProp(node, "buttonStyleBorderRadius", nodeTypeOf(node.typeId)?.buttonStyleDefaults?.borderRadius ?? 6)));
}

function resolveControlTextStroke(node: DiagramNodeData) {
  return stringProp(node, "buttonStyleTextColor", nodeTypeOf(node.typeId)?.buttonStyleDefaults?.textColor ?? "#1d4ed8");
}

function resolveControlTextFont(node: DiagramNodeData) {
  const fontSize = Math.max(1, Math.round(numberProp(node, "buttonStyleTextSize", nodeTypeOf(node.typeId)?.buttonStyleDefaults?.textSize ?? 13)));
  return `600 ${fontSize}px sans-serif`;
}

function resolveControlContentMargin(node: DiagramNodeData) {
  const go = getGo();
  const buttonStyleDefaults = nodeTypeOf(node.typeId)?.buttonStyleDefaults;
  const paddingX = Math.max(0, Math.round(numberProp(node, "buttonStylePaddingX", buttonStyleDefaults?.paddingX ?? 10)));
  const paddingY = Math.max(0, Math.round(numberProp(node, "buttonStylePaddingY", buttonStyleDefaults?.paddingY ?? 5)));
  return new go.Margin(paddingY, paddingX, paddingY, paddingX);
}

function shouldShowControlImage(node: DiagramNodeData) {
  const mode = controlRenderMode(node);
  return node.__isControl === true && mode === "imageText" && node.__hasImageIcon === true;
}

function shouldShowControlText(node: DiagramNodeData) {
  const mode = controlRenderMode(node);
  return node.__isControl === true && (mode !== "image" || !node.__hasImageIcon);
}

function shouldShowPureControlImage(node: DiagramNodeData) {
  return node.__isControl === true && controlRenderMode(node) === "image" && node.__hasImageIcon === true;
}

function shouldShowStyledControl(node: DiagramNodeData) {
  return node.__isControl === true && !shouldShowPureControlImage(node);
}

function shouldShowNodeLabel(node: DiagramNodeData) {
  return node.__isAnnotation || node.__isControl ? false : node.props?.showLabel !== false;
}

function shouldShowGroupLabel(node: DiagramNodeData) {
  return node.props?.showLabel === true;
}

function colorWithOpacity(color: string, opacity: number) {
  const safeOpacity = Math.max(0, Math.min(1, opacity));
  const hex = color.trim();
  const fullHex = /^#[0-9a-f]{3}$/i.test(hex)
    ? `#${hex.slice(1).split("").map((item) => `${item}${item}`).join("")}`
    : hex;
  const match = fullHex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return color;
  const [, red, green, blue] = match;
  return `rgba(${parseInt(red, 16)}, ${parseInt(green, 16)}, ${parseInt(blue, 16)}, ${safeOpacity})`;
}

function resolveGroupFill(node: DiagramNodeData) {
  const defaults = nodeTypeOf(node.typeId)?.groupStyleDefaults;
  const preview = resolvePreviewContainerStyle(node);
  const transparentBackground = preview?.transparentBackground ?? node.runtime?.transparentBackground ?? node.props?.transparentBackground ?? defaults?.transparentBackground;
  if (transparentBackground === true) return "transparent";
  const color = preview?.backgroundColor || node.runtime?.backgroundColor || defaults?.backgroundColor || "#eef6ff";
  const opacity = Number(preview?.backgroundOpacity ?? node.runtime?.backgroundOpacity ?? node.props?.backgroundOpacity ?? defaults?.backgroundOpacity);
  if (!Number.isFinite(opacity)) return color;
  return colorWithOpacity(color, opacity / 100);
}

function resolveGroupStroke(node: DiagramNodeData) {
  return resolvePreviewContainerStyle(node)?.borderColor || node.runtime?.borderColor || nodeTypeOf(node.typeId)?.groupStyleDefaults?.borderColor || "#3b82f6";
}

function resolveGroupStrokeDash(node: DiagramNodeData) {
  const dashedBorder = resolvePreviewContainerStyle(node)?.dashedBorder ?? node.runtime?.dashedBorder ?? node.props?.dashedBorder ?? nodeTypeOf(node.typeId)?.groupStyleDefaults?.dashedBorder;
  return dashedBorder === true ? [8, 6] : null;
}

function buildPortData(typeId: string): DiagramPortData[] {
  const nodeType = nodeTypeOf(typeId);
  const ports = resolveNodeTypePorts(nodeType);
  return ports.map(normalizePortDefinition);
}

function resolveNodeTypePorts(nodeType?: NodeTypeDefinition): PortDefinition[] {
  return Array.isArray(nodeType?.ports) ? nodeType.ports : defaultNodePorts;
}

function getDefaultNodeSize(node: TopologyNode) {
  const nodeType = nodeTypeOf(node.typeId);
  if (nodeType?.defaultSize) return nodeType.defaultSize;
  if (node.isGroup || nodeType?.isGroup) return { width: 320, height: 220 };
  if (nodeType?.category === "annotation") return { width: 140, height: 64 };
  if (nodeType?.category === "control") return { width: 112, height: 42 };
  return { width: 104, height: 92 };
}

function buildDiagramNodes(nodes: TopologyData["nodes"]): DiagramNodeData[] {
  return cloneModelArray(nodes).map((node) => {
    const icon = resolveNodeIcon(node);
    const size = node.size ?? `${getDefaultNodeSize(node).width} ${getDefaultNodeSize(node).height}`;
    return {
      ...node,
      size,
      __icon: icon,
      __iconText: resolveIconText(node, icon),
      __hasImageIcon: isImageIcon(icon),
      __isAnnotation: isAnnotationNode(node),
      __isContainer: isContainerNode(node),
      __isControl: isControlNode(node),
      __ports: buildPortData(node.typeId)
    };
  });
}

function refreshDerivedNodeData(model: GoJS.GraphLinksModel, nodeData: DiagramNodeData) {
  const icon = resolveNodeIcon(nodeData);
  model.setDataProperty(nodeData, "__icon", icon);
  model.setDataProperty(nodeData, "__iconText", resolveIconText(nodeData, icon));
  model.setDataProperty(nodeData, "__hasImageIcon", isImageIcon(icon));
  model.setDataProperty(nodeData, "__isAnnotation", isAnnotationNode(nodeData));
  model.setDataProperty(nodeData, "__isContainer", isContainerNode(nodeData));
  model.setDataProperty(nodeData, "__isControl", isControlNode(nodeData));
  model.setDataProperty(nodeData, "__ports", buildPortData(nodeData.typeId));
}

function buildDiagramLinks(links: TopologyData["links"]): DiagramLinkData[] {
  return cloneModelArray(links).map((link) => {
    const normalizedPoints = normalizePointArray(link.points);
    return {
      ...link,
      fromPort: normalizePortId(link.fromPort),
      toPort: normalizePortId(link.toPort),
      ...(normalizedPoints ? { points: normalizedPoints } : {})
    };
  });
}

function serializeLinkPoints(link: GoJS.Link): SerializablePoint[] | undefined {
  const points: SerializablePoint[] = [];
  for (let index = 0; index < link.pointsCount; index += 1) {
    const point = link.getPoint(index);
    points.push({
      x: roundPointValue(point.x),
      y: roundPointValue(point.y)
    });
  }
  return points.length ? points : undefined;
}

function exportDiagramLinks(model: GoJS.GraphLinksModel): TopologyData["links"] {
  return (model.linkDataArray as DiagramLinkData[]).map((linkData) => {
    const { points, ...restLinkData } = linkData;
    const restLink = cloneModelValue(restLinkData);
    const link = diagram?.findLinkForData(linkData);
    const livePoints = link ? serializeLinkPoints(link) : normalizePointArray(points);
    return {
      ...restLink,
      ...(livePoints ? { points: livePoints } : {})
    };
  });
}

function toGoSpot(side: PortSide) {
  const go = getGo();
  if (side === "left") return go.Spot.Left;
  if (side === "right") return go.Spot.Right;
  if (side === "top") return go.Spot.Top;
  return go.Spot.Bottom;
}

function normalizeLabelPosition(position?: string): NodeLabelPosition {
  if (position === "top" || position === "right" || position === "left") return position;
  return "bottom";
}

function toGoLabelAlignment(node?: DiagramNodeData) {
  const go = getGo();
  const labelPosition = normalizeLabelPosition(node?.labelPosition);
  const offset = node?.labelOffset;
  const dx = Number(offset?.x) || 0;
  const dy = Number(offset?.y) || 0;
  if (labelPosition === "top") return new go.Spot(0.5, 0, dx, -8 + dy);
  if (labelPosition === "right") return new go.Spot(1, 0.5, 8 + dx, dy);
  if (labelPosition === "left") return new go.Spot(0, 0.5, -8 + dx, dy);
  return new go.Spot(0.5, 1, dx, 8 + dy);
}

function toGoLabelAlignmentFocus(position?: string) {
  const go = getGo();
  const labelPosition = normalizeLabelPosition(position);
  if (labelPosition === "top") return go.Spot.Bottom;
  if (labelPosition === "right") return go.Spot.Left;
  if (labelPosition === "left") return go.Spot.Right;
  return go.Spot.Top;
}

function toGoPortAlignment(port: DiagramPortData, offset: number) {
  const go = getGo();
  const { x, y } = portAlignmentFraction(port);
  if (port.side === "left") return new go.Spot(x, y, offset, 0);
  if (port.side === "right") return new go.Spot(x, y, -offset, 0);
  if (port.side === "top") return new go.Spot(x, y, 0, offset);
  return new go.Spot(x, y, 0, -offset);
}

function toGoVisualPortAlignment(port: DiagramPortData) {
  return toGoPortAlignment(port, -PORT_VISUAL_OFFSET);
}

/**
 * 选中态的 Adornment 锚定在 selectionObject 上：普通节点为带 6px 内边距的
 * CLICK_AREA，而物理/可视端口锚定在 BODY。将 BODY 坐标换算到 Adornment
 * 坐标系后，手柄中心才能与可视代理端口（BODY 外 14px）精确重合。
 */
function toGoAdornmentPortAlignment(port: DiagramPortData, target: GoJS.GraphObject) {
  const go = getGo();
  const adornment = target.part;
  const adornedPart = adornment instanceof go.Adornment ? adornment.adornedPart : null;
  const clickPadding = adornedPart instanceof go.Group ? 0 : NODE_CLICK_PADDING;
  const { width, height } = parseNodeSize(adornedPart?.data?.size);
  const fraction = port.positionPercent / 100;
  const x = (clickPadding + fraction * width) / (width + clickPadding * 2);
  const y = (clickPadding + fraction * height) / (height + clickPadding * 2);
  // CLICK_AREA 已比 BODY 向外扩展了 clickPadding，因此只需再向外偏移剩余距离。
  const offset = PORT_VISUAL_OFFSET - clickPadding;

  if (port.side === "left") return new go.Spot(0, y, -offset, 0);
  if (port.side === "right") return new go.Spot(1, y, offset, 0);
  if (port.side === "top") return new go.Spot(x, 0, 0, -offset);
  return new go.Spot(x, 1, 0, offset);
}

function visualPortId(portId: string) {
  return `${VISUAL_PORT_ID_PREFIX}${portId}`;
}

function normalizePortId(portId?: string | null) {
  if (!portId) return undefined;
  return portId?.startsWith(VISUAL_PORT_ID_PREFIX)
    ? portId.slice(VISUAL_PORT_ID_PREFIX.length)
    : portId;
}

function portTooltipText(port?: DiagramPortData) {
  return port ? `${port.label}（${port.direction}）` : "";
}

function parseNodeSize(size?: string) {
  const [width, height] = (size ?? "").split(/\s+/).map((item) => Number(item));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 104,
    height: Number.isFinite(height) && height > 0 ? height : 92
  };
}

function getIconDesiredSize(size?: string) {
  const go = getGo();
  const { width, height } = parseNodeSize(size);
  return new go.Size(Math.max(1, width), Math.max(1, height));
}

function shouldUseNodeStatusColor(node: DiagramNodeData) {
  return nodeTypeOf(node.typeId)?.category !== "equipment";
}

function resolveNodeStatusColor(node: DiagramNodeData) {
  if (!shouldUseNodeStatusColor(node)) return "transparent";
  const runtime = node.runtime;
  if (runtime?.color) return runtime.color;
  if (runtime?.status === "running") return "#22c55e";
  if (runtime?.status === "normal") return "#22c55e";
  if (runtime?.status === "warning") return "#f59e0b";
  if (runtime?.status === "fault") return "#ef4444";
  if (runtime?.status === "offline") return "#64748b";
  if (runtime?.status === "unknown") return "#94a3b8";
  return "transparent";
}

function hasNodeRuntimeStatus(node: DiagramNodeData) {
  return shouldUseNodeStatusColor(node) && (!!node.runtime?.status || !!node.runtime?.color);
}

function getLabelWidth(size?: string) {
  return Math.max(80, parseNodeSize(size).width + 32);
}

function normalizeNodeAngle(angle?: number) {
  return Number.isFinite(angle) ? Number(angle) : 0;
}

function normalizeZOrder(zOrder?: number) {
  return Number.isFinite(zOrder) ? Number(zOrder) : 0;
}

function canLinkFrom(direction?: PortDefinition["direction"]) {
  return direction === "out" || direction === "both";
}

function canLinkTo(direction?: PortDefinition["direction"]) {
  return direction === "in" || direction === "both";
}

function findNodePort(typeId: string, portId: string) {
  return resolveNodeTypePorts(nodeTypeOf(typeId)).find((port) => port.id === normalizePortId(portId));
}

function getConnectedCount(node: GoJS.Node, portId: string, direction: "from" | "to") {
  let count = 0;
  const iterator = direction === "from" ? node.findLinksOutOf(portId) : node.findLinksInto(portId);
  while (iterator.next()) count += 1;
  return count;
}

function validateLink(fromNode: GoJS.Node, fromPort: GoJS.GraphObject, toNode: GoJS.Node, toPort: GoJS.GraphObject) {
  const fromPortId = normalizePortId(fromPort.portId);
  const toPortId = normalizePortId(toPort.portId);
  if (!fromPortId || !toPortId) return false;

  const fromDef = findNodePort(fromNode.data.typeId, fromPortId);
  const toDef = findNodePort(toNode.data.typeId, toPortId);
  if (!fromDef || !toDef) return false;
  if (!canLinkFrom(fromDef.direction) || !canLinkTo(toDef.direction)) return false;

  if (fromDef.maxLinks !== undefined && getConnectedCount(fromNode, fromPortId, "from") >= fromDef.maxLinks) return false;
  if (toDef.maxLinks !== undefined && getConnectedCount(toNode, toPortId, "to") >= toDef.maxLinks) return false;

  if (fromDef.linkTypes?.length && toDef.linkTypes?.length) {
    return fromDef.linkTypes.some((type) => toDef.linkTypes?.includes(type));
  }

  return true;
}

function createLinkKey(model: GoJS.GraphLinksModel) {
  const used = new Set((model.linkDataArray as Array<{ key?: string }>).map((link) => link.key).filter(Boolean));
  let index = used.size + 1;
  let key = `link_${String(index).padStart(3, "0")}`;
  while (used.has(key)) {
    index += 1;
    key = `link_${String(index).padStart(3, "0")}`;
  }
  return key;
}

function mergeLinkStyle(base: LinkStyle | undefined, patch: LinkStyle | undefined): LinkStyle {
  if (!patch) return cloneModelArray([base ?? INITIAL_LINK_DEFAULT_STYLE])[0];
  return {
    ...(base ?? {}),
    ...patch,
    flow: patch.flow
      ? { ...(base?.flow ?? {}), ...patch.flow }
      : base?.flow,
    glow: patch.glow
      ? { ...(base?.glow ?? {}), ...patch.glow }
      : base?.glow
  };
}

function cloneLinkStyle(style: LinkStyle | undefined): LinkStyle {
  return cloneModelArray([style ?? INITIAL_LINK_DEFAULT_STYLE])[0];
}

function buildDefaultLinkRuntime(style: LinkStyle, state: NonNullable<TopologyLink["defaultState"]> = "off"): TopologyLink["runtime"] {
  return {
    state,
    color: style.color ?? "#42B0FF",
    width: style.width ?? 2,
    opacity: style.opacity ?? 1,
    lineCap: style.lineCap ?? "butt",
    animated: style.animated ?? false,
    flowDirection: style.flowDirection ?? "fromTo",
    dash: style.dash ? [...style.dash] : undefined,
    flow: style.flow ? cloneModelArray([style.flow])[0] : undefined,
    glow: style.glow ? cloneModelArray([style.glow])[0] : undefined
  };
}

function rememberLinkCreationDefaults(patch: Partial<TopologyLink>) {
  if (patch.direction) linkCreationDefaults.direction = patch.direction;
  if (patch.showArrow !== undefined) linkCreationDefaults.showArrow = patch.showArrow;
  if (patch.linkType) linkCreationDefaults.linkType = patch.linkType;
  if (patch.defaultState) linkCreationDefaults.defaultState = patch.defaultState;
  if (patch.defaultStyle) {
    linkCreationDefaults.defaultStyle = mergeLinkStyle(linkCreationDefaults.defaultStyle, patch.defaultStyle);
  }
}

function createNodeKey(model: GoJS.GraphLinksModel, data: Partial<TopologyNode>) {
  const used = new Set((model.nodeDataArray as Array<{ key?: string }>).map((node) => node.key).filter(Boolean));
  const prefix = data.isGroup ? "group" : data.typeId || "node";
  let index = used.size + 1;
  let key = `${prefix}_${String(index).padStart(3, "0")}`;
  while (used.has(key)) {
    index += 1;
    key = `${prefix}_${String(index).padStart(3, "0")}`;
  }
  return key;
}

function configureModel(model: GoJS.GraphLinksModel) {
  model.nodeGroupKeyProperty = "group";
  model.linkKeyProperty = "key";
  model.linkFromPortIdProperty = "fromPort";
  model.linkToPortIdProperty = "toPort";
  model.copiesArrays = true;
  model.copiesArrayObjects = true;
  model.makeUniqueKeyFunction = (m, data) => data.key || createNodeKey(m as GoJS.GraphLinksModel, data as Partial<TopologyNode>);
  model.makeUniqueLinkKeyFunction = (m, data) => data.key || createLinkKey(m as GoJS.GraphLinksModel);
  return model;
}

function isConnectionToolActive(targetDiagram: GoJS.Diagram) {
  return targetDiagram.currentTool === targetDiagram.toolManager.linkingTool
    || targetDiagram.currentTool === targetDiagram.toolManager.relinkingTool;
}

function shouldEnableNodePort(node: GoJS.Node, port: DiagramPortData) {
  if (!diagram || props.mode !== "edit") return false;
  const nodeData = node.data as DiagramNodeData | null | undefined;
  if (!nodeData?.__ports?.some((candidate) => candidate.id === port.id)) return false;
  return node.isSelected || isConnectionToolActive(diagram);
}

function shouldShowNodePortVisual(node: GoJS.Node, port: DiagramPortData) {
  if (!diagram || props.mode !== "edit") return false;
  const nodeData = node.data as DiagramNodeData | null | undefined;
  if (!nodeData?.__ports?.some((candidate) => candidate.id === port.id)) return false;
  return isConnectionToolActive(diagram);
}

function refreshPortVisibility() {
  if (!diagram) return;
  diagram.nodes.each((node) => {
    const ports = (node.data as DiagramNodeData | null | undefined)?.__ports ?? [];
    ports.forEach((portData) => {
      const port = node.findPort(portData.id);
      const visualPort = node.findPort(visualPortId(portData.id));
      if (!port || !visualPort) return;

      const enabled = shouldEnableNodePort(node, portData);
      const visible = shouldShowNodePortVisual(node, portData);
      port.opacity = 1;
      port.pickable = false;
      port.fromLinkable = false;
      port.toLinkable = false;
      visualPort.opacity = visible ? 1 : 0;
      visualPort.pickable = visible;
      visualPort.fromLinkable = enabled && canLinkFrom(portData.direction);
      visualPort.toLinkable = enabled && canLinkTo(portData.direction);
    });
  });
}

function updateDiagramMode() {
  if (!diagram) return;
  diagram.isReadOnly = props.mode === "runtime";
  diagram.allowSelect = props.mode === "edit";
  diagram.allowDrop = props.mode === "edit";
  diagram.allowResize = props.mode === "edit";
  diagram.grid.visible = props.mode === "edit";
  diagram.toolManager.draggingTool.isEnabled = props.mode === "edit";
  diagram.toolManager.linkingTool.isEnabled = props.mode === "edit";
  diagram.toolManager.relinkingTool.isEnabled = props.mode === "edit";
  diagram.toolManager.resizingTool.isEnabled = props.mode === "edit";
  diagram.toolManager.rotatingTool.isEnabled = props.mode === "edit";
  diagram.toolManager.linkReshapingTool.isEnabled = props.mode === "edit";
  if (props.mode === "runtime") diagram.clearSelection();
  refreshPortVisibility();
}

function syncSelectedPart() {
  if (!diagram) return;
  if (!props.selectedKey) {
    diagram.clearSelection();
    return;
  }

  const part = diagram.findNodeForKey(props.selectedKey) ?? diagram.findLinkForKey(props.selectedKey);
  if (part) diagram.select(part);
  refreshPortVisibility();
}

function exportTopology(): TopologyData | null {
  if (!diagram || !props.topologyData) return props.topologyData;
  const model = diagram.model as GoJS.GraphLinksModel;
  return {
    ...props.topologyData,
    nodes: exportDiagramNodes(model),
    links: exportDiagramLinks(model)
  };
}

function getTopologyRenderSignature(data: TopologyData | null) {
  if (!data) return "";
  return JSON.stringify({
    id: data.id,
    canvas: data.canvas,
    nodes: data.nodes,
    links: data.links,
    viewport: data.viewport
  });
}

function acknowledgeAppliedTopology() {
  lastAppliedTopology = props.topologyData;
  topologySignatureFresh = false;
}

function updateNodeDataFromProps(nodeKey: string, patch: Partial<TopologyNode>) {
  if (!diagram) return;
  const model = diagram.model as GoJS.GraphLinksModel;
  const nodeData = model.findNodeDataForKey(nodeKey) as DiagramNodeData | null;
  if (!nodeData) return;

  suppressChangeEmit = true;
  try {
    model.commit((m) => {
      Object.entries(patch).forEach(([key, value]) => {
        if (key === "runtime") {
          m.setDataProperty(nodeData, "runtime", value as TopologyNode["runtime"]);
          return;
        }
        m.setDataProperty(nodeData, key, value);
      });
      refreshDerivedNodeData(m as GoJS.GraphLinksModel, nodeData);
      m.updateTargetBindings(nodeData);
    }, "update node from props");
  } finally {
    suppressChangeEmit = false;
  }
  // 模型已按补丁更新，吸收父组件随后的同内容 prop 回写
  skipNextTopologyApply = true;
}

function updateLinkDataFromProps(linkKey: string, patch: Partial<TopologyLink>) {
  if (!diagram) return;
  const model = diagram.model as GoJS.GraphLinksModel;
  const linkData = model.findLinkDataForKey(linkKey) as DiagramLinkData | null;
  if (!linkData) return;

  if (props.mode === "edit") rememberLinkCreationDefaults(patch);

  suppressChangeEmit = true;
  try {
    commitLinkPatch(model, linkData, patch);
  } finally {
    suppressChangeEmit = false;
  }
  // 模型已按补丁更新，吸收父组件随后的同内容 prop 回写
  skipNextTopologyApply = true;

  refreshAnimatedLinkFlag();
  const link = diagram.findLinkForData(linkData);
  link?.invalidateRoute();
  link?.updateRoute();
}

function commitLinkPatch(model: GoJS.GraphLinksModel, linkData: DiagramLinkData, patch: Partial<TopologyLink>) {
  model.commit((m) => {
    Object.entries(patch).forEach(([key, value]) => {
      if (key === "runtime") {
        const nextRuntime = value as TopologyLink["runtime"];
        m.setDataProperty(linkData, "runtime", {
          ...(linkData.runtime ?? {}),
          ...(nextRuntime ?? {}),
          flow: nextRuntime?.flow
            ? { ...(linkData.runtime?.flow ?? {}), ...nextRuntime.flow }
            : linkData.runtime?.flow,
          glow: nextRuntime?.glow
            ? { ...(linkData.runtime?.glow ?? {}), ...nextRuntime.glow }
            : linkData.runtime?.glow
        });
        return;
      }
      if (key === "defaultStyle") {
        const nextDefaultStyle = value as TopologyLink["defaultStyle"];
        m.setDataProperty(linkData, "defaultStyle", mergeLinkStyle(linkData.defaultStyle, nextDefaultStyle));
        return;
      }
      m.setDataProperty(linkData, key, value);
    });
    m.updateTargetBindings(linkData);
  }, "update link from props");
}

type RuntimePatch = {
  nodes: Array<{ key: string; runtime: TopologyNode["runtime"] }>;
  links: Array<{ key: string; runtime: TopologyLink["runtime"] }>;
};

function applyRuntimePatch(patch: RuntimePatch) {
  if (!diagram) return false;
  const model = diagram.model as GoJS.GraphLinksModel;
  // null 事务名 => skipsUndoManager，避免运行态轮询不断累积撤销历史
  model.commit((m) => {
    patch.nodes.forEach(({ key, runtime }) => {
      const nodeData = model.findNodeDataForKey(key) as DiagramNodeData | null;
      if (!nodeData) return;
      m.setDataProperty(nodeData, "runtime", runtime);
      refreshDerivedNodeData(m as GoJS.GraphLinksModel, nodeData);
      m.updateTargetBindings(nodeData);
    });
    patch.links.forEach(({ key, runtime }) => {
      const linkData = model.findLinkDataForKey(key) as DiagramLinkData | null;
      if (!linkData) return;
      m.setDataProperty(linkData, "runtime", runtime);
      m.updateTargetBindings(linkData);
    });
  }, null);
  refreshAnimatedLinkFlag();
  return true;
}

function refreshLinkStyleBinding(linkKey: string | undefined) {
  if (!diagram || !linkKey) return;
  const model = diagram.model as GoJS.GraphLinksModel;
  const linkData = model.findLinkDataForKey(linkKey) as DiagramLinkData | null;
  if (!linkData) return;
  model.updateTargetBindings(linkData);
  const link = diagram.findLinkForData(linkData);
  link?.invalidateRoute();
  link?.updateRoute();
  diagram.requestUpdate();
}

function refreshNodeStyleBinding(nodeKey: string | undefined) {
  if (!diagram || !nodeKey) return;
  const model = diagram.model as GoJS.GraphLinksModel;
  const nodeData = model.findNodeDataForKey(nodeKey) as DiagramNodeData | null;
  if (!nodeData) return;
  model.updateTargetBindings(nodeData);
  diagram.requestUpdate();
}

function previewLinkStyle(linkKey: string, style: LinkStyle) {
  const previousKey = linkStylePreview?.linkKey;
  linkStylePreview = { linkKey, style: cloneModelArray([style])[0] };
  refreshLinkStyleBinding(previousKey);
  refreshLinkStyleBinding(linkKey);
  refreshAnimatedLinkFlag();
}

function previewContainerStyle(nodeKey: string, style: ContainerStyle) {
  const previousKey = containerStylePreview?.nodeKey;
  containerStylePreview = { nodeKey, style: cloneModelArray([style])[0] };
  refreshNodeStyleBinding(previousKey);
  refreshNodeStyleBinding(nodeKey);
}

function clearContainerStylePreview(nodeKey?: string) {
  if (!containerStylePreview || (nodeKey && containerStylePreview.nodeKey !== nodeKey)) return;
  const previousKey = containerStylePreview.nodeKey;
  containerStylePreview = null;
  refreshNodeStyleBinding(previousKey);
}

function clearLinkStylePreview(linkKey?: string) {
  if (!linkStylePreview || (linkKey && linkStylePreview.linkKey !== linkKey)) return;
  const previousKey = linkStylePreview.linkKey;
  linkStylePreview = null;
  refreshLinkStyleBinding(previousKey);
  refreshAnimatedLinkFlag();
}

function resolvePreviewContainerStyle(node: DiagramNodeData) {
  return containerStylePreview?.nodeKey === node.key ? containerStylePreview.style : undefined;
}

function resolvePreviewStyle(link: DiagramLinkData) {
  return linkStylePreview?.linkKey === link.key ? linkStylePreview.style : undefined;
}

function resolveLinkColor(link: DiagramLinkData) {
  const preview = resolvePreviewStyle(link);
  if (preview?.color !== undefined) return preview.color;
  if (props.mode === "edit") return link.defaultStyle?.color || link.runtime?.color || "#42B0FF";
  return link.runtime?.color || link.defaultStyle?.color || "#42B0FF";
}

function resolveLinkWidth(link: DiagramLinkData) {
  const preview = resolvePreviewStyle(link);
  if (preview?.width !== undefined) return preview.width;
  if (props.mode === "edit") return link.defaultStyle?.width || link.runtime?.width || 2;
  return link.runtime?.width || link.defaultStyle?.width || 2;
}

function resolveLinkOpacity(link: DiagramLinkData) {
  const preview = resolvePreviewStyle(link);
  if (preview?.opacity !== undefined) return preview.opacity;
  if (props.mode === "edit") return link.defaultStyle?.opacity ?? link.runtime?.opacity ?? 1;
  return link.runtime?.opacity ?? link.defaultStyle?.opacity ?? 1;
}

function resolveLinkDash(link: DiagramLinkData) {
  const preview = resolvePreviewStyle(link);
  if (preview && "dash" in preview) return preview.dash ?? null;
  if (props.mode === "edit") return link.defaultStyle?.dash ?? link.runtime?.dash ?? null;
  return link.runtime?.dash ?? link.defaultStyle?.dash ?? null;
}

function resolveLinkLineCap(link: DiagramLinkData) {
  const preview = resolvePreviewStyle(link);
  if (preview?.lineCap !== undefined) return preview.lineCap;
  if (props.mode === "edit") return link.defaultStyle?.lineCap || link.runtime?.lineCap || "butt";
  return link.runtime?.lineCap || link.defaultStyle?.lineCap || "butt";
}

function resolveLinkAnimated(link: DiagramLinkData) {
  const preview = resolvePreviewStyle(link);
  if (preview?.animated !== undefined) return preview.animated;
  if (props.mode === "edit") return link.defaultStyle?.animated ?? link.runtime?.animated ?? false;
  return link.runtime?.animated ?? link.defaultStyle?.animated ?? false;
}

function resolveLinkFlowDirection(link: DiagramLinkData) {
  const preview = resolvePreviewStyle(link);
  if (preview?.flowDirection !== undefined) return preview.flowDirection;
  if (props.mode === "edit") return link.defaultStyle?.flowDirection || link.runtime?.flowDirection || "fromTo";
  return link.runtime?.flowDirection || link.defaultStyle?.flowDirection || "fromTo";
}

function resolveLinkLayer(link: DiagramLinkData) {
  return resolveLinkAnimated(link) ? "Foreground" : "";
}

function resolveLinkZOrder(link: DiagramLinkData) {
  return resolveLinkAnimated(link) ? 1000 : 0;
}

function resolveLinkGlow(link: DiagramLinkData) {
  const preview = resolvePreviewStyle(link);
  if (preview?.glow) {
    const base = props.mode === "edit"
      ? link.defaultStyle?.glow ?? link.runtime?.glow
      : link.runtime?.glow ?? link.defaultStyle?.glow;
    return { ...(base ?? {}), ...preview.glow };
  }
  return props.mode === "edit"
    ? link.defaultStyle?.glow ?? link.runtime?.glow
    : link.runtime?.glow ?? link.defaultStyle?.glow;
}

function resolveLinkGlowVisible(link: DiagramLinkData) {
  return resolveLinkGlow(link)?.enabled === true;
}

function resolveLinkGlowColor(link: DiagramLinkData) {
  return resolveLinkGlow(link)?.color || resolveLinkColor(link);
}

function resolveLinkGlowWidth(link: DiagramLinkData) {
  return Math.max(resolveLinkWidth(link), resolveLinkGlow(link)?.width ?? resolveLinkWidth(link) + 8);
}

function resolveLinkGlowOpacity(link: DiagramLinkData) {
  return resolveLinkGlow(link)?.opacity ?? 0.28;
}

function resolveFlowLinkWidth(link: DiagramLinkData) {
  return Math.max(1, resolveLinkFlow(link).width ?? Math.max(2, resolveLinkWidth(link)));
}

function resolveFlowLinkDash(link: DiagramLinkData) {
  return resolveLinkFlow(link).dash ?? [9, 9];
}

function resolveLinkFlow(link: DiagramLinkData): NonNullable<LinkStyle["flow"]> {
  const fallback = INITIAL_LINK_DEFAULT_STYLE.flow ?? {};
  const base = props.mode === "edit"
    ? link.defaultStyle?.flow ?? link.runtime?.flow
    : link.runtime?.flow ?? link.defaultStyle?.flow;
  const preview = resolvePreviewStyle(link)?.flow;
  return {
    ...fallback,
    ...(base ?? {}),
    ...(preview ?? {})
  };
}

function resolveFlowLinkColor(link: DiagramLinkData) {
  return resolveLinkFlow(link).color || "#ffffff";
}

function resolveFlowLinkOpacity(link: DiagramLinkData) {
  return resolveLinkFlow(link).opacity ?? Math.min(0.9, Math.max(0.45, resolveLinkOpacity(link) * 0.85));
}

function resolveFlowLinkSpeed(link: DiagramLinkData) {
  const speed = Number(resolveLinkFlow(link).speed ?? 4);
  if (!Number.isFinite(speed)) return 4;
  return Math.max(0, Math.min(10, speed));
}

function resolveFlowDashCycle(link: DiagramLinkData) {
  const cycle = resolveFlowLinkDash(link).reduce((sum, item) => {
    return sum + (Number.isFinite(item) && item > 0 ? item : 0);
  }, 0);
  return cycle > 0 ? cycle : 18;
}

function resolveFlowDashOffset(link: DiagramLinkData, offset: number) {
  if (offset === 0) return 0;
  const cycle = resolveFlowDashCycle(link);
  const normalizedOffset = ((offset % cycle) + cycle) % cycle;
  if (resolveLinkFlowDirection(link) === "toFrom") {
    return normalizedOffset === 0 ? 0 : cycle - normalizedOffset;
  }
  return normalizedOffset;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeDataKeys(node: TopologyNode) {
  return nodeRuleIdentityCandidates(node);
}

function preferredNodeDataKey(node: TopologyNode) {
  return nodeRuleIdentity(node);
}

function readDefinedPath(source: Record<string, unknown>, path: string) {
  const value = readExpressionPath(source, path);
  return value === undefined ? undefined : value;
}

function runtimeFieldNames(fieldName: string) {
  if (fieldName === "state") return ["state", "status"];
  if (fieldName === "status") return ["status", "state"];
  return [fieldName];
}

function eventPathFirstSegment(path: string) {
  return path.split(".").filter(Boolean)[0] ?? "";
}

function isAbsoluteEventPath(path: string) {
  const firstSegment = eventPathFirstSegment(path);
  if (!firstSegment || firstSegment === path) return false;
  if (["metaData", "mateData", "runtimeData", "node", "nodeData", "bindNode", "boundNode", "boundProps", "boundData", "topology"].includes(firstSegment)) return true;
  if (props.topologyData?.nodes.some((node) => nodeMatchesRuleIdentity(node, firstSegment))) return true;
  if (props.topologyData?.dataSources?.some((source) => source.sourceId === firstSegment)) return true;
  return false;
}

function readBoundNodeLocalPath(bindNode: TopologyNode | undefined, normalizedPath: string) {
  if (!bindNode) return undefined;
  return readDefinedPath(bindNode as Record<string, unknown>, normalizedPath);
}

function readBoundNodeMappedPath(context: Record<string, unknown>, bindNode: TopologyNode | undefined, normalizedPath: string) {
  if (!bindNode) return undefined;

  const scopedValue = readDefinedPath(context, `${bindNode.key}.${normalizedPath}`);
  if (scopedValue !== undefined) return scopedValue;

  const sourceId = bindNode.dataBinding?.sourceId;
  if (!sourceId) return undefined;

  const mappedPath = bindNode.dataBinding?.mappings?.[normalizedPath];
  if (mappedPath) {
    const mappedValue = readDefinedPath(context, `${sourceId}.${normalizeExpressionPath(mappedPath)}`);
    if (mappedValue !== undefined) return mappedValue;
    const mappedDataValue = readDefinedPath(context, `${sourceId}.data.${normalizeExpressionPath(mappedPath)}`);
    if (mappedDataValue !== undefined) return mappedDataValue;
  }

  if (normalizedPath.includes(".")) {
    const sourceScopedValue = readDefinedPath(context, `${sourceId}.${normalizedPath}`);
    if (sourceScopedValue !== undefined) return sourceScopedValue;
  } else {
    const dataKey = preferredNodeDataKey(bindNode);
    const fieldNames = runtimeFieldNames(normalizedPath);

    if (dataKey) {
      for (const fieldName of fieldNames) {
        const sourceDataValue = readDefinedPath(context, `${sourceId}.data.${dataKey}.${fieldName}`);
        if (sourceDataValue !== undefined) return sourceDataValue;
      }
    }

    for (const key of nodeDataKeys(bindNode)) {
      for (const fieldName of fieldNames) {
        const nodeDataValue = readDefinedPath(context, `${sourceId}.data.${key}.${fieldName}`);
        if (nodeDataValue !== undefined) return nodeDataValue;
        const sourceNodeValue = readDefinedPath(context, `${sourceId}.${key}.${fieldName}`);
        if (sourceNodeValue !== undefined) return sourceNodeValue;
      }
    }

    for (const fieldName of fieldNames) {
      const dataFieldValue = readDefinedPath(context, `${sourceId}.data.${fieldName}`);
      if (dataFieldValue !== undefined) return dataFieldValue;
      const sourceFieldValue = readDefinedPath(context, `${sourceId}.${fieldName}`);
      if (sourceFieldValue !== undefined) return sourceFieldValue;
    }
  }

  return readDefinedPath(context, `${sourceId}.data.${normalizedPath}`)
    ?? readDefinedPath(context, `${sourceId}.${normalizedPath}`);
}

function resolveBoundDataPath(context: Record<string, unknown>, bindNode: TopologyNode | undefined, bindDataPath?: string) {
  if (!bindDataPath) return undefined;
  const normalizedPath = normalizeExpressionPath(bindDataPath);
  if (!normalizedPath) return undefined;
  const firstSegment = eventPathFirstSegment(normalizedPath);

  if (firstSegment === "props" || firstSegment === "runtime") {
    const localValue = readBoundNodeLocalPath(bindNode, normalizedPath);
    if (localValue !== undefined) return localValue;
  }

  if (isAbsoluteEventPath(normalizedPath)) {
    const absoluteValue = readDefinedPath(context, normalizedPath);
    if (absoluteValue !== undefined) return absoluteValue;
  }

  const mappedValue = readBoundNodeMappedPath(context, bindNode, normalizedPath);
  if (mappedValue !== undefined) return mappedValue;

  const contextValue = readDefinedPath(context, normalizedPath);
  if (contextValue !== undefined) return contextValue;

  return readBoundNodeLocalPath(bindNode, normalizedPath);
}

function eventConfigsForTrigger(node: DiagramNodeData, trigger: NodeEventConfig["trigger"]) {
  return (node.eventConfig ?? []).filter((config) => {
    const normalizedTrigger = config.trigger || (config as NodeEventConfig & { event?: NodeEventConfig["trigger"] }).event;
    return config.enabled !== false && normalizedTrigger === trigger && config.eventName && config.eventKey;
  });
}

function hasConfiguredNodeEvents(node: DiagramNodeData) {
  return eventConfigsForTrigger(node, "click").length > 0
    || eventConfigsForTrigger(node, "doubleClick").length > 0
    || eventConfigsForTrigger(node, "contextMenu").length > 0;
}

function hasConfiguredNodeEventForTrigger(node: DiagramNodeData, trigger: NodeEventConfig["trigger"]) {
  return eventConfigsForTrigger(node, trigger).length > 0;
}

function resolveNodeCursor(node: DiagramNodeData) {
  if (props.mode !== "runtime") return "";
  return hasConfiguredNodeEvents(node) ? "pointer" : "";
}

function buildEventContext(node: DiagramNodeData, config: NodeEventConfig) {
  const bindNode = config.bindNodeKey
    ? props.topologyData?.nodes.find((item) => item.key === config.bindNodeKey)
    : undefined;
  const context = {
    ...(props.eventContext ?? {}),
    node,
    nodeData: node,
    props: node.props ?? {},
    runtime: node.runtime ?? {},
    bindNode,
    boundNode: bindNode,
    boundProps: bindNode?.props ?? {},
    topology: props.topologyData
  };
  const boundData = resolveBoundDataPath(context, bindNode, config.bindDataPath);

  return {
    ...context,
    boundData
  };
}

function resolveNodeEventData(node: DiagramNodeData, config: NodeEventConfig) {
  const context = buildEventContext(node, config);
  const staticData = isRecord(config.eventData) ? config.eventData : {};
  const templateData = isRecord(config.eventDataTemplate)
    ? resolveExpressionValue(config.eventDataTemplate, context)
    : {};
  const boundData = context.boundData;
  const bindNode = context.bindNode;

  return {
    ...staticData,
    ...(isRecord(templateData) ? templateData : {}),
    ...(bindNode ? { boundProps: context.boundProps } : {}),
    ...(boundData !== undefined ? { boundData } : {})
  };
}

function emitConfiguredNodeEvents(node: DiagramNodeData, trigger: NodeEventConfig["trigger"]) {
  for (const config of eventConfigsForTrigger(node, trigger)) {
    emit("event", {
      type: "NODE_EVENT",
      mode: props.mode,
      trigger,
      eventName: config.eventName,
      eventKey: config.eventKey,
      nodeKey: node.key,
      nodeType: node.typeId,
      nodeData: node,
      bindNodeKey: config.bindNodeKey,
      data: resolveNodeEventData(node, config)
    });
  }
}

function undo() {
  diagram?.commandHandler.undo();
}

function redo() {
  diagram?.commandHandler.redo();
}

function deleteSelection() {
  if (props.mode !== "edit") return;
  diagram?.commandHandler.deleteSelection();
}

function getCanvasBounds() {
  const go = getGo();
  const canvas = normalizeCanvasConfig(props.topologyData?.canvas);
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  return new go.Rect(0, 0, canvas.width, canvas.height);
}

function fitDiagramToBounds(bounds: GoJS.Rect, padding = props.fitPadding ?? 80) {
  if (!diagram) return false;
  const go = getGo();
  const viewportWidth = diagram.div?.clientWidth ?? 0;
  const viewportHeight = diagram.div?.clientHeight ?? 0;
  if (
    !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || bounds.width <= 0
    || bounds.height <= 0
    || viewportWidth <= 0
    || viewportHeight <= 0
  ) return false;

  const maxScale = props.fitMaxScale ?? 1;
  const scale = Math.min(
    maxScale,
    Math.max(0.2, Math.min(
      Math.max(1, viewportWidth - padding) / bounds.width,
      Math.max(1, viewportHeight - padding) / bounds.height
    ))
  );
  diagram.scale = scale;
  diagram.position = new go.Point(
    bounds.x - padding / 2 / scale,
    bounds.y - padding / 2 / scale
  );
  overview?.requestUpdate();
  overview?.redraw();
  updateOverviewViewportBoxVisibility();
  return true;
}

function fitView() {
  if (!diagram) return;
  const bounds = getCanvasBounds();
  if (bounds && fitDiagramToBounds(bounds)) return;
  diagram.commandHandler.zoomToFit();
}

function resolveCanvasBoundaryFill() {
  if (props.editorBackgroundTheme) return EDITOR_BACKGROUND_COLORS[props.editorBackgroundTheme];
  if (props.mode === "edit") return EDITOR_BACKGROUND_COLORS.light;
  return "rgba(255, 255, 255, 0.56)";
}

function shouldShowCanvasBoundary() {
  return props.showCanvasBoundary !== false;
}

function shouldAutoFitRuntimeView() {
  return props.mode === "runtime" && props.autoFit !== false;
}

function updateWheelBehavior() {
  if (!diagram) return;
  const go = getGo();
  diagram.toolManager.mouseWheelBehavior = props.enableWheelZoom === false
    ? go.ToolManager.WheelNone
    : go.ToolManager.WheelZoom;
}

function pickCandidateKind(part: GoJS.Part): PickCandidate["kind"] {
  const go = getGo();
  if (part instanceof go.Link) return "link";
  if (part.data?.isGroup) return "group";
  return "node";
}

function pickCandidateLabel(part: GoJS.Part) {
  const go = getGo();
  if (part instanceof go.Link) {
    const from = props.topologyData?.nodes.find((node) => node.key === part.data?.from)?.label ?? part.data?.from;
    const to = props.topologyData?.nodes.find((node) => node.key === part.data?.to)?.label ?? part.data?.to;
    return part.data?.label || `${from} -> ${to}`;
  }
  return part.data?.label || part.data?.key || "";
}

function collectPickCandidates(point: GoJS.Point): PickCandidate[] {
  if (!diagram || props.mode !== "edit") return [];
  const go = getGo();
  const candidates: PickCandidate[] = [];
  const visited = new Set<string>();
  const parts = diagram.findPartsAt(point, true);

  parts.each((part: GoJS.Part) => {
    if (!(part instanceof go.Node) && !(part instanceof go.Link)) return;
    const key = part.data?.key;
    if (!key || visited.has(key) || !part.selectable || !part.visible) return;
    visited.add(key);
    candidates.push({
      key,
      label: pickCandidateLabel(part),
      kind: pickCandidateKind(part),
      zOrder: Number.isFinite(part.zOrder) ? Number(part.zOrder) : Number(part.data?.zOrder) || 0,
      part
    });
  });

  return candidates.sort((left, right) => {
    const zDelta = right.zOrder - left.zOrder;
    if (zDelta) return zDelta;
    const kindDelta = ["node", "group", "link"].indexOf(left.kind) - ["node", "group", "link"].indexOf(right.kind);
    return kindDelta || left.key.localeCompare(right.key);
  });
}

function pointCycleKey(point: GoJS.Point) {
  return `${Math.round(point.x)}:${Math.round(point.y)}`;
}

function samePickKeys(left: string[], right: string[]) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function selectPickCandidate(candidate: PickCandidate) {
  if (!diagram) return;
  pickMenu.value = null;
  diagram.select(candidate.part);
  emit("selectionChange", candidate.key);
  refreshPortVisibility();
}

function cyclePickCandidate(input: GoJS.InputEvent) {
  if (!diagram || props.mode !== "edit") return false;
  const candidates = collectPickCandidates(input.documentPoint);
  if (candidates.length <= 1) return false;

  const keys = candidates.map((candidate) => candidate.key);
  const pointKey = pointCycleKey(input.documentPoint);
  const selectedPart = diagram.selection.first();
  const selectedKey = selectedPart?.data?.key ?? props.selectedKey ?? "";
  const shouldStartNewCycle = !lastPickCycle
    || lastPickCycle.pointKey !== pointKey
    || !samePickKeys(lastPickCycle.keys, keys);

  if (shouldStartNewCycle) {
    const currentIndex = keys.indexOf(selectedKey);
    lastPickCycle = {
      pointKey,
      keys,
      index: currentIndex >= 0 ? (currentIndex + 1) % keys.length : 0
    };
  } else {
    lastPickCycle.index = (lastPickCycle.index + 1) % keys.length;
  }

  selectPickCandidate(candidates[lastPickCycle.index]);
  return true;
}

function openPickMenu(input: GoJS.InputEvent) {
  if (!diagram || props.mode !== "edit" || !canvasEl.value) return false;
  const candidates = collectPickCandidates(input.documentPoint);
  if (candidates.length <= 1) return false;
  const viewPoint = input.viewPoint;
  const rect = canvasEl.value.getBoundingClientRect();
  pickMenu.value = {
    visible: true,
    x: clampNumber(viewPoint.x, 8, Math.max(8, rect.width - 320)),
    y: clampNumber(viewPoint.y, 8, Math.max(8, rect.height - 260)),
    candidates
  };
  return true;
}

function closePickMenu() {
  pickMenu.value = null;
}

function isMiniViewCorner(value: unknown): value is MiniViewCorner {
  return value === "top-left"
    || value === "top-right"
    || value === "bottom-left"
    || value === "bottom-right";
}

function loadMiniViewState() {
  try {
    const rawValue = window.localStorage.getItem(MINI_VIEW_STORAGE_KEY);
    if (!rawValue) return;
    const value = JSON.parse(rawValue) as { corner?: unknown; collapsed?: unknown };
    if (isMiniViewCorner(value.corner)) miniViewCorner.value = value.corner;
    if (typeof value.collapsed === "boolean") miniViewCollapsed.value = value.collapsed;
  } catch {
    // Ignore stale localStorage values and keep the default corner.
  }
}

function saveMiniViewState() {
  try {
    window.localStorage.setItem(MINI_VIEW_STORAGE_KEY, JSON.stringify({
      corner: miniViewCorner.value,
      collapsed: miniViewCollapsed.value
    }));
  } catch {
    // Storage can be unavailable in private modes; the panel still works.
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function clampMiniViewPanelPosition(left: number, top: number) {
  const containerRect = canvasEl.value?.getBoundingClientRect();
  const miniViewRect = miniViewEl.value?.getBoundingClientRect();
  if (!containerRect || !miniViewRect) return { left, top };

  return {
    left: clampNumber(left, MINI_VIEW_MARGIN, containerRect.width - miniViewRect.width - MINI_VIEW_MARGIN),
    top: clampNumber(top, MINI_VIEW_MARGIN, containerRect.height - miniViewRect.height - MINI_VIEW_MARGIN)
  };
}

function getNearestMiniViewCorner(position: { left: number; top: number }): MiniViewCorner {
  const containerRect = canvasEl.value?.getBoundingClientRect();
  const miniViewRect = miniViewEl.value?.getBoundingClientRect();
  if (!containerRect || !miniViewRect) return miniViewCorner.value;

  const centerX = position.left + miniViewRect.width / 2;
  const centerY = position.top + miniViewRect.height / 2;
  const vertical = centerY < containerRect.height / 2 ? "top" : "bottom";
  const horizontal = centerX < containerRect.width / 2 ? "left" : "right";
  return `${vertical}-${horizontal}` as MiniViewCorner;
}

function redrawOverviewSoon() {
  window.setTimeout(() => {
    overview?.requestUpdate();
    overview?.redraw();
    updateOverviewViewportBoxVisibility();
  }, 0);
}

function toggleMiniViewCollapsed() {
  miniViewCollapsed.value = !miniViewCollapsed.value;
  miniViewPanelPosition.value = null;
  saveMiniViewState();
  if (!miniViewCollapsed.value) redrawOverviewSoon();
}

function handleMiniViewPanelPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !miniViewEl.value || !canvasEl.value) return;

  const containerRect = canvasEl.value.getBoundingClientRect();
  const miniViewRect = miniViewEl.value.getBoundingClientRect();
  const startPosition = clampMiniViewPanelPosition(
    miniViewRect.left - containerRect.left,
    miniViewRect.top - containerRect.top
  );

  miniViewPanelPosition.value = startPosition;
  miniViewPanelDrag = {
    didMove: false,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLeft: startPosition.left,
    startTop: startPosition.top
  };

  miniViewEl.value.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function handleMiniViewPanelPointerMove(event: PointerEvent) {
  if (!miniViewPanelDrag || event.pointerId !== miniViewPanelDrag.pointerId) return;

  const deltaX = event.clientX - miniViewPanelDrag.startClientX;
  const deltaY = event.clientY - miniViewPanelDrag.startClientY;
  if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) miniViewPanelDrag.didMove = true;
  miniViewPanelPosition.value = clampMiniViewPanelPosition(
    miniViewPanelDrag.startLeft + deltaX,
    miniViewPanelDrag.startTop + deltaY
  );

  event.preventDefault();
  event.stopPropagation();
}

function handleMiniViewPanelPointerEnd(event: PointerEvent) {
  if (!miniViewEl.value || !miniViewPanelDrag || event.pointerId !== miniViewPanelDrag.pointerId) return;

  if (miniViewEl.value.hasPointerCapture(event.pointerId)) miniViewEl.value.releasePointerCapture(event.pointerId);
  const finalPosition = miniViewPanelPosition.value;
  if (finalPosition && miniViewPanelDrag.didMove) {
    miniViewCorner.value = getNearestMiniViewCorner(finalPosition);
    saveMiniViewState();
  }
  miniViewPanelPosition.value = null;
  miniViewPanelDrag = null;

  event.preventDefault();
  event.stopPropagation();
}

function overviewDocumentPointFromPointer(event: PointerEvent) {
  if (!overview || !overviewEl.value) return null;
  const go = getGo();
  const rect = overviewEl.value.getBoundingClientRect();
  return overview.transformViewToDoc(new go.Point(
    event.clientX - rect.left,
    event.clientY - rect.top
  ));
}

function handleOverviewPointerDown(event: PointerEvent) {
  if (!diagram || !overview || !overviewEl.value || event.button !== 0) return;
  const documentPoint = overviewDocumentPointFromPointer(event);
  if (!documentPoint) return;

  miniViewDrag = {
    didMove: false,
    pointerId: event.pointerId,
    startDocumentPoint: documentPoint.copy(),
    startPosition: diagram.position.copy()
  };
  overviewEl.value.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function handleOverviewPointerMove(event: PointerEvent) {
  if (!diagram || !miniViewDrag || event.pointerId !== miniViewDrag.pointerId) return;
  const documentPoint = overviewDocumentPointFromPointer(event);
  if (!documentPoint) return;

  const go = getGo();
  const deltaX = documentPoint.x - miniViewDrag.startDocumentPoint.x;
  const deltaY = documentPoint.y - miniViewDrag.startDocumentPoint.y;
  if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) miniViewDrag.didMove = true;

  diagram.position = new go.Point(
    miniViewDrag.startPosition.x + deltaX,
    miniViewDrag.startPosition.y + deltaY
  );
  overview?.requestUpdate();
  event.preventDefault();
  event.stopPropagation();
}

function handleOverviewPointerEnd(event: PointerEvent) {
  if (!diagram || !overviewEl.value || !miniViewDrag || event.pointerId !== miniViewDrag.pointerId) return;
  const dragState = miniViewDrag;
  miniViewDrag = null;
  if (overviewEl.value.hasPointerCapture(event.pointerId)) overviewEl.value.releasePointerCapture(event.pointerId);

  const documentPoint = overviewDocumentPointFromPointer(event);
  if (documentPoint && !dragState.didMove) {
    const go = getGo();
    const viewportBounds = diagram.viewportBounds;
    diagram.position = new go.Point(
      documentPoint.x - viewportBounds.width / 2,
      documentPoint.y - viewportBounds.height / 2
    );
  }
  overview?.requestUpdate();
  event.preventDefault();
  event.stopPropagation();
}

function isRealRect(rect: GoJS.Rect) {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function updateOverviewViewportBoxVisibility() {
  if (!diagram || !overview?.box) return;
  const documentBounds = diagram.documentBounds;
  const viewportBounds = diagram.viewportBounds;
  if (!isRealRect(documentBounds) || !isRealRect(viewportBounds)) return;

  const tolerance = 1 / Math.max(diagram.scale, 0.01);
  const topologyFitsViewport = documentBounds.x >= viewportBounds.x - tolerance
    && documentBounds.y >= viewportBounds.y - tolerance
    && documentBounds.right <= viewportBounds.right + tolerance
    && documentBounds.bottom <= viewportBounds.bottom + tolerance;
  overview.box.visible = !topologyFitsViewport;
  overview.box.pickable = !topologyFitsViewport;
  overview.box.selectable = !topologyFitsViewport;
  const viewportBox = overview.box.findObject(OVERVIEW_VIEWPORT_BOX_NAME);
  if (viewportBox) viewportBox.visible = !topologyFitsViewport;
  overview.requestUpdate();
}

function updateCanvasBoundary() {
  if (!diagram) return;
  if (!shouldShowCanvasBoundary()) {
    if (canvasBoundaryPart) canvasBoundaryPart.visible = false;
    diagram.requestUpdate();
    overview?.requestUpdate();
    overview?.redraw();
    return;
  }
  const go = getGo();
  const $ = go.GraphObject.make;
  const canvas = normalizeCanvasConfig(props.topologyData?.canvas);
  const fill = resolveCanvasBoundaryFill();

  if (!canvasBoundaryPart) {
    canvasBoundaryPart =
      $(go.Part, "Spot",
        {
          layerName: "Background",
          location: new go.Point(0, 0),
          locationSpot: go.Spot.TopLeft,
          pickable: false,
          selectable: false,
          isLayoutPositioned: false
        },
        $(go.Shape, "Rectangle", {
          name: CANVAS_BOUNDARY_SHAPE_NAME,
          desiredSize: new go.Size(canvas.width, canvas.height),
          fill,
          stroke: "#94a3b8",
          strokeDashArray: [10, 6],
          strokeWidth: 1.5
        })
      ) as GoJS.Part;
    diagram.add(canvasBoundaryPart);
  }

  const boundaryShape = canvasBoundaryPart.findObject(CANVAS_BOUNDARY_SHAPE_NAME) as GoJS.Shape | null;
  if (boundaryShape) {
    boundaryShape.desiredSize = new go.Size(canvas.width, canvas.height);
    boundaryShape.fill = fill;
  }
  canvasBoundaryPart.location = new go.Point(0, 0);
  canvasBoundaryPart.visible = true;
  diagram.requestUpdate();
  overview?.requestUpdate();
  overview?.redraw();
}

function fitRuntimeView() {
  if (!diagram) return;
  const canvasBounds = getCanvasBounds();
  if (canvasBounds && fitDiagramToBounds(canvasBounds)) return;
  fitDiagramToBounds(diagram.documentBounds);
}

function exportSvg() {
  if (!diagram) return;
  const svg = diagram.makeSvg({ background: "#eef1f5", scale: 1 });
  if (!svg) return;
  const text = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${props.topologyData?.id ?? "topology"}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function snapPointToGrid(point: GoJS.Point) {
  return point.copy().snapToGrid(0, 0, SNAP_GRID_SIZE, SNAP_GRID_SIZE);
}

function createDiagram(el: HTMLDivElement) {
  const go = getGo();
  const $ = go.GraphObject.make;

  class SnapOrthogonalLinkReshapingTool extends go.LinkReshapingTool {
    private alreadyAddedPoint = false;

    override computeReshape(point: GoJS.Point) {
      return super.computeReshape(snapPointToGrid(point));
    }

    override makeAdornment(pathshape: GoJS.Shape) {
      const link = pathshape.part as GoJS.Link | null;
      const adornment = super.makeAdornment(pathshape);

      if (link && adornment && link.isOrthogonal && link.curve !== go.Link.Bezier) {
        const firstIndex = link.firstPickIndex + (link.resegmentable ? 0 : 1);
        const lastIndex = link.lastPickIndex - (link.resegmentable ? 0 : 1);
        for (let index = firstIndex; index < lastIndex; index += 1) {
          this.makeSegmentDragHandle(link, adornment, index);
        }
      }

      return adornment;
    }

    override doDeactivate() {
      this.alreadyAddedPoint = false;
      const link = this.adornedLink;
      if (link && link.isOrthogonal && link.curve !== go.Link.Bezier) {
        const pathshape = link.path;
        if (pathshape) {
          const adornment = this.makeAdornment(pathshape);
          if (adornment) {
            link.addAdornment(this.name, adornment);
            adornment.location = link.position;
          }
        }
      }
      super.doDeactivate();
    }

    override reshape(newPoint: GoJS.Point) {
      const link = this.adornedLink;
      const segmentHandle = this.handle as GoJS.Shape | null;

      if (link && link.isOrthogonal && link.curve !== go.Link.Bezier && segmentHandle?.toMaxLinks === 999) {
        link.startRoute();
        let index = segmentHandle.segmentIndex;

        if (!this.alreadyAddedPoint && link.resegmentable) {
          this.alreadyAddedPoint = true;
          if (index === link.firstPickIndex) {
            link.insertPoint(index, link.getPoint(index).copy());
            index += 1;
            segmentHandle.segmentIndex = index;
          } else if (index === link.lastPickIndex - 1) {
            link.insertPoint(index, link.getPoint(index).copy());
            if (index - 1 === link.firstPickIndex + 1) segmentHandle.segmentIndex = index - 1;
          }
        }

        const behavior = this.getReshapingBehavior(segmentHandle);
        if (behavior === go.LinkReshapingTool.Vertical) {
          link.setPointAt(index, link.getPoint(index - 1).x, newPoint.y);
          link.setPointAt(index + 1, link.getPoint(index + 2).x, newPoint.y);
        } else if (behavior === go.LinkReshapingTool.Horizontal) {
          link.setPointAt(index, newPoint.x, link.getPoint(index - 1).y);
          link.setPointAt(index + 1, newPoint.x, link.getPoint(index + 2).y);
        }

        link.commitRoute();
        return;
      }

      super.reshape(newPoint);
    }

    makeSegmentDragHandle(link: GoJS.Link, adornment: GoJS.Adornment, index: number) {
      const a = link.getPoint(index);
      let b = link.getPoint(index + 1);
      const segmentLength = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      let orientation = "";

      if (this.isApprox(a.x, b.x) && this.isApprox(a.y, b.y)) {
        b = link.getPoint(index - 1);
        if (this.isApprox(a.x, b.x)) orientation = "vertical";
        else if (this.isApprox(a.y, b.y)) orientation = "horizontal";
      } else if (this.isApprox(a.x, b.x)) {
        orientation = "vertical";
      } else if (this.isApprox(a.y, b.y)) {
        orientation = "horizontal";
      }

      const handle = new go.Shape();
      handle.strokeWidth = 8;
      handle.opacity = 0;
      handle.segmentOrientation = go.Link.OrientAlong;
      handle.segmentIndex = index;
      handle.segmentFraction = 0.5;
      handle.toMaxLinks = 999;

      if (orientation === "horizontal") {
        this.setReshapingBehavior(handle, go.LinkReshapingTool.Vertical);
        handle.cursor = "n-resize";
      } else {
        this.setReshapingBehavior(handle, go.LinkReshapingTool.Horizontal);
        handle.cursor = "w-resize";
      }

      handle.geometryString = `M 0 0 L ${segmentLength} 0`;
      adornment.insertAt(0, handle);
    }

    isApprox(x: number, y: number) {
      const delta = x - y;
      return delta < 0.5 && delta > -0.5;
    }
  }

  class PortAwareLinkingTool extends go.LinkingTool {
    override doActivate() {
      super.doActivate();
      refreshPortVisibility();
    }

    override doDeactivate() {
      super.doDeactivate();
      refreshPortVisibility();
      updateCanvasBoundary();
    }
  }

  class PortAwareRelinkingTool extends go.RelinkingTool {
    override doActivate() {
      super.doActivate();
      refreshPortVisibility();
    }

    override doDeactivate() {
      super.doDeactivate();
      refreshPortVisibility();
      updateCanvasBoundary();
    }
  }

  class AlignmentGuideDraggingTool extends go.DraggingTool {
    private guideParts: GoJS.Part[] = [];
    private readonly axisTolerance = 6;
    private readonly alignmentEpsilon = 0.5;

    override doActivate() {
      super.doActivate();
      this.updateCenterGuides();
    }

    override doMouseMove() {
      super.doMouseMove();
      this.updateCenterGuides(true);
    }

    override doDropOnto(point: GoJS.Point, object: GoJS.GraphObject) {
      this.snapActivePartsToElements();
      super.doDropOnto(point, object);
    }

    override doDeactivate() {
      this.clearCenterGuides();
      super.doDeactivate();
    }

    private clearCenterGuides() {
      const targetDiagram = this.diagram;
      if (!targetDiagram || !this.guideParts.length) return;
      this.guideParts.forEach((part) => targetDiagram.remove(part));
      this.guideParts = [];
    }

    private getBodyBounds(node: GoJS.Node) {
      const body = node.findObject("BODY") ?? node.findObject("ROTATE_PANEL");
      const bounds = body?.getDocumentBounds?.() ?? node.actualBounds;
      return isRealRect(bounds) ? bounds : null;
    }

    private getBoundsCenter(bounds: GoJS.Rect) {
      return new go.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }

    private getActiveDraggingParts(targetDiagram: GoJS.Diagram) {
      const parts = new go.Set();
      const draggingParts = this.copiedParts ?? this.draggedParts;

      if (draggingParts) {
        const iterator = draggingParts.iterator;
        while (iterator.next()) parts.add(iterator.key);
      } else {
        targetDiagram.selection.each((part) => parts.add(part));
      }

      return parts;
    }

    private getActiveNodes(targetDiagram: GoJS.Diagram, activeParts: GoJS.Set) {
      const nodes: GoJS.Node[] = [];
      activeParts.each((part) => {
        if (part instanceof go.Node && part.visible && this.getBodyBounds(part)) nodes.push(part);
      });
      return nodes;
    }

    private getCombinedBounds(nodes: GoJS.Node[]) {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;

      nodes.forEach((node) => {
        const bounds = this.getBodyBounds(node);
        if (!bounds) return;
        left = Math.min(left, bounds.x);
        top = Math.min(top, bounds.y);
        right = Math.max(right, bounds.right);
        bottom = Math.max(bottom, bounds.bottom);
      });

      if (![left, top, right, bottom].every(Number.isFinite)) return null;
      return new go.Rect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
    }

    private getReferenceBounds(targetDiagram: GoJS.Diagram, excludedNodes: Set<GoJS.Node>) {
      const references: GoJS.Rect[] = [];
      targetDiagram.nodes.each((node) => {
        if (!(node instanceof go.Node) || excludedNodes.has(node) || node.isSelected || !node.visible) return;
        const bounds = this.getBodyBounds(node);
        if (bounds) references.push(bounds);
      });
      return references;
    }

    private findBestAxisSnap(currentBounds: GoJS.Rect, references: GoJS.Rect[], axis: "x" | "y") {
      const startKey = axis === "x" ? "x" : "y";
      const sizeKey = axis === "x" ? "width" : "height";
      const currentStart = currentBounds[startKey];
      const currentCenter = currentStart + currentBounds[sizeKey] / 2;
      const currentEnd = currentStart + currentBounds[sizeKey];
      let best: { distance: number; delta: number; priority: number } | null = null;

      const consider = (currentValue: number, referenceValue: number, priority: number) => {
        const delta = referenceValue - currentValue;
        const distance = Math.abs(delta);
        if (distance > this.axisTolerance) return;
        if (!best || distance < best.distance || (distance === best.distance && priority < best.priority)) {
          best = { distance, delta, priority };
        }
      };

      references.forEach((bounds) => {
        const referenceStart = bounds[startKey];
        const referenceCenter = referenceStart + bounds[sizeKey] / 2;
        const referenceEnd = referenceStart + bounds[sizeKey];

        consider(currentCenter, referenceCenter, 0);
        consider(currentStart, referenceStart, 1);
        consider(currentEnd, referenceEnd, 1);
        consider(currentStart, referenceEnd, 2);
        consider(currentEnd, referenceStart, 2);
      });

      return best?.delta ?? 0;
    }

    private snapActivePartsToElements() {
      const targetDiagram = this.diagram;
      if (!targetDiagram || props.mode !== "edit") return null;

      const activeParts = this.getActiveDraggingParts(targetDiagram);
      const activeNodes = this.getActiveNodes(targetDiagram, activeParts);
      const currentBounds = this.getCombinedBounds(activeNodes);
      if (!currentBounds) return null;

      const excludedNodes = new Set(activeNodes);
      const references = this.getReferenceBounds(targetDiagram, excludedNodes);
      const deltaX = this.findBestAxisSnap(currentBounds, references, "x");
      const deltaY = this.findBestAxisSnap(currentBounds, references, "y");

      if (deltaX || deltaY) {
        const snapOptions = new go.DraggingOptions();
        targetDiagram.moveParts(activeParts, new go.Point(deltaX, deltaY), true, snapOptions);
      }

      return {
        activeNodes,
        bounds: this.getCombinedBounds(activeNodes),
        excludedNodes,
        references
      };
    }

    private collectLocalAlignmentGuides(currentBounds: GoJS.Rect, references: GoJS.Rect[]) {
      const guides = new Map<string, { orientation: "horizontal" | "vertical"; coordinate: number; start: number; end: number }>();

      const addGuide = (orientation: "horizontal" | "vertical", coordinate: number, start: number, end: number) => {
        const key = `${orientation}:${coordinate.toFixed(1)}`;
        const existing = guides.get(key);
        if (existing) {
          existing.start = Math.min(existing.start, start);
          existing.end = Math.max(existing.end, end);
          return;
        }
        guides.set(key, { orientation, coordinate, start, end });
      };

      const isAligned = (first: number, second: number) => Math.abs(first - second) <= this.alignmentEpsilon;
      const currentX = [currentBounds.x, currentBounds.x + currentBounds.width / 2, currentBounds.right];
      const currentY = [currentBounds.y, currentBounds.y + currentBounds.height / 2, currentBounds.bottom];

      references.forEach((bounds) => {
        const referenceX = [bounds.x, bounds.x + bounds.width / 2, bounds.right];
        const referenceY = [bounds.y, bounds.y + bounds.height / 2, bounds.bottom];
        const verticalStart = Math.min(currentBounds.y, bounds.y) - 8;
        const verticalEnd = Math.max(currentBounds.bottom, bounds.bottom) + 8;
        const horizontalStart = Math.min(currentBounds.x, bounds.x) - 8;
        const horizontalEnd = Math.max(currentBounds.right, bounds.right) + 8;

        if (isAligned(currentX[1], referenceX[1])) {
          addGuide("vertical", referenceX[1], verticalStart, verticalEnd);
        }
        [[0, 0], [0, 2], [2, 0], [2, 2]].forEach(([currentIndex, referenceIndex]) => {
          if (isAligned(currentX[currentIndex], referenceX[referenceIndex])) {
            addGuide("vertical", referenceX[referenceIndex], verticalStart, verticalEnd);
          }
        });

        if (isAligned(currentY[1], referenceY[1])) {
          addGuide("horizontal", referenceY[1], horizontalStart, horizontalEnd);
        }
        [[0, 0], [0, 2], [2, 0], [2, 2]].forEach(([currentIndex, referenceIndex]) => {
          if (isAligned(currentY[currentIndex], referenceY[referenceIndex])) {
            addGuide("horizontal", referenceY[referenceIndex], horizontalStart, horizontalEnd);
          }
        });
      });

      return [...guides.values()];
    }

    private addLocalAlignmentGuides(targetDiagram: GoJS.Diagram, currentBounds: GoJS.Rect, references: GoJS.Rect[]) {
      this.collectLocalAlignmentGuides(currentBounds, references).forEach((guide) => {
        const isHorizontal = guide.orientation === "horizontal";
        const start = isHorizontal
          ? new go.Point(guide.start, guide.coordinate)
          : new go.Point(guide.coordinate, guide.start);
        const length = Math.max(1, guide.end - guide.start);
        const geometryString = isHorizontal ? `M 0 0 L ${length} 0` : `M 0 0 L 0 ${length}`;

        this.addGuidePart(targetDiagram,
          $(go.Part,
            {
              isInDocumentBounds: false,
              layerName: "Tool",
              location: start,
              pickable: false,
              selectable: false
            },
            $(go.Shape, {
              geometryString,
              stroke: "#ec4899",
              strokeWidth: 1.8
            })
          ) as GoJS.Part
        );
      });
    }

    private isHorizontalCandidate(centerY: number, bounds: GoJS.Rect) {
      return centerY >= bounds.y - this.axisTolerance && centerY <= bounds.bottom + this.axisTolerance;
    }

    private isVerticalCandidate(centerX: number, bounds: GoJS.Rect) {
      return centerX >= bounds.x - this.axisTolerance && centerX <= bounds.right + this.axisTolerance;
    }

    private collectNearestGuides(targetDiagram: GoJS.Diagram, excludedNodes: Set<GoJS.Node>, currentBounds: GoJS.Rect, center: GoJS.Point) {
      const nearest: Record<string, { distance: number; bounds: GoJS.Rect } | null> = {
        left: null,
        right: null,
        up: null,
        down: null
      };
      let hasHorizontalCenterHit = false;
      let hasVerticalCenterHit = false;

      targetDiagram.nodes.each((node) => {
        if (!(node instanceof go.Node) || excludedNodes.has(node) || node.isSelected || !node.visible) return;

        const bounds = this.getBodyBounds(node);
        if (!bounds) return;

        const otherCenter = this.getBoundsCenter(bounds);
        if (Math.abs(otherCenter.y - center.y) <= this.axisTolerance) hasHorizontalCenterHit = true;
        if (Math.abs(otherCenter.x - center.x) <= this.axisTolerance) hasVerticalCenterHit = true;

        if (this.isHorizontalCandidate(center.y, bounds)) {
          if (bounds.right <= currentBounds.x) {
            const distance = currentBounds.x - bounds.right;
            if (!nearest.left || distance < nearest.left.distance) nearest.left = { distance, bounds };
          } else if (bounds.x >= currentBounds.right) {
            const distance = bounds.x - currentBounds.right;
            if (!nearest.right || distance < nearest.right.distance) nearest.right = { distance, bounds };
          }
        }

        if (this.isVerticalCandidate(center.x, bounds)) {
          if (bounds.bottom <= currentBounds.y) {
            const distance = currentBounds.y - bounds.bottom;
            if (!nearest.up || distance < nearest.up.distance) nearest.up = { distance, bounds };
          } else if (bounds.y >= currentBounds.bottom) {
            const distance = bounds.y - currentBounds.bottom;
            if (!nearest.down || distance < nearest.down.distance) nearest.down = { distance, bounds };
          }
        }
      });

      return {
        nearest,
        hasHorizontalCenterHit,
        hasVerticalCenterHit
      };
    }

    private addGuidePart(targetDiagram: GoJS.Diagram, guidePart: GoJS.Part) {
      targetDiagram.add(guidePart);
      this.guideParts.push(guidePart);
    }

    private makeDistanceGuide(start: GoJS.Point, end: GoJS.Point, text: string, labelOffset: GoJS.Point) {
      const labelPoint = new go.Point(
        (start.x + end.x) / 2 + labelOffset.x,
        (start.y + end.y) / 2 + labelOffset.y
      );

      return [
        $(go.Part,
          {
            isInDocumentBounds: false,
            layerName: "Tool",
            location: start,
            pickable: false,
            selectable: false
          },
          $(go.Shape, {
            geometryString: `M 0 0 L ${end.x - start.x} ${end.y - start.y}`,
            stroke: "#0f766e",
            strokeDashArray: [3, 3],
            strokeWidth: 1.4
          })
        ) as GoJS.Part,
        $(go.Part, "Auto",
          {
            isInDocumentBounds: false,
            layerName: "Tool",
            location: labelPoint,
            locationSpot: go.Spot.Center,
            pickable: false,
            selectable: false
          },
          $(go.Shape, "RoundedRectangle", {
            fill: "rgba(240, 253, 250, 0.95)",
            stroke: "#0f766e",
            strokeWidth: 1,
            parameter1: 3
          }),
          $(go.TextBlock, text, {
            font: "11px sans-serif",
            margin: new go.Margin(2, 5, 2, 5),
            stroke: "#0f766e"
          })
        ) as GoJS.Part
      ];
    }

    private addDistanceGuides(targetDiagram: GoJS.Diagram, currentBounds: GoJS.Rect, center: GoJS.Point, nearest: Record<string, { distance: number; bounds: GoJS.Rect } | null>) {
      const roundedText = (distance: number) => `${roundPointValue(distance)}px`;

      if (nearest.left && nearest.left.distance >= 0) {
        this.makeDistanceGuide(
          new go.Point(nearest.left.bounds.right, center.y),
          new go.Point(currentBounds.x, center.y),
          roundedText(nearest.left.distance),
          new go.Point(0, -12)
        ).forEach((part) => this.addGuidePart(targetDiagram, part));
      }

      if (nearest.right && nearest.right.distance >= 0) {
        this.makeDistanceGuide(
          new go.Point(currentBounds.right, center.y),
          new go.Point(nearest.right.bounds.x, center.y),
          roundedText(nearest.right.distance),
          new go.Point(0, -12)
        ).forEach((part) => this.addGuidePart(targetDiagram, part));
      }

      if (nearest.up && nearest.up.distance >= 0) {
        this.makeDistanceGuide(
          new go.Point(center.x, nearest.up.bounds.bottom),
          new go.Point(center.x, currentBounds.y),
          roundedText(nearest.up.distance),
          new go.Point(18, 0)
        ).forEach((part) => this.addGuidePart(targetDiagram, part));
      }

      if (nearest.down && nearest.down.distance >= 0) {
        this.makeDistanceGuide(
          new go.Point(center.x, currentBounds.bottom),
          new go.Point(center.x, nearest.down.bounds.y),
          roundedText(nearest.down.distance),
          new go.Point(18, 0)
        ).forEach((part) => this.addGuidePart(targetDiagram, part));
      }
    }

    private updateCenterGuides(shouldSnap = false) {
      const targetDiagram = this.diagram;
      if (!targetDiagram || props.mode !== "edit") return;

      this.clearCenterGuides();

      const viewportBounds = targetDiagram.viewportBounds;
      if (!isRealRect(viewportBounds)) return;

      const snapResult = shouldSnap ? this.snapActivePartsToElements() : null;
      const activeParts = this.getActiveDraggingParts(targetDiagram);
      const activeNodes = snapResult?.activeNodes ?? this.getActiveNodes(targetDiagram, activeParts);
      const currentBounds = snapResult?.bounds ?? this.getCombinedBounds(activeNodes);
      if (!currentBounds) return;

      const excludedNodes = snapResult?.excludedNodes ?? new Set(activeNodes);
      const references = snapResult?.references ?? this.getReferenceBounds(targetDiagram, excludedNodes);

      const center = this.getBoundsCenter(currentBounds);
      if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return;
      const horizontalStartX = Math.min(viewportBounds.x, center.x);
      const verticalStartY = Math.min(viewportBounds.y, center.y);
      const horizontalLength = Math.max(1, viewportBounds.right - horizontalStartX);
      const verticalLength = Math.max(1, viewportBounds.bottom - verticalStartY);
      const { nearest, hasHorizontalCenterHit, hasVerticalCenterHit } = this.collectNearestGuides(targetDiagram, excludedNodes, currentBounds, center);

      const horizontalGuide =
        $(go.Part,
          {
            isInDocumentBounds: false,
            layerName: "Tool",
            location: new go.Point(horizontalStartX, center.y),
            pickable: false,
            selectable: false
          },
          $(go.Shape, {
            geometryString: `M 0 0 L ${horizontalLength} 0`,
            stroke: hasHorizontalCenterHit ? "#f59e0b" : "#2563eb",
            strokeDashArray: [6, 4],
            strokeWidth: hasHorizontalCenterHit ? 2.2 : 1.5
          })
        ) as GoJS.Part;

      const verticalGuide =
        $(go.Part,
          {
            isInDocumentBounds: false,
            layerName: "Tool",
            location: new go.Point(center.x, verticalStartY),
            pickable: false,
            selectable: false
          },
          $(go.Shape, {
            geometryString: `M 0 0 L 0 ${verticalLength}`,
            stroke: hasVerticalCenterHit ? "#f59e0b" : "#2563eb",
            strokeDashArray: [6, 4],
            strokeWidth: hasVerticalCenterHit ? 2.2 : 1.5
          })
        ) as GoJS.Part;

      const centerMarker =
        $(go.Part, "Spot",
          {
            isInDocumentBounds: false,
            layerName: "Tool",
            location: center,
            locationSpot: go.Spot.Center,
            pickable: false,
            selectable: false
          },
          $(go.Shape, "Circle", {
            desiredSize: new go.Size(7, 7),
            fill: "#ffffff",
            stroke: "#2563eb",
            strokeWidth: 1.5
          }),
          $(go.TextBlock, `x:${roundPointValue(center.x)} y:${roundPointValue(center.y)}`, {
            alignment: new go.Spot(1, 0, 8, -6),
            alignmentFocus: go.Spot.BottomLeft,
            background: "rgba(255, 255, 255, 0.92)",
            font: "11px sans-serif",
            margin: new go.Margin(2, 4, 2, 4),
            stroke: "#1d4ed8"
          })
        ) as GoJS.Part;

      [horizontalGuide, verticalGuide, centerMarker].forEach((guidePart) => {
        this.addGuidePart(targetDiagram, guidePart);
      });
      this.addLocalAlignmentGuides(targetDiagram, currentBounds, references);
      this.addDistanceGuides(targetDiagram, currentBounds, center, nearest);
    }
  }

  const keyboardNudgeDelta = (key: string | undefined) => {
    if (key === "Up" || key === "ArrowUp") return new go.Point(0, -1);
    if (key === "Down" || key === "ArrowDown") return new go.Point(0, 1);
    if (key === "Left" || key === "ArrowLeft") return new go.Point(-1, 0);
    if (key === "Right" || key === "ArrowRight") return new go.Point(1, 0);
    return null;
  };

  const isEditableKeyboardTarget = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    return tagName === "input"
      || tagName === "textarea"
      || tagName === "select"
      || target.isContentEditable
      || Boolean(target.closest("[contenteditable='true']"));
  };

  class KeyboardNudgeCommandHandler extends go.CommandHandler {
    override doKeyDown() {
      const targetDiagram = this.diagram;
      const input = targetDiagram.lastInput;
      const direction = keyboardNudgeDelta(input?.key);

      if (
        !direction
        || props.mode !== "edit"
        || targetDiagram.isReadOnly
        || input.control
        || input.meta
        || input.alt
        || isEditableKeyboardTarget(input.event?.target)
      ) {
        super.doKeyDown();
        return;
      }

      const movableParts = new go.Set();
      targetDiagram.selection.each((part) => {
        if (part instanceof go.Node && part.canMove()) movableParts.add(part);
      });

      if (!movableParts.count) {
        super.doKeyDown();
        return;
      }

      const step = input.shift ? KEYBOARD_BIG_NUDGE_STEP : KEYBOARD_NUDGE_STEP;
      const delta = new go.Point(direction.x * step, direction.y * step);
      const dragOptions = new go.DraggingOptions();
      try {
        targetDiagram.startTransaction("keyboard nudge selection");
        targetDiagram.moveParts(movableParts, delta, true, dragOptions);
        targetDiagram.commitTransaction("keyboard nudge selection");
      } catch (error) {
        targetDiagram.rollbackTransaction();
        throw error;
      }
      input.bubbles = false;
      input.event?.preventDefault?.();
    }
  }

  const finishDrop = (event: GoJS.InputEvent) => {
    if (props.mode !== "edit") return;
    const ok = event.diagram.commandHandler.addTopLevelParts(event.diagram.selection, true);
    if (!ok) event.diagram.currentTool.doCancel();
  };
  const next = $(go.Diagram, el, {
    "undoManager.isEnabled": true,
    "animationManager.isEnabled": true,
    // 大图初始淡入/缩放动画开销大且拖慢首屏，直接跳过
    "animationManager.initialAnimationStyle": go.AnimationManager.None,
    allowHorizontalScroll: true,
    allowVerticalScroll: true,
    "draggingTool.gridSnapCellSize": new go.Size(SNAP_GRID_SIZE, SNAP_GRID_SIZE),
    "draggingTool.gridSnapOrigin": new go.Point(0, 0),
    "draggingTool.isGridSnapEnabled": true,
    "resizingTool.cellSize": new go.Size(SNAP_GRID_SIZE, SNAP_GRID_SIZE),
    "resizingTool.isGridSnapEnabled": true,
    "rotatingTool.snapAngleMultiple": 15,
    "rotatingTool.snapAngleEpsilon": 7.5,
    "rotatingTool.handleAngle": ROTATE_HANDLE_ANGLE,
    "rotatingTool.handleDistance": ROTATE_HANDLE_DISTANCE,
    "dragSelectingTool.isEnabled": false,
    "panningTool.isEnabled": true,
    "toolManager.mouseWheelBehavior": props.enableWheelZoom === false ? go.ToolManager.WheelNone : go.ToolManager.WheelZoom,
    allowDrop: props.mode === "edit",
    allowResize: props.mode === "edit",
    contentAlignment: go.Spot.Center,
    initialAutoScale: go.Diagram.Uniform,
    initialContentAlignment: go.Spot.Center,
    allowSelect: props.mode === "edit",
    commandHandler: new KeyboardNudgeCommandHandler(),
    isReadOnly: props.mode === "runtime",
    mouseDrop: (event: GoJS.InputEvent) => finishDrop(event)
  }) as go.Diagram;

  next.grid =
    $(go.Panel, "Grid",
      {
        gridCellSize: new go.Size(VISIBLE_GRID_SIZE, VISIBLE_GRID_SIZE),
        gridOrigin: new go.Point(0, 0),
        visible: props.mode === "edit"
      },
      $(go.Shape, "LineH", { stroke: "#dbe3ee", strokeWidth: 0.5 }),
      $(go.Shape, "LineV", { stroke: "#dbe3ee", strokeWidth: 0.5 }),
      $(go.Shape, "LineH", { interval: 5, stroke: "#c8d3e0", strokeWidth: 0.7 }),
      $(go.Shape, "LineV", { interval: 5, stroke: "#c8d3e0", strokeWidth: 0.7 })
    );
  const draggingTool = new AlignmentGuideDraggingTool();
  draggingTool.gridSnapCellSize = new go.Size(SNAP_GRID_SIZE, SNAP_GRID_SIZE);
  draggingTool.gridSnapOrigin = new go.Point(0, 0);
  draggingTool.isGridSnapEnabled = true;
  next.toolManager.draggingTool = draggingTool;
  next.toolManager.linkReshapingTool = new SnapOrthogonalLinkReshapingTool();
  const linkingTool = new PortAwareLinkingTool();
  linkingTool.direction = go.LinkingTool.ForwardsOnly;
  linkingTool.portGravity = 32;
  next.toolManager.linkingTool = linkingTool;
  const relinkingTool = new PortAwareRelinkingTool();
  relinkingTool.isEnabled = true;
  relinkingTool.portGravity = 32;
  next.toolManager.relinkingTool = relinkingTool;

  const makeLinkSelectionAdornment = () =>
    $(go.Adornment, "Link",
      $(go.Shape,
        {
          isPanelMain: true,
          pickable: false,
          stroke: "transparent",
          strokeWidth: 1
        }
      ),
      $(go.Shape,
        {
          fromArrow: "Circle",
          fill: "#ffffff",
          pickable: false,
          scale: 0.7,
          stroke: "#2563eb",
          strokeWidth: 1.5
        }
      ),
      $(go.Shape,
        {
          toArrow: "Circle",
          fill: "#ffffff",
          pickable: false,
          scale: 0.7,
          stroke: "#2563eb",
          strokeWidth: 1.5
        }
      )
    );

  const startLinkFromAdornmentHandle = (event: GoJS.InputEvent, handle: GoJS.GraphObject) => {
    if (props.mode !== "edit") return;
    const targetDiagram = event.diagram;
    const adornment = handle.part;
    if (!(adornment instanceof go.Adornment)) return;
    const adornedPart = adornment.adornedPart;
    if (!(adornedPart instanceof go.Node)) return;
    // 动态 itemTemplate 的端口数据挂在父 Panel，Shape 自身没有 data。
    const portData = (handle.data ?? handle.panel?.data) as DiagramPortData | null | undefined;
    if (!portData?.id) return;

    targetDiagram.select(adornedPart);
    refreshPortVisibility();

    const visualPort = adornedPart.findPort(visualPortId(portData.id));
    const startPort = visualPort ?? adornedPart.findPort(portData.id);
    if (!startPort || !startPort.fromLinkable) return;

    const tool = targetDiagram.toolManager.linkingTool as GoJS.LinkingTool;
    tool.startObject = startPort;
    targetDiagram.currentTool = tool;
    tool.doActivate();

    event.handled = true;
    event.bubbles = false;
  };

  const makeAdornmentPortHandle = () =>
    $(go.Panel, "Spot",
      {
        alignmentFocus: go.Spot.Center,
        visible: true
      },
      new go.Binding("alignment", "", toGoAdornmentPortAlignment),
      new go.Binding("visible", "direction", canLinkFrom),
      $(go.Shape, "Circle",
        {
          cursor: "crosshair",
          desiredSize: new go.Size(ADORNMENT_PORT_HANDLE_SIZE, ADORNMENT_PORT_HANDLE_SIZE),
          fill: "#ffffff",
          isActionable: true,
          stroke: "#0f766e",
          strokeWidth: 1.5,
          toolTip:
            $("ToolTip",
              $(go.TextBlock,
                { margin: 6, font: "12px sans-serif" },
                new go.Binding("text", "", portTooltipText)
              )
            ),
          actionDown: (event: GoJS.InputEvent, handle: GoJS.GraphObject) => startLinkFromAdornmentHandle(event, handle)
        }
      )
    );

  const makeNodeSelectionAdornment = () =>
    $(go.Adornment, "Spot",
      {
        itemTemplate: makeAdornmentPortHandle()
      },
      new go.Binding("itemArray", "__ports"),
      $(go.Panel, "Auto",
        $(go.Shape, "Rectangle",
          {
            fill: null,
            pickable: false,
            stroke: "#2563eb",
            strokeWidth: 1
          }
        ),
        $(go.Placeholder, {
          padding: 0
        })
      )
    );

  const makeResizeHandle = (alignment: GoJS.Spot, cursor: string) =>
    $(go.Shape, "Rectangle",
      {
        alignment,
        cursor,
        desiredSize: new go.Size(RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE),
        fill: "#ffffff",
        stroke: "#2563eb",
        strokeWidth: 1.5
      }
    );

  const makeResizeAdornment = () =>
    $(go.Adornment, "Spot",
      $(go.Placeholder),
      makeResizeHandle(go.Spot.TopLeft, "nw-resize"),
      makeResizeHandle(go.Spot.Top, "n-resize"),
      makeResizeHandle(go.Spot.TopRight, "ne-resize"),
      makeResizeHandle(go.Spot.Right, "e-resize"),
      makeResizeHandle(go.Spot.BottomRight, "se-resize"),
      makeResizeHandle(go.Spot.Bottom, "s-resize"),
      makeResizeHandle(go.Spot.BottomLeft, "sw-resize"),
      makeResizeHandle(go.Spot.Left, "w-resize")
    );

  const makeRotateAdornment = () =>
    $(go.Adornment,
      { locationSpot: go.Spot.Center },
      $(go.Shape,
        {
          geometryString: ROTATE_ICON_GEOMETRY,
          desiredSize: new go.Size(12, 12),
          // 箭头三角为填充 figure，圆弧仅描边
          fill: "#2563eb",
          stroke: "#2563eb",
          strokeWidth: 1.5,
          strokeCap: "round",
          cursor: "grab",
          // 描边图形本身命中区域太小，用透明背景扩大可点击范围
          background: "rgba(255, 255, 255, 0.01)"
        }
      )
    );

  const toGoVisualAlignmentFromReal = (port: DiagramPortData) => {
    const distance = PORT_VISUAL_OFFSET + PORT_SIZE / 2;
    if (port.side === "left") return new go.Spot(0.5, 0.5, -distance, 0);
    if (port.side === "right") return new go.Spot(0.5, 0.5, distance, 0);
    if (port.side === "top") return new go.Spot(0.5, 0.5, 0, -distance);
    return new go.Spot(0.5, 0.5, 0, distance);
  };

  const makePortItem = () =>
    $(go.Panel, "Spot",
      {
        alignmentFocusName: "REAL_PORT",
        alignmentFocus: go.Spot.Center
      },
      new go.Binding("alignment", "", (port: DiagramPortData) => toGoPortAlignment(port, PORT_SIZE / 2)),
      $(go.Shape, "Circle",
        {
          name: "REAL_PORT",
          cursor: "crosshair",
          desiredSize: new go.Size(PORT_SIZE, PORT_SIZE),
          fill: "rgba(255, 255, 255, 0.001)",
          fromLinkable: false,
          fromMaxLinks: Infinity,
          opacity: 1,
          pickable: false,
          stroke: null,
          strokeWidth: 0,
          toLinkable: false,
          toMaxLinks: Infinity
        },
        new go.Binding("portId", "id"),
        new go.Binding("fromSpot", "side", toGoSpot),
        new go.Binding("toSpot", "side", toGoSpot)
      ),
      $(go.Shape, "Circle",
        {
          cursor: "crosshair",
          desiredSize: new go.Size(PORT_SIZE, PORT_SIZE),
          fill: "#ffffff",
          fromLinkable: false,
          fromMaxLinks: Infinity,
          opacity: 0,
          pickable: false,
          stroke: "#0f766e",
          strokeWidth: 1.5,
          toLinkable: false,
          toMaxLinks: Infinity,
          toolTip:
            $("ToolTip",
              $(go.TextBlock,
                { margin: 6, font: "12px sans-serif" },
                new go.Binding("text", "", portTooltipText)
              )
            )
        },
        new go.Binding("alignment", "", toGoVisualAlignmentFromReal),
        new go.Binding("portId", "id", visualPortId),
        new go.Binding("fromSpot", "side", toGoSpot),
        new go.Binding("toSpot", "side", toGoSpot)
      )
    );

  const shouldShowToArrow = (link: DiagramLinkData) => link.showArrow === true && (link.direction ?? "forward") !== "reverse";
  const shouldShowFromArrow = (link: DiagramLinkData) => link.showArrow === true && ["reverse", "both"].includes(link.direction ?? "forward");

  next.nodeTemplate =
    $(go.Node, "Spot",
      {
        locationSpot: go.Spot.Center,
        resizable: true,
        rotatable: true,
        rotateObjectName: "ROTATE_PANEL",
        rotationSpot: go.Spot.Center,
        resizeObjectName: "BODY",
        selectionObjectName: "CLICK_AREA",
        selectionAdornmentTemplate: makeNodeSelectionAdornment(),
        resizeAdornmentTemplate: makeResizeAdornment(),
        rotateAdornmentTemplate: makeRotateAdornment(),
        selectable: props.mode === "edit",
        click: (_event, node) => {
          const part = node as GoJS.Node;
          emit("event", {
            type: "NODE_CLICK",
            mode: props.mode,
            nodeKey: part.data.key,
            nodeType: part.data.typeId,
            nodeData: part.data
          });
          emitConfiguredNodeEvents(part.data, "click");
        },
        doubleClick: (_event, node) => {
          const part = node as GoJS.Node;
          emit("event", {
            type: "NODE_DOUBLE_CLICK",
            mode: props.mode,
            nodeKey: part.data.key,
            nodeType: part.data.typeId,
            nodeData: part.data
          });
          emitConfiguredNodeEvents(part.data, "doubleClick");
        },
        contextClick: (event, node) => {
          const part = node as GoJS.Node;
          emit("event", {
            type: "NODE_CONTEXT_MENU",
            mode: props.mode,
            nodeKey: part.data.key,
            nodeType: part.data.typeId,
            nodeData: part.data,
            position: { x: event.documentPoint.x, y: event.documentPoint.y }
          });
          emitConfiguredNodeEvents(part.data, "contextMenu");
        }
      },
      new go.Binding("cursor", "", resolveNodeCursor),
      new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify),
      new go.Binding("visible", "runtime", (runtime) => props.mode === "edit" || runtime?.visible !== false),
      new go.Binding("zOrder", "zOrder", normalizeZOrder),
      $(go.Panel, "Spot",
        {
          name: "ROTATE_PANEL",
          isPanelMain: true
        },
        new go.Binding("angle", "angle", normalizeNodeAngle).makeTwoWay((angle) => Math.round(Number(angle) * 100) / 100),
        $(go.Shape, "RoundedRectangle",
          {
            name: "CLICK_AREA",
            alignment: go.Spot.Center,
            fill: "rgba(255, 255, 255, 0.001)",
            stroke: null
          },
          new go.Binding("desiredSize", "size", (size) => {
            const parsed = go.Size.parse(size);
            return new go.Size(parsed.width + NODE_CLICK_PADDING * 2, parsed.height + NODE_CLICK_PADDING * 2);
          })
        ),
        // GoJS 2.3 的 Spot Panel.itemArray 只保留首个静态元素；完整 BODY 必须作为端口容器的首个元素。
        $(go.Panel, "Spot",
          { itemTemplate: makePortItem() },
          new go.Binding("itemArray", "__ports"),
          $(go.Panel, "Spot",
            {
              name: "BODY",
              isPanelMain: true,
              background: "transparent"
            },
            new go.Binding("desiredSize", "size", go.Size.parse).makeTwoWay(go.Size.stringify),
            $(go.Shape, "Rectangle",
              {
                stretch: go.GraphObject.Fill,
                fill: "transparent",
                stroke: "transparent"
              },
              new go.Binding("stroke", "", resolveNodeStatusColor),
              new go.Binding("strokeWidth", "", (node: DiagramNodeData) => hasNodeRuntimeStatus(node) ? 2 : 0),
              new go.Binding("opacity", "runtime", (runtime) => runtime?.opacity ?? 1)
            ),
          $(go.Picture,
            {
              alignment: go.Spot.Center,
              stretch: go.GraphObject.Fill,
              imageStretch: go.GraphObject.Uniform
            },
            new go.Binding("desiredSize", "size", getIconDesiredSize),
            new go.Binding("source", "__icon"),
            new go.Binding("visible", "", (node: DiagramNodeData) => !node.__isAnnotation && !node.__isControl && node.__hasImageIcon)
          ),
          $(go.TextBlock,
            {
              alignment: go.Spot.Center,
              font: "700 22px sans-serif",
              stroke: "#155e75",
              textAlign: "center"
            },
            new go.Binding("text", "__iconText"),
            new go.Binding("visible", "", (node: DiagramNodeData) => !node.__isAnnotation && !node.__isControl && !node.__hasImageIcon)
          ),
          $(go.Picture,
            {
              alignment: go.Spot.Center,
              stretch: go.GraphObject.Fill,
              imageStretch: go.GraphObject.UniformToFill
            },
            new go.Binding("desiredSize", "size", getIconDesiredSize),
            new go.Binding("source", "__icon"),
            new go.Binding("visible", "", (node: DiagramNodeData) => node.__isAnnotation === true && node.__hasImageIcon === true)
          ),
          $(go.Picture,
            {
              alignment: go.Spot.Center,
              stretch: go.GraphObject.Fill,
              imageStretch: go.GraphObject.Uniform
            },
            new go.Binding("desiredSize", "size", getIconDesiredSize),
            new go.Binding("source", "__icon"),
            new go.Binding("visible", "", shouldShowPureControlImage)
          ),
          $(go.Panel, "Auto",
            {
              alignment: go.Spot.Center,
              stretch: go.GraphObject.Fill
            },
            new go.Binding("visible", "", shouldShowStyledControl),
            $(go.Shape, "RoundedRectangle",
              {
                fill: "#eff6ff",
                stroke: "#2563eb",
                strokeWidth: 1.5,
                parameter1: 6,
                stretch: go.GraphObject.Fill
              },
              new go.Binding("fill", "", resolveControlFill),
              new go.Binding("stroke", "", resolveControlStroke),
              new go.Binding("strokeWidth", "", resolveControlStrokeWidth),
              new go.Binding("parameter1", "", resolveControlCorner)
            ),
            $(go.Panel, "Horizontal",
              {
                alignment: go.Spot.Center,
                margin: new go.Margin(5, 10, 5, 10)
              },
              new go.Binding("margin", "", resolveControlContentMargin),
              $(go.Picture,
                {
                  desiredSize: new go.Size(22, 22),
                  imageStretch: go.GraphObject.Uniform,
                  margin: new go.Margin(0, 6, 0, 0)
                },
                new go.Binding("source", "__icon"),
                new go.Binding("visible", "", shouldShowControlImage)
              ),
              $(go.TextBlock,
                {
                  font: "600 13px sans-serif",
                  stroke: "#1d4ed8",
                  maxLines: 1,
                  overflow: go.TextBlock.OverflowEllipsis
                },
                new go.Binding("text", "", resolveControlText),
                new go.Binding("font", "", resolveControlTextFont),
                new go.Binding("stroke", "", resolveControlTextStroke),
                new go.Binding("visible", "", shouldShowControlText)
              )
            )
          ),
          $(go.TextBlock,
            {
              alignment: go.Spot.Center,
              margin: 8,
              font: "14px sans-serif",
              overflow: go.TextBlock.OverflowClip,
              stroke: DEFAULT_TOPOLOGY_TEXT_COLOR,
              textAlign: "left",
              verticalAlignment: go.Spot.Center,
              wrap: go.TextBlock.WrapFit
            },
            new go.Binding("desiredSize", "size", (size) => {
              const parsed = go.Size.parse(size);
              return new go.Size(Math.max(10, parsed.width - 16), Math.max(10, parsed.height - 16));
            }),
            new go.Binding("font", "", resolveAnnotationTextFont),
            new go.Binding("stroke", "", resolveAnnotationTextColor),
            new go.Binding("textAlign", "", resolveAnnotationTextAlign),
            new go.Binding("isUnderline", "", (node: DiagramNodeData) => annotationHasTextDecoration(node, "underline")),
            new go.Binding("isStrikethrough", "", (node: DiagramNodeData) => annotationHasTextDecoration(node, "line-through")),
            new go.Binding("spacingAbove", "", resolveAnnotationLineSpacing),
            new go.Binding("spacingBelow", "", resolveAnnotationLineSpacing),
            new go.Binding("text", "", resolveAnnotationText),
            new go.Binding("visible", "__isAnnotation")
            )
          )
        )
      ),
      $(go.Panel, "Vertical",
        {
          alignment: new go.Spot(0.5, 1, 0, 8),
          alignmentFocus: go.Spot.Top,
          pickable: false
        },
        new go.Binding("alignment", "", toGoLabelAlignment),
        new go.Binding("alignmentFocus", "labelPosition", toGoLabelAlignmentFocus),
        new go.Binding("visible", "", shouldShowNodeLabel),
        $(go.TextBlock,
          {
            margin: new go.Margin(0, 4, 0, 4),
            font: "600 13px sans-serif",
            stroke: DEFAULT_TOPOLOGY_TEXT_COLOR,
            background: "transparent",
            textAlign: "center",
            maxLines: 1,
            overflow: go.TextBlock.OverflowEllipsis
          },
          new go.Binding("width", "size", getLabelWidth),
          new go.Binding("font", "", resolveNodeLabelFont),
          new go.Binding("stroke", "", resolveNodeLabelColor),
          new go.Binding("textAlign", "", resolveNodeLabelTextAlign),
          new go.Binding("isUnderline", "", (node: DiagramNodeData) => nodeLabelHasTextDecoration(node, "underline")),
          new go.Binding("isStrikethrough", "", (node: DiagramNodeData) => nodeLabelHasTextDecoration(node, "line-through")),
          new go.Binding("text", "label")
        ),
        $(go.TextBlock,
          {
            margin: new go.Margin(2, 4, 0, 4),
            font: "12px sans-serif",
            stroke: "#4b5563",
            textAlign: "center",
            maxLines: 1,
            overflow: go.TextBlock.OverflowEllipsis
          },
          new go.Binding("width", "size", getLabelWidth),
          new go.Binding("text", "runtime", (runtime) => runtime?.text || "")
        ),
        $(go.TextBlock,
          {
            margin: new go.Margin(2, 4, 0, 4),
            font: "11px sans-serif",
            textAlign: "center",
            maxLines: 1,
            overflow: go.TextBlock.OverflowEllipsis
          },
          new go.Binding("width", "size", getLabelWidth),
          new go.Binding("stroke", "", resolveNodeStatusColor),
          new go.Binding("text", "", (node: DiagramNodeData) => shouldUseNodeStatusColor(node) && node.runtime?.status ? `状态：${node.runtime.status}` : "")
        )
      )
    );

  next.groupTemplate =
    $(go.Group, "Spot",
      {
        locationSpot: go.Spot.Center,
        computesBoundsAfterDrag: true,
        handlesDragDropForMembers: true,
        resizable: true,
        resizeObjectName: "BODY",
        selectionObjectName: "BODY",
        selectionAdornmentTemplate: makeNodeSelectionAdornment(),
        resizeAdornmentTemplate: makeResizeAdornment(),
        selectable: props.mode === "edit",
        memberValidation: (group, part) => {
          if (!(part instanceof go.Node) || part.data.key === group.data.key) return false;
          return canContainNode(nodeTypeOf(group.data.typeId), nodeTypeOf(part.data.typeId), part.data);
        },
        mouseDrop: () => {}
      },
      new go.Binding("cursor", "", resolveNodeCursor),
      new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify),
      new go.Binding("zOrder", "zOrder", normalizeZOrder),
      // Group 同样用单独容器隔离动态端口，避免 itemArray 重建时移除 BODY 内容。
      $(go.Panel, "Spot",
        { itemTemplate: makePortItem() },
        new go.Binding("itemArray", "__ports"),
        $(go.Panel, "Auto",
          {
            name: "BODY"
          },
          new go.Binding("desiredSize", "size", go.Size.parse).makeTwoWay(go.Size.stringify),
          $(go.Shape, "RoundedRectangle",
            { fill: "#eef6ff", stroke: "#3b82f6", strokeWidth: 1.5 },
            new go.Binding("fill", "", resolveGroupFill),
            new go.Binding("stroke", "", resolveGroupStroke),
            new go.Binding("strokeDashArray", "", resolveGroupStrokeDash)
          ),
          $(go.Picture,
            {
              alignment: go.Spot.Center,
              stretch: go.GraphObject.Fill,
              imageStretch: go.GraphObject.UniformToFill
            },
            new go.Binding("desiredSize", "size", getIconDesiredSize),
            new go.Binding("source", "__icon"),
            new go.Binding("visible", "", (node: DiagramNodeData) => node.__isContainer === true && node.__hasImageIcon === true)
          ),
          $(go.TextBlock,
            { margin: 8, font: "700 13px sans-serif", alignment: go.Spot.TopLeft },
            new go.Binding("text", "label"),
            new go.Binding("visible", "", shouldShowGroupLabel)
          )
        )
      )
    );

  next.linkTemplate =
    $(go.Link,
      {
        adjusting: go.Link.End,
        layerName: "",
        routing: go.Link.Orthogonal,
        curve: go.Link.None,
        corner: 0,
        fromEndSegmentLength: 14,
        relinkableFrom: true,
        relinkableTo: true,
        resegmentable: true,
        reshapable: true,
        selectable: props.mode === "edit",
        selectionAdornmentTemplate: makeLinkSelectionAdornment(),
        toEndSegmentLength: 14,
        zOrder: 0
      },
      new go.Binding("layerName", "", resolveLinkLayer),
      new go.Binding("points").makeTwoWay(),
      new go.Binding("zOrder", "", resolveLinkZOrder),
      $(go.Shape,
        {
          name: "EDIT_PATH",
          fill: null,
          isPanelMain: true,
          pickable: false,
          stroke: "transparent",
          strokeWidth: 1
        }
      ),
      $(go.Shape,
        {
          name: "GLOW",
          fill: null,
          isPanelMain: true,
          opacity: 0.28,
          pickable: false,
          stroke: "#42B0FF",
          strokeCap: "round",
          strokeJoin: "round",
          strokeWidth: 10
        },
        new go.Binding("visible", "", resolveLinkGlowVisible),
        new go.Binding("stroke", "", resolveLinkGlowColor),
        new go.Binding("strokeWidth", "", resolveLinkGlowWidth),
        new go.Binding("opacity", "", resolveLinkGlowOpacity),
        new go.Binding("strokeCap", "", resolveLinkLineCap),
        new go.Binding("strokeJoin", "", (link: DiagramLinkData) => resolveLinkLineCap(link) === "round" ? "round" : "miter"),
        new go.Binding("strokeDashArray", "", resolveLinkDash)
      ),
      $(go.Shape,
        {
          isPanelMain: true,
          stroke: "#42B0FF",
          strokeCap: "butt",
          strokeJoin: "miter",
          strokeWidth: 2
        },
        new go.Binding("stroke", "", resolveLinkColor),
        new go.Binding("strokeWidth", "", resolveLinkWidth),
        new go.Binding("opacity", "", resolveLinkOpacity),
        new go.Binding("strokeCap", "", resolveLinkLineCap),
        new go.Binding("strokeJoin", "", (link: DiagramLinkData) => resolveLinkLineCap(link) === "round" ? "round" : "miter"),
        new go.Binding("strokeDashArray", "", resolveLinkDash)
      ),
      $(go.Shape,
        {
          name: "FLOW",
          fill: null,
          isPanelMain: true,
          opacity: 0.95,
          pickable: false,
          stroke: "#dbeafe",
          strokeDashArray: [9, 9],
          strokeWidth: 3
        },
        new go.Binding("visible", "", resolveLinkAnimated),
        new go.Binding("stroke", "", resolveFlowLinkColor),
        new go.Binding("opacity", "", resolveFlowLinkOpacity),
        new go.Binding("strokeDashArray", "", resolveFlowLinkDash),
        new go.Binding("strokeWidth", "", resolveFlowLinkWidth),
        new go.Binding("strokeCap", "", resolveLinkLineCap)
      ),
      $(go.Shape,
        { fromArrow: "Standard", stroke: null, fill: "#42B0FF" },
        new go.Binding("visible", "", shouldShowFromArrow),
        new go.Binding("fill", "", resolveLinkColor)
      ),
      $(go.Shape,
        { toArrow: "Standard", stroke: null, fill: "#42B0FF" },
        new go.Binding("visible", "", shouldShowToArrow),
        new go.Binding("fill", "", resolveLinkColor)
      )
    );

  next.toolManager.linkingTool.linkValidation = validateLink;
  next.toolManager.relinkingTool.linkValidation = validateLink;

  next.model = configureModel(new go.GraphLinksModel({
    nodeDataArray: [],
    linkDataArray: []
  }));

  next.addModelChangedListener((event: GoJS.ChangedEvent) => {
    if (props.mode !== "edit" || applyingModel || suppressChangeEmit || !event.isTransactionFinished || !props.topologyData) return;
    if (changeEmitScheduled) return;

    // 微任务合并：一次交互产生的多个事务（如连线的 normalize + 路由同步）只做一次全量导出
    changeEmitScheduled = true;
    queueMicrotask(() => {
      changeEmitScheduled = false;
      if (!diagram || props.mode !== "edit" || !props.topologyData) return;
      const model = diagram.model as GoJS.GraphLinksModel;
      skipNextTopologyApply = true;
      emit("change", {
        ...props.topologyData,
        nodes: exportDiagramNodes(model),
        links: exportDiagramLinks(model)
      });
    });
  });

  const normalizeLink = (link: GoJS.Link) => {
    const model = next.model as GoJS.GraphLinksModel;

    model.commit((m) => {
      const normalizedFromPort = normalizePortId(link.data.fromPort);
      const normalizedToPort = normalizePortId(link.data.toPort);
      const nextDefaultState = link.data.defaultState ?? linkCreationDefaults.defaultState;
      const nextDefaultStyle = link.data.defaultStyle
        ? cloneLinkStyle(link.data.defaultStyle)
        : cloneLinkStyle(linkCreationDefaults.defaultStyle);
      if (normalizedFromPort !== link.data.fromPort) m.setDataProperty(link.data, "fromPort", normalizedFromPort);
      if (normalizedToPort !== link.data.toPort) m.setDataProperty(link.data, "toPort", normalizedToPort);
      if (!link.data.key) m.setDataProperty(link.data, "key", createLinkKey(model));
      if (!link.data.direction) m.setDataProperty(link.data, "direction", linkCreationDefaults.direction);
      if (link.data.showArrow === undefined) m.setDataProperty(link.data, "showArrow", linkCreationDefaults.showArrow);
      if (!link.data.linkType) m.setDataProperty(link.data, "linkType", linkCreationDefaults.linkType);
      if (!link.data.defaultState) m.setDataProperty(link.data, "defaultState", nextDefaultState);
      if (!link.data.defaultStyle) {
        m.setDataProperty(link.data, "defaultStyle", nextDefaultStyle);
      }
      if (!link.data.runtime) {
        m.setDataProperty(link.data, "runtime", buildDefaultLinkRuntime(nextDefaultStyle, nextDefaultState));
      }
    }, "normalize link data");
    link.invalidateRoute();
    link.updateRoute();
  };

  const syncLinkRoute = (link: GoJS.Link) => {
    const model = next.model as GoJS.GraphLinksModel;
    const points = serializeLinkPoints(link);
    if (!points) return;
    model.commit((m) => {
      m.setDataProperty(link.data, "points", points);
    }, "sync link route");
  };

  const normalizeAndSyncLink = (link: GoJS.Link) => {
    normalizeLink(link);
    syncLinkRoute(link);
  };

  next.addDiagramListener("LinkDrawn", (event) => normalizeAndSyncLink(event.subject as GoJS.Link));
  next.addDiagramListener("LinkRelinked", (event) => normalizeAndSyncLink(event.subject as GoJS.Link));
  next.addDiagramListener("LinkReshaped", (event) => syncLinkRoute(event.subject as GoJS.Link));

  const isAltInput = (input: GoJS.InputEvent) => input.alt || input.event?.altKey;

  next.addDiagramListener("ObjectSingleClicked", (event) => {
    const input = event.diagram.lastInput;
    if (!isAltInput(input)) {
      closePickMenu();
      lastPickCycle = null;
      return;
    }
    const handled = cyclePickCandidate(input);
    if (handled) {
      event.handled = true;
      closePickMenu();
    }
  });

  next.addDiagramListener("ObjectContextClicked", (event) => {
    const input = event.diagram.lastInput;
    if (!isAltInput(input)) return;
    const handled = openPickMenu(input);
    if (handled) event.handled = true;
  });

  next.addDiagramListener("ObjectDoubleClicked", (event) => {
    const input = event.diagram.lastInput;
    if (!isAltInput(input)) return;
    const handled = openPickMenu(input);
    if (handled) event.handled = true;
  });

  next.addDiagramListener("BackgroundSingleClicked", () => {
    closePickMenu();
    lastPickCycle = null;
  });

  next.addDiagramListener("ChangedSelection", () => {
    refreshPortVisibility();
    if (applyingModel) return;
    const part = next.selection.first();
    emit("selectionChange", part instanceof go.Node || part instanceof go.Link ? (part.data.key ?? "") : "");
  });

  next.addDiagramListener("InitialLayoutCompleted", () => {
    if (props.mode === "runtime") fitRuntimeView();
    window.setTimeout(updateOverviewViewportBoxVisibility, 0);
  });

  next.addDiagramListener("ViewportBoundsChanged", () => updateOverviewViewportBoxVisibility());
  next.addDiagramListener("DocumentBoundsChanged", () => updateOverviewViewportBoxVisibility());

  return next;
}

function createOverview(el: HTMLDivElement, observedDiagram: GoJS.Diagram) {
  const go = getGo();
  const $ = go.GraphObject.make;
  const nextOverview = $(go.Overview, el, {
    allowHorizontalScroll: true,
    allowMove: true,
    allowSelect: true,
    allowVerticalScroll: true,
    isReadOnly: false,
    observed: observedDiagram,
    padding: 12,
    box:
      $(go.Part,
        {
          cursor: "move",
          locationObjectName: OVERVIEW_VIEWPORT_BOX_NAME,
          movable: true,
          resizeObjectName: OVERVIEW_VIEWPORT_BOX_NAME,
          selectable: true,
          selectionAdorned: false,
          selectionObjectName: OVERVIEW_VIEWPORT_BOX_NAME
        },
        $(go.Shape, "Rectangle", {
          name: OVERVIEW_VIEWPORT_BOX_NAME,
          fill: "rgba(37, 99, 235, 0.12)",
          stroke: "#2563eb",
          strokeWidth: 2
        })
      )
  }) as GoJS.Overview;

  window.setTimeout(() => {
    nextOverview.requestUpdate();
    nextOverview.redraw();
    updateOverviewViewportBoxVisibility();
  }, 0);

  return nextOverview;
}

function refreshAnimatedLinkFlag() {
  hasAnimatedLinks = Boolean(diagram
    && ((diagram.model as GoJS.GraphLinksModel).linkDataArray as DiagramLinkData[])
      .some((link) => resolveLinkAnimated(link)));
}

function startFlowAnimation() {
  stopFlowAnimation();
  flowTimer = window.setInterval(() => {
    if (!diagram || !hasAnimatedLinks || document.hidden) return;
    flowOffset = (flowOffset + 1) % 100000;
    let shouldRefreshFlow = false;
    diagram.links.each((link) => {
      const flow = link.findObject("FLOW") as GoJS.Shape | null;
      if (!flow || !link.data || !resolveLinkAnimated(link.data)) return;
      const speed = resolveFlowLinkSpeed(link.data);
      const offset = speed === 0 ? 0 : flowOffset * speed;
      const nextOffset = resolveFlowDashOffset(link.data, offset);
      if (speed > 0 || flow.strokeDashOffset !== nextOffset) shouldRefreshFlow = true;
      flow.strokeDashOffset = nextOffset;
    });
    if (shouldRefreshFlow) diagram.requestUpdate();
  }, 90);
}

function stopFlowAnimation() {
  if (flowTimer) window.clearInterval(flowTimer);
  flowTimer = undefined;
}

async function applyTopology() {
  if (!diagram || !props.topologyData) return;
  const token = ++topologyApplyToken;
  const topologyData = props.topologyData;
  const nodeTypes = props.nodeTypes;
  await prepareTopologyAssets(topologyData, nodeTypes);
  if (token !== topologyApplyToken || !diagram || props.topologyData !== topologyData) return;
  const go = getGo();

  closePickMenu();
  lastPickCycle = null;
  applyingModel = true;
  diagram.model = configureModel(new go.GraphLinksModel({
    nodeDataArray: buildDiagramNodes(topologyData.nodes),
    linkDataArray: buildDiagramLinks(topologyData.links)
  }));
  updateCanvasBoundary();
  acknowledgeAppliedTopology();
  updateDiagramMode();
  refreshInteractionBindings();
  syncSelectedPart();
  applyingModel = false;
  refreshAnimatedLinkFlag();
  overview?.requestUpdate();
  overview?.redraw();
  updateOverviewViewportBoxVisibility();
  if (shouldAutoFitRuntimeView()) window.setTimeout(fitRuntimeView, 80);
  emit("ready");
}

function getDropNodeType(event: DragEvent) {
  const typeId = event.dataTransfer?.getData("application/x-topology-node-type")
    || event.dataTransfer?.getData("text/plain");

  if (!typeId) return null;
  return props.nodeTypes.find((item) => item.id === typeId) ?? null;
}

function hasTopologyDragPayload(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes("application/x-topology-node-type") || types.includes("text/plain");
}

function allowDrop(event: DragEvent) {
  if (props.mode !== "edit") return;
  if (!hasTopologyDragPayload(event)) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handleDragOver(event: DragEvent) {
  allowDrop(event);
}

function handleDrop(event: DragEvent) {
  if (props.mode !== "edit" || !diagram || !canvasEl.value) return;

  const nodeType = getDropNodeType(event);
  if (!nodeType) return;

  event.preventDefault();
  event.stopPropagation();

  const go = getGo();
  const rect = canvasEl.value.getBoundingClientRect();
  const viewPoint = new go.Point(event.clientX - rect.left, event.clientY - rect.top);
  const documentPoint = snapPointToGrid(diagram.transformViewToDoc(viewPoint));
  emit("dropNode", {
    nodeType,
    loc: go.Point.stringify(documentPoint)
  });
}

function fitRuntimeViewSoon() {
  if (!shouldAutoFitRuntimeView()) return;
  window.requestAnimationFrame(() => fitRuntimeView());
}

function setupResizeObserver() {
  if (!canvasEl.value || typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", fitRuntimeViewSoon);
    return;
  }
  resizeObserver = new ResizeObserver(fitRuntimeViewSoon);
  resizeObserver.observe(canvasEl.value);
}

function teardownResizeObserver() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener("resize", fitRuntimeViewSoon);
}

onMounted(() => {
  loadMiniViewState();
  if (!canvasEl.value) return;
  diagram = createDiagram(canvasEl.value);
  if (overviewEl.value) overview = createOverview(overviewEl.value, diagram);
  void applyTopology();
  setupResizeObserver();
  startFlowAnimation();
});

onBeforeUnmount(() => {
  stopFlowAnimation();
  teardownResizeObserver();
  if (assetExpiryTimer) {
    window.clearTimeout(assetExpiryTimer);
    assetExpiryTimer = undefined;
  }
  topologyApplyToken += 1;
  miniViewPanelDrag = null;
  overview?.div && (overview.div = null);
  overview = null;
  canvasBoundaryPart = null;
  diagram?.div && (diagram.div = null);
  diagram = null;
});

watch(() => props.topologyData, () => {
  if (skipNextTopologyApply) {
    skipNextTopologyApply = false;
    acknowledgeAppliedTopology();
    return;
  }
  if (props.topologyData === lastAppliedTopology) return;
  if (!topologySignatureFresh) {
    lastTopologyRenderSignature = getTopologyRenderSignature(lastAppliedTopology);
    topologySignatureFresh = true;
  }
  const nextSignature = getTopologyRenderSignature(props.topologyData);
  if (nextSignature === lastTopologyRenderSignature) {
    lastAppliedTopology = props.topologyData;
    lastTopologyRenderSignature = nextSignature;
    return;
  }
  void applyTopology();
});

watch(() => props.mode, () => {
  closePickMenu();
  lastPickCycle = null;
  updateDiagramMode();
  updateWheelBehavior();
  refreshInteractionBindings();
  updateCanvasBoundary();
  updateOverviewViewportBoxVisibility();
  fitRuntimeViewSoon();
});

watch(() => props.editorBackgroundTheme, () => {
  updateCanvasBoundary();
  updateOverviewViewportBoxVisibility();
});

watch(() => props.showCanvasBoundary, () => {
  updateCanvasBoundary();
  updateOverviewViewportBoxVisibility();
  fitRuntimeViewSoon();
});

watch(() => props.enableWheelZoom, updateWheelBehavior);

watch(() => [props.autoFit, props.fitPadding, props.fitMaxScale], fitRuntimeViewSoon);

watch(() => props.nodeTypes, () => void applyTopology());

watch(() => props.selectedKey, syncSelectedPart);
</script>

<template>
  <div class="topology-canvas-shell">
    <div
      ref="canvasEl"
      class="topology-canvas"
      @dragenter.capture="allowDrop"
      @dragover.capture="handleDragOver"
      @drop.capture="handleDrop"
    />
    <div
      v-if="pickMenu?.visible"
      class="topology-pick-menu"
      :style="{ left: `${pickMenu.x}px`, top: `${pickMenu.y}px` }"
      @pointerdown.stop
      @click.stop
    >
      <button
        v-for="candidate in pickMenu.candidates"
        :key="candidate.key"
        type="button"
        class="topology-pick-menu__item"
        :class="{ active: selectedKey === candidate.key }"
        @click="selectPickCandidate(candidate)"
      >
        <span class="topology-pick-menu__kind">
          {{ candidate.kind === 'group' ? '组' : candidate.kind === 'link' ? '线' : '节点' }}
        </span>
        <span class="topology-pick-menu__label">{{ candidate.label }}</span>
        <span class="topology-pick-menu__key">{{ candidate.key }}</span>
      </button>
    </div>
    <div
      ref="miniViewEl"
      class="topology-miniview"
      :class="{
        'topology-miniview--collapsed': miniViewCollapsed,
        'topology-miniview--dragging': Boolean(miniViewPanelDrag)
      }"
      :style="miniViewStyle"
      @pointermove.capture="handleMiniViewPanelPointerMove"
      @pointerup.capture="handleMiniViewPanelPointerEnd"
      @pointercancel.capture="handleMiniViewPanelPointerEnd"
    >
      <div class="miniview-title" @pointerdown="handleMiniViewPanelPointerDown">
        <span class="miniview-label">导航</span>
        <button
          type="button"
          class="miniview-toggle"
          :title="miniViewCollapsed ? '展开导航' : '收起导航'"
          @pointerdown.stop
          @click.stop="toggleMiniViewCollapsed"
        >
          {{ miniViewCollapsed ? '+' : '-' }}
        </button>
      </div>
      <div
        ref="overviewEl"
        class="topology-overview"
        @pointerdown.capture="handleOverviewPointerDown"
        @pointermove.capture="handleOverviewPointerMove"
        @pointerup.capture="handleOverviewPointerEnd"
        @pointercancel.capture="handleOverviewPointerEnd"
      />
    </div>
  </div>
</template>
