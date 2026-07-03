<script setup lang="ts">
import "../../../core/go.js";
import type * as GoJS from "gojs";
import { getNodePorts, readExpressionPath, resolveExpressionValue, type NodeEventConfig, type NodeTypeDefinition, type PortDefinition, type TopologyData, type TopologyEvent, type TopologyLink, type TopologyNode } from "@topo-editor/topology-shared";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  mode: "edit" | "runtime";
  topologyData: TopologyData | null;
  nodeTypes: NodeTypeDefinition[];
  selectedKey?: string;
  eventContext?: Record<string, unknown>;
}>();

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const emit = defineEmits<{
  change: [topology: TopologyData];
  event: [event: TopologyEvent];
  dropNode: [payload: { nodeType: NodeTypeDefinition; loc: string; groupKey?: string }];
  selectionChange: [key: string];
}>();

defineExpose({
  exportTopology,
  updateNodeDataFromProps,
  updateLinkDataFromProps,
  undo,
  redo,
  deleteSelection,
  fitView,
  autoLayout,
  exportSvg
});

const canvasEl = ref<HTMLDivElement | null>(null);
const overviewEl = ref<HTMLDivElement | null>(null);
let diagram: GoJS.Diagram | null = null;
let overview: GoJS.Overview | null = null;
let applyingModel = false;
let skipNextTopologyApply = false;
let lastTopologyRenderSignature = "";
let flowTimer: number | undefined;
let flowOffset = 0;

const SNAP_GRID_SIZE = 10;

type PortSide = "left" | "right" | "top" | "bottom";

type DiagramPortData = PortDefinition & {
  side: PortSide;
};

type DiagramNodeData = TopologyNode & {
  __icon?: string;
  __iconText?: string;
  __hasImageIcon?: boolean;
  __isAnnotation?: boolean;
  __isControl?: boolean;
  __ports?: DiagramPortData[];
};

type DiagramLinkData = TopologyLink;

type SerializablePoint = {
  x: number;
  y: number;
};

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
    const { __hasImageIcon, __icon, __iconText, __isAnnotation, __isControl, __ports, ...topologyNode } = node;
    void __hasImageIcon;
    void __icon;
    void __iconText;
    void __isAnnotation;
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
  return !!icon && (
    /^https?:\/\//.test(icon)
    || icon.startsWith("data:image/")
    || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(icon)
  );
}

function normalizeIcon(icon: string) {
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
  const statusIcon = nodeType?.statusImages?.[normalizeNodeStatus(node.runtime?.status)];
  const propsIcon = typeof node.props?.icon === "string" ? node.props.icon : undefined;
  const directIcon = typeof (node as TopologyNode & { icon?: unknown }).icon === "string"
    ? (node as TopologyNode & { icon?: string }).icon
    : undefined;
  const icon = statusIcon || propsIcon || directIcon || nodeType?.icon || "";
  return normalizeIcon(icon);
}

function resolveIconText(node: TopologyNode, icon: string) {
  if (icon && !isImageIcon(icon)) return icon;
  return node.label?.slice(0, 1) || node.typeId.slice(0, 1).toUpperCase();
}

function isAnnotationNode(node: TopologyNode) {
  return nodeTypeOf(node.typeId)?.category === "annotation";
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
  const color = node.props?.textColor;
  return typeof color === "string" && color.trim() ? color : "#111827";
}

function resolveAnnotationTextFont(node: DiagramNodeData) {
  const size = Number(node.props?.textSize);
  const fontSize = Number.isFinite(size) && size > 0 ? Math.round(size) : 14;
  return `${fontSize}px sans-serif`;
}

function controlRenderMode(node: DiagramNodeData) {
  const mode = node.props?.buttonRenderMode;
  return mode === "image" || mode === "imageText" || mode === "text" ? mode : "text";
}

function resolveControlText(node: DiagramNodeData) {
  const text = node.props?.buttonText;
  return typeof text === "string" && text.trim() ? text : node.label;
}

function shouldShowControlImage(node: DiagramNodeData) {
  const mode = controlRenderMode(node);
  return node.__isControl === true && mode !== "text" && node.__hasImageIcon === true;
}

function shouldShowControlText(node: DiagramNodeData) {
  const mode = controlRenderMode(node);
  return node.__isControl === true && (mode !== "image" || !node.__hasImageIcon);
}

function shouldShowNodeLabel(node: DiagramNodeData) {
  return node.__isAnnotation || node.__isControl ? false : node.props?.showLabel !== false;
}

function shouldShowGroupLabel(node: DiagramNodeData) {
  return node.props?.showLabel !== false;
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
  if (node.props?.transparentBackground === true) return "transparent";
  const color = node.runtime?.backgroundColor || "#eef6ff";
  const opacity = Number(node.props?.backgroundOpacity);
  if (!Number.isFinite(opacity)) return color;
  return colorWithOpacity(color, opacity / 100);
}

function resolveGroupStrokeDash(node: DiagramNodeData) {
  return node.props?.dashedBorder === true ? [8, 6] : null;
}

function getPortSide(port: PortDefinition): PortSide {
  if (port.id === "top") return "top";
  if (port.id === "right") return "right";
  if (port.id === "bottom") return "bottom";
  if (port.id === "left") return "left";
  if (port.direction === "in") return "left";
  if (port.direction === "out") return "right";
  return "bottom";
}

function buildPortData(typeId: string): DiagramPortData[] {
  const nodeType = nodeTypeOf(typeId);
  const ports = nodeType?.category === "control" && nodeType.ports?.length === 0
    ? []
    : getNodePorts(nodeType?.ports);
  return ports.map((port) => {
    return {
      ...port,
      side: getPortSide(port)
    };
  });
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
      __isControl: isControlNode(node),
      __ports: buildPortData(node.typeId)
    };
  });
}

function buildDiagramLinks(links: TopologyData["links"]): DiagramLinkData[] {
  return cloneModelArray(links).map((link) => {
    const normalizedPoints = normalizePointArray(link.points);
    return {
      ...link,
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
    const { points, ...restLink } = cloneModelArray([linkData])[0];
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

function portForSide(ports: DiagramPortData[] | undefined, side: PortSide) {
  return ports?.find((port) => port.id === side) ?? ports?.find((port) => port.side === side);
}

function portLabelForSide(ports: DiagramPortData[] | undefined, side: PortSide) {
  const port = portForSide(ports, side);
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

function resolveNodeStatusColor(runtime?: TopologyNode["runtime"]) {
  if (runtime?.color) return runtime.color;
  if (runtime?.status === "running") return "#22c55e";
  if (runtime?.status === "normal") return "#22c55e";
  if (runtime?.status === "warning") return "#f59e0b";
  if (runtime?.status === "fault") return "#ef4444";
  if (runtime?.status === "offline") return "#64748b";
  if (runtime?.status === "unknown") return "#94a3b8";
  return "transparent";
}

function hasNodeRuntimeStatus(runtime?: TopologyNode["runtime"]) {
  return !!runtime?.status || !!runtime?.color;
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
  return getNodePorts(nodeTypeOf(typeId)?.ports).find((port) => port.id === portId);
}

function getConnectedCount(node: GoJS.Node, portId: string, direction: "from" | "to") {
  let count = 0;
  const iterator = direction === "from" ? node.findLinksOutOf(portId) : node.findLinksInto(portId);
  while (iterator.next()) count += 1;
  return count;
}

function validateLink(fromNode: GoJS.Node, fromPort: GoJS.GraphObject, toNode: GoJS.Node, toPort: GoJS.GraphObject) {
  const fromPortId = fromPort.portId;
  const toPortId = toPort.portId;
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
  diagram.nodes.each((node) => {
    ["top", "right", "bottom", "left"].forEach((portId) => {
      const port = node.findPort(portId);
      if (!port) return;
      const shouldEnablePort = props.mode === "edit" && !!portForSide(node.data.__ports, portId as PortSide);
      port.opacity = shouldEnablePort ? 1 : 0;
      port.pickable = shouldEnablePort;
    });
  });
}

function syncSelectedPart() {
  if (!diagram) return;
  if (!props.selectedKey) {
    diagram.clearSelection();
    return;
  }

  const part = diagram.findNodeForKey(props.selectedKey) ?? diagram.findLinkForKey(props.selectedKey);
  if (part) diagram.select(part);
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
    nodes: data.nodes,
    links: data.links,
    viewport: data.viewport
  });
}

function updateNodeDataFromProps(nodeKey: string, patch: Partial<TopologyNode>) {
  if (!diagram) return;
  const model = diagram.model as GoJS.GraphLinksModel;
  const nodeData = model.findNodeDataForKey(nodeKey) as DiagramNodeData | null;
  if (!nodeData) return;

  model.commit((m) => {
    Object.entries(patch).forEach(([key, value]) => {
      if (key === "runtime") {
        m.setDataProperty(nodeData, "runtime", value as TopologyNode["runtime"]);
        return;
      }
      m.setDataProperty(nodeData, key, value);
    });
  }, "update node from props");
}

function updateLinkDataFromProps(linkKey: string, patch: Partial<TopologyLink>) {
  if (!diagram) return;
  const model = diagram.model as GoJS.GraphLinksModel;
  const linkData = model.findLinkDataForKey(linkKey) as DiagramLinkData | null;
  if (!linkData) return;

  model.commit((m) => {
    Object.entries(patch).forEach(([key, value]) => {
      if (key === "runtime") {
        m.setDataProperty(linkData, "runtime", value as TopologyLink["runtime"]);
        return;
      }
      m.setDataProperty(linkData, key, value);
    });
  }, "update link from props");
}

function resolveLinkColor(link: DiagramLinkData) {
  return link.runtime?.color || link.defaultStyle?.color || "#42B0FF";
}

function resolveLinkWidth(link: DiagramLinkData) {
  return link.runtime?.width || link.defaultStyle?.width || 2;
}

function resolveLinkAnimated(link: DiagramLinkData) {
  return link.runtime?.animated ?? link.defaultStyle?.animated ?? false;
}

function resolveLinkFlowDirection(link: DiagramLinkData) {
  return link.runtime?.flowDirection || link.defaultStyle?.flowDirection || "fromTo";
}

function resolveLinkLayer(link: DiagramLinkData) {
  return resolveLinkAnimated(link) ? "Foreground" : "";
}

function resolveLinkZOrder(link: DiagramLinkData) {
  return resolveLinkAnimated(link) ? 1000 : 0;
}

function resolveFlowLinkWidth(link: DiagramLinkData) {
  return Math.max(2, resolveLinkWidth(link));
}

function resolveFlowLinkDash(link: DiagramLinkData) {
  const width = resolveFlowLinkWidth(link);
  return [Math.max(8, width * 3), Math.max(8, width * 3)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventConfigsForTrigger(node: DiagramNodeData, trigger: NodeEventConfig["trigger"]) {
  return (node.eventConfig ?? []).filter((config) => {
    const normalizedTrigger = config.trigger || (config as NodeEventConfig & { event?: NodeEventConfig["trigger"] }).event;
    return config.enabled !== false && normalizedTrigger === trigger && config.eventName && config.eventKey;
  });
}

function buildEventContext(node: DiagramNodeData, config: NodeEventConfig) {
  const bindNode = config.bindNodeKey
    ? props.topologyData?.nodes.find((item) => item.key === config.bindNodeKey)
    : undefined;
  const boundData = bindNode
    ? config.bindDataPath
      ? readExpressionPath(bindNode as Record<string, unknown>, config.bindDataPath)
      : bindNode
    : undefined;

  return {
    ...(props.eventContext ?? {}),
    node,
    nodeData: node,
    props: node.props ?? {},
    runtime: node.runtime ?? {},
    bindNode,
    boundNode: bindNode,
    boundData,
    topology: props.topologyData
  };
}

function resolveNodeEventData(node: DiagramNodeData, config: NodeEventConfig) {
  const context = buildEventContext(node, config);
  const staticData = isRecord(config.eventData) ? config.eventData : {};
  const templateData = isRecord(config.eventDataTemplate)
    ? resolveExpressionValue(config.eventDataTemplate, context)
    : {};
  const boundData = context.boundData;

  return {
    ...staticData,
    ...(isRecord(templateData) ? templateData : {}),
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

function fitView() {
  diagram?.commandHandler.zoomToFit();
}

function fitRuntimeView() {
  if (!diagram) return;
  const go = getGo();
  const bounds = diagram.documentBounds;
  const viewportWidth = diagram.div?.clientWidth ?? 0;
  const viewportHeight = diagram.div?.clientHeight ?? 0;
  if (
    !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || bounds.width <= 0
    || bounds.height <= 0
    || viewportWidth <= 0
    || viewportHeight <= 0
  ) return;

  const padding = 80;
  const scale = Math.min(
    1,
    Math.max(0.2, Math.min((viewportWidth - padding) / bounds.width, (viewportHeight - padding) / bounds.height))
  );
  diagram.scale = scale;
  diagram.position = new go.Point(
    bounds.x - padding / 2 / scale,
    bounds.y - padding / 2 / scale
  );
}

function autoLayout() {
  if (!diagram || props.mode !== "edit") return;
  const go = getGo();
  diagram.commit((targetDiagram) => {
    targetDiagram.layout = new go.LayeredDigraphLayout({
      columnSpacing: 70,
      direction: 0,
      layerSpacing: 95
    });
    targetDiagram.layoutDiagram(true);
  }, "auto layout");
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

  const finishDrop = (event: GoJS.InputEvent) => {
    if (props.mode !== "edit") return;
    const ok = event.diagram.commandHandler.addTopLevelParts(event.diagram.selection, true);
    if (!ok) event.diagram.currentTool.doCancel();
  };
  const next = $(go.Diagram, el, {
    "undoManager.isEnabled": true,
    "animationManager.isEnabled": true,
    "draggingTool.gridSnapCellSize": new go.Size(SNAP_GRID_SIZE, SNAP_GRID_SIZE),
    "draggingTool.gridSnapOrigin": new go.Point(0, 0),
    "draggingTool.isGridSnapEnabled": true,
    "linkingTool.direction": go.LinkingTool.ForwardsOnly,
    "linkingTool.portGravity": 32,
    "relinkingTool.isEnabled": true,
    "relinkingTool.portGravity": 32,
    "resizingTool.isGridSnapEnabled": true,
    "rotatingTool.snapAngleMultiple": 15,
    "rotatingTool.snapAngleEpsilon": 7.5,
    "dragSelectingTool.isEnabled": false,
    "panningTool.isEnabled": true,
    "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
    allowDrop: props.mode === "edit",
    allowResize: props.mode === "edit",
    contentAlignment: go.Spot.Center,
    initialAutoScale: go.Diagram.Uniform,
    initialContentAlignment: go.Spot.Center,
    allowSelect: props.mode === "edit",
    isReadOnly: props.mode === "runtime",
    mouseDrop: (event: GoJS.InputEvent) => finishDrop(event)
  }) as go.Diagram;

  next.grid =
    $(go.Panel, "Grid",
      {
        gridCellSize: new go.Size(SNAP_GRID_SIZE, SNAP_GRID_SIZE),
        gridOrigin: new go.Point(0, 0),
        visible: props.mode === "edit"
      },
      $(go.Shape, "LineH", { stroke: "#dbe3ee", strokeWidth: 0.5 }),
      $(go.Shape, "LineV", { stroke: "#dbe3ee", strokeWidth: 0.5 }),
      $(go.Shape, "LineH", { interval: 5, stroke: "#c8d3e0", strokeWidth: 0.7 }),
      $(go.Shape, "LineV", { interval: 5, stroke: "#c8d3e0", strokeWidth: 0.7 })
    );
  next.toolManager.linkReshapingTool = new SnapOrthogonalLinkReshapingTool();

  const makeContextMenu = () =>
    $("ContextMenu",
      $("ContextMenuButton",
        $(go.TextBlock, "复制"),
        {
          click: (event: GoJS.InputEvent) => event.diagram.commandHandler.copySelection()
        }
      ),
      $("ContextMenuButton",
        $(go.TextBlock, "粘贴"),
        {
          click: (event: GoJS.InputEvent) => {
            if (props.mode === "edit") event.diagram.commandHandler.pasteSelection();
          }
        }
      ),
      $("ContextMenuButton",
        $(go.TextBlock, "删除"),
        {
          click: (event: GoJS.InputEvent) => {
            if (props.mode === "edit") event.diagram.commandHandler.deleteSelection();
          }
        }
      )
    );

  const makePort = (side: PortSide, alignment: GoJS.Spot) =>
    $(go.Shape, "Circle",
      {
        cursor: "crosshair",
        desiredSize: new go.Size(12, 12),
        fill: "#ffffff",
        stroke: "#0f766e",
        strokeWidth: 2,
        alignment,
        alignmentFocus: go.Spot.Center,
        portId: side,
        fromLinkable: props.mode === "edit",
        toLinkable: props.mode === "edit",
        fromMaxLinks: Infinity,
        toMaxLinks: Infinity,
        fromSpot: toGoSpot(side),
        toSpot: toGoSpot(side),
        opacity: props.mode === "edit" ? 1 : 0,
        pickable: props.mode === "edit",
        toolTip:
          $("ToolTip",
            $(go.TextBlock,
              { margin: 6, font: "12px sans-serif" },
              new go.Binding("text", "__ports", (ports: DiagramPortData[] | undefined) => portLabelForSide(ports, side))
            )
          )
      },
      new go.Binding("opacity", "__ports", (ports: DiagramPortData[] | undefined) => props.mode === "edit" && !!portForSide(ports, side) ? 1 : 0),
      new go.Binding("pickable", "__ports", (ports: DiagramPortData[] | undefined) => props.mode === "edit" && !!portForSide(ports, side)),
      new go.Binding("fromSpot", "__ports", (ports: DiagramPortData[] | undefined) => toGoSpot(portForSide(ports, side)?.side ?? side)),
      new go.Binding("toSpot", "__ports", (ports: DiagramPortData[] | undefined) => toGoSpot(portForSide(ports, side)?.side ?? side))
    );

  const fixedPorts = [
    makePort("top", new go.Spot(0.5, 0, 0, -14)),
    makePort("right", new go.Spot(1, 0.5, 14, 0)),
    makePort("bottom", new go.Spot(0.5, 1, 0, 14)),
    makePort("left", new go.Spot(0, 0.5, -14, 0))
  ];

  const shouldShowToArrow = (link: DiagramLinkData) => link.showArrow !== false && (link.direction ?? "forward") !== "reverse";
  const shouldShowFromArrow = (link: DiagramLinkData) => link.showArrow !== false && ["reverse", "both"].includes(link.direction ?? "forward");

  next.nodeTemplate =
    $(go.Node, "Spot",
      {
        contextMenu: makeContextMenu(),
        locationSpot: go.Spot.Center,
        resizable: true,
        rotatable: true,
        rotateObjectName: "ROTATE_PANEL",
        rotationSpot: go.Spot.Center,
        resizeObjectName: "BODY",
        selectionObjectName: "ROTATE_PANEL",
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
      new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify),
      new go.Binding("visible", "runtime", (runtime) => props.mode === "edit" || runtime?.visible !== false),
      new go.Binding("zOrder", "zOrder", normalizeZOrder),
      $(go.Panel, "Spot",
        {
          name: "ROTATE_PANEL",
          isPanelMain: true,
          background: "transparent"
        },
        new go.Binding("angle", "angle", normalizeNodeAngle).makeTwoWay((angle) => Math.round(Number(angle) * 100) / 100),
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
            new go.Binding("stroke", "runtime", resolveNodeStatusColor),
            new go.Binding("strokeWidth", "runtime", (runtime) => hasNodeRuntimeStatus(runtime) ? 2 : 0),
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
          $(go.Panel, "Auto",
            {
              alignment: go.Spot.Center,
              stretch: go.GraphObject.Fill
            },
            new go.Binding("visible", "__isControl"),
            $(go.Shape, "RoundedRectangle",
              {
                fill: "#eff6ff",
                stroke: "#2563eb",
                strokeWidth: 1.5,
                parameter1: 6,
                stretch: go.GraphObject.Fill
              },
              new go.Binding("fill", "runtime", (runtime) => runtime?.backgroundColor || "#eff6ff"),
              new go.Binding("stroke", "runtime", (runtime) => runtime?.borderColor || "#2563eb")
            ),
            $(go.Panel, "Horizontal",
              {
                alignment: go.Spot.Center,
                margin: new go.Margin(5, 10, 5, 10)
              },
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
              stroke: "#111827",
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
            new go.Binding("text", "", resolveAnnotationText),
            new go.Binding("visible", "__isAnnotation")
          )
        ),
        ...fixedPorts.map((port) => port.copy())
      ),
      $(go.Panel, "Vertical",
        {
          alignment: new go.Spot(0.5, 1, 0, 8),
          alignmentFocus: go.Spot.Top,
          background: "transparent"
        },
        new go.Binding("visible", "", shouldShowNodeLabel),
        $(go.TextBlock,
          {
            margin: new go.Margin(0, 4, 0, 4),
            font: "600 13px sans-serif",
            stroke: "#111827",
            background: "transparent",
            textAlign: "center",
            maxLines: 1,
            overflow: go.TextBlock.OverflowEllipsis
          },
          new go.Binding("width", "size", getLabelWidth),
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
          new go.Binding("stroke", "runtime", resolveNodeStatusColor),
          new go.Binding("text", "runtime", (runtime) => runtime?.status ? `状态：${runtime.status}` : "")
        )
      )
    );

  next.groupTemplate =
    $(go.Group, "Spot",
      {
        contextMenu: makeContextMenu(),
        locationSpot: go.Spot.Center,
        computesBoundsAfterDrag: true,
        handlesDragDropForMembers: true,
        resizable: true,
        resizeObjectName: "BODY",
        selectionObjectName: "BODY",
        selectable: props.mode === "edit",
        memberValidation: (group, part) => {
          if (!(part instanceof go.Node) || part.data.key === group.data.key) return false;
          return canContainNode(nodeTypeOf(group.data.typeId), nodeTypeOf(part.data.typeId), part.data);
        },
        mouseDrop: () => {}
      },
      new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify),
      new go.Binding("zOrder", "zOrder", normalizeZOrder),
      $(go.Panel, "Auto",
        {
          name: "BODY"
        },
        new go.Binding("desiredSize", "size", go.Size.parse).makeTwoWay(go.Size.stringify),
        $(go.Shape, "RoundedRectangle",
          { fill: "#eef6ff", stroke: "#3b82f6", strokeWidth: 1.5 },
          new go.Binding("fill", "", resolveGroupFill),
          new go.Binding("stroke", "runtime", (runtime) => runtime?.borderColor || "#3b82f6"),
          new go.Binding("strokeDashArray", "", resolveGroupStrokeDash)
        ),
        $(go.Panel, "Vertical",
          $(go.TextBlock,
            { margin: 8, font: "700 13px sans-serif", alignment: go.Spot.Left },
            new go.Binding("text", "label"),
            new go.Binding("visible", "", shouldShowGroupLabel)
          ),
          $(go.Placeholder, { padding: 18 })
        )
      ),
      ...fixedPorts.map((port) => port.copy())
    );

  next.linkTemplate =
    $(go.Link,
      {
        contextMenu: makeContextMenu(),
        layerName: "",
        routing: go.Link.AvoidsNodes,
        curve: go.Link.None,
        corner: 0,
        fromEndSegmentLength: 14,
        relinkableFrom: true,
        relinkableTo: true,
        resegmentable: true,
        reshapable: true,
        selectable: props.mode === "edit",
        toEndSegmentLength: 14,
        zOrder: 0
      },
      new go.Binding("layerName", "", resolveLinkLayer),
      new go.Binding("points").makeTwoWay(),
      new go.Binding("zOrder", "", resolveLinkZOrder),
      $(go.Shape,
        {
          isPanelMain: true,
          stroke: "#42B0FF",
          strokeWidth: 2
        },
        new go.Binding("stroke", "", resolveLinkColor),
        new go.Binding("strokeWidth", "", resolveLinkWidth),
        new go.Binding("strokeDashArray", "defaultStyle", (style) => style?.dash || null)
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
        new go.Binding("stroke", "", resolveLinkColor),
        new go.Binding("strokeDashArray", "", resolveFlowLinkDash),
        new go.Binding("strokeWidth", "", resolveFlowLinkWidth)
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
    if (props.mode !== "edit" || applyingModel || !event.isTransactionFinished || !props.topologyData) return;

    const model = next.model as GoJS.GraphLinksModel;
    skipNextTopologyApply = true;
    emit("change", {
      ...props.topologyData,
      nodes: exportDiagramNodes(model),
      links: exportDiagramLinks(model)
    });
  });

  const normalizeLink = (link: GoJS.Link) => {
    const model = next.model as GoJS.GraphLinksModel;

    model.commit((m) => {
      if (!link.data.key) m.setDataProperty(link.data, "key", createLinkKey(model));
      if (!link.data.direction) m.setDataProperty(link.data, "direction", "forward");
      if (link.data.showArrow === undefined) m.setDataProperty(link.data, "showArrow", true);
      if (!link.data.linkType) m.setDataProperty(link.data, "linkType", "power-line");
      if (!link.data.defaultState) m.setDataProperty(link.data, "defaultState", "off");
      if (!link.data.defaultStyle) {
        m.setDataProperty(link.data, "defaultStyle", {
          color: "#42B0FF",
          width: 2,
          animated: false,
          flowDirection: "fromTo"
        });
      }
      if (!link.data.runtime) {
        m.setDataProperty(link.data, "runtime", {
          state: "off",
          color: "#42B0FF",
          width: 2,
          animated: false
        });
      }
    }, "normalize link data");
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

  next.addDiagramListener("ChangedSelection", () => {
    if (applyingModel) return;
    const part = next.selection.first();
    emit("selectionChange", part instanceof go.Node || part instanceof go.Link ? (part.data.key ?? "") : "");
  });

  next.addDiagramListener("InitialLayoutCompleted", () => {
    if (props.mode === "runtime") fitRuntimeView();
  });

  return next;
}

function createOverview(el: HTMLDivElement, observedDiagram: GoJS.Diagram) {
  const go = getGo();
  const $ = go.GraphObject.make;
  const nextOverview = $(go.Overview, el, {
    allowMove: true,
    allowSelect: true,
    isReadOnly: false,
    observed: observedDiagram,
    padding: 12,
    box:
      $(go.Part,
        {
          cursor: "move",
          locationObjectName: "VIEWPORT_BOX",
          movable: true,
          resizeObjectName: "VIEWPORT_BOX",
          selectable: true,
          selectionAdorned: false,
          selectionObjectName: "VIEWPORT_BOX"
        },
        $(go.Shape, "Rectangle", {
          name: "VIEWPORT_BOX",
          fill: "rgba(37, 99, 235, 0.12)",
          stroke: "#2563eb",
          strokeWidth: 2
        })
      )
  }) as GoJS.Overview;

  window.setTimeout(() => {
    nextOverview.requestUpdate();
    nextOverview.redraw();
  }, 0);

  return nextOverview;
}

function startFlowAnimation() {
  stopFlowAnimation();
  flowTimer = window.setInterval(() => {
    if (!diagram) return;
    flowOffset = (flowOffset + 1) % 36;
    diagram.links.each((link) => {
      const flow = link.findObject("FLOW") as GoJS.Shape | null;
      if (!flow || !link.data || !resolveLinkAnimated(link.data)) return;
      const direction = resolveLinkFlowDirection(link.data);
      const sign = direction === "toFrom" ? -1 : 1;
      flow.strokeDashOffset = direction === "both" ? flowOffset : flowOffset * sign;
    });
  }, 90);
}

function stopFlowAnimation() {
  if (flowTimer) window.clearInterval(flowTimer);
  flowTimer = undefined;
}

function applyTopology() {
  if (!diagram || !props.topologyData) return;
  const go = getGo();

  applyingModel = true;
  diagram.model = configureModel(new go.GraphLinksModel({
    nodeDataArray: buildDiagramNodes(props.topologyData.nodes),
    linkDataArray: buildDiagramLinks(props.topologyData.links)
  }));
  lastTopologyRenderSignature = getTopologyRenderSignature(props.topologyData);
  updateDiagramMode();
  syncSelectedPart();
  applyingModel = false;
  overview?.requestUpdate();
  overview?.redraw();
  if (props.mode === "runtime") window.setTimeout(fitRuntimeView, 80);
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

onMounted(() => {
  if (!canvasEl.value) return;
  diagram = createDiagram(canvasEl.value);
  if (overviewEl.value) overview = createOverview(overviewEl.value, diagram);
  applyTopology();
  startFlowAnimation();
});

onBeforeUnmount(() => {
  stopFlowAnimation();
  overview?.div && (overview.div = null);
  overview = null;
  diagram?.div && (diagram.div = null);
  diagram = null;
});

watch(() => props.topologyData, () => {
  const nextSignature = getTopologyRenderSignature(props.topologyData);
  if (skipNextTopologyApply) {
    skipNextTopologyApply = false;
    lastTopologyRenderSignature = nextSignature;
    return;
  }
  if (nextSignature === lastTopologyRenderSignature) {
    return;
  }
  applyTopology();
});

watch(() => props.mode, updateDiagramMode);

watch(() => props.nodeTypes, applyTopology, { deep: true });

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
    <div class="topology-miniview">
      <div class="miniview-title">导航</div>
      <div ref="overviewEl" class="topology-overview" />
    </div>
  </div>
</template>
