<script setup lang="ts">
import { normalizeExpressionPath, type FormFieldDefinition, type LinkRuntimeRule, type LinkStyle, type NodeLabelPosition, type NodeStatusKey, type NodeTypeDefinition, type TopologyData, type TopologyLink, type TopologyNode } from "@topo-editor/topology-shared";
import { ElMessage } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { uploadImageAsset } from "../../services/assetApi";

const props = defineProps<{
  topology: TopologyData | null;
  nodeTypes?: NodeTypeDefinition[];
  selectedNode?: TopologyNode | null;
  selectedLink?: TopologyLink | null;
}>();

const emit = defineEmits<{
  updateTopology: [patch: Partial<TopologyData>];
  updateNode: [key: string, patch: Partial<TopologyNode>];
  updateLink: [key: string, patch: Partial<TopologyLink>];
  selectItem: [key: string];
  previewLinkStyle: [key: string, style: LinkStyle];
  clearLinkStylePreview: [key?: string];
}>();

type RuleFieldType = "string" | "number" | "boolean" | "enum" | "date" | "unknown";

type RuleFieldOption = {
  field: string;
  label: string;
  type?: RuleFieldType;
  options?: Array<string | number | boolean>;
};

type NodeTreeRow = {
  node: TopologyNode;
  level: number;
};

type ActiveDrawer = "" | "nodeEvent" | "nodeRule" | "buttonVisibilityRule" | "linkAdvancedStyle" | "linkRule";

const runningRuleForm = reactive({
  nodeKey: "",
  sourceId: "",
  field: "state",
  customField: "",
  value: "closed",
  lineState: "off" as NonNullable<LinkRuntimeRule["action"]["state"]>,
  priority: 10,
  overrideMainStyle: true,
  color: "#42B0FF",
  width: 3,
  opacity: 1,
  lineCap: "butt" as NonNullable<LinkStyle["lineCap"]>,
  dash: undefined as number[] | undefined,
  overrideFlowStyle: true,
  animated: false,
  flowDirection: "fromTo" as LinkStyle["flowDirection"],
  flowColor: "#ffffff",
  flowWidth: 3,
  flowOpacity: 0.85,
  flowDash: [9, 9] as number[] | undefined,
  flowSpeed: 4
});
let activeRuleLinkKey = "";
const activeLinkPreview = ref<{ linkKey: string; source: "form" | "rule"; ruleId?: string } | null>(null);

const linkDashPresets = [
  { label: "实线", value: "solid", dash: undefined },
  { label: "短虚线", value: "short-dashed", dash: [9, 9] },
  { label: "长虚线", value: "long-dashed", dash: [16, 10] },
  { label: "点线", value: "dotted", dash: [2, 6] },
  { label: "点划线", value: "dashdot", dash: [12, 6, 2, 6] },
  { label: "自定义", value: "custom", dash: undefined }
] as const;

const nodeStatusRuleForm = reactive({
  sourceId: "",
  field: "status",
  customField: "",
  value: "normal",
  priority: 10,
  status: "default",
  color: "#94a3b8"
});
let activeRuleNodeKey = "";

const buttonVisibilityRuleForm = reactive({
  sourceType: "metaData" as "metaData" | "node",
  metaField: "qfStatus.button1",
  nodeKey: "",
  sourceId: "",
  field: "status",
  customField: "",
  value: "show",
  visible: true,
  priority: 10
});

const nodeEventForm = reactive({
  enabled: true,
  trigger: "click" as NonNullable<TopologyNode["eventConfig"]>[number]["trigger"],
  eventName: "nodeClick",
  eventKey: "",
  eventDataText: "{}",
  eventDataTemplateText: "{}",
  bindNodeKey: "",
  bindDataPath: ""
});

const nodeStatusOptions: Array<{ label: string; value: NodeStatusKey; color: string }> = [
  { label: "默认", value: "default", color: "#94a3b8" },
  { label: "运行", value: "running", color: "#22c55e" },
  { label: "故障", value: "fault", color: "#ef4444" },
  { label: "离线", value: "offline", color: "#64748b" }
];

const linkStateOptions: Array<{ label: string; value: NonNullable<LinkRuntimeRule["action"]["state"]>; color: string }> = [
  { label: "默认", value: "off", color: "#42B0FF" },
  { label: "运行", value: "running", color: "#22c55e" },
  { label: "告警", value: "warning", color: "#f59e0b" },
  { label: "故障", value: "fault", color: "#ef4444" },
  { label: "离线", value: "offline", color: "#64748b" }
];

const nodeLabelPositionOptions: Array<{ label: string; value: NodeLabelPosition }> = [
  { label: "上", value: "top" },
  { label: "右", value: "right" },
  { label: "下", value: "bottom" },
  { label: "左", value: "left" }
];
const buttonImageInputRef = ref<HTMLInputElement | null>(null);
const uploadingButtonImage = ref(false);
const activeNodeTab = ref("base");
const activeGroupTab = ref("base");
const activeLinkTab = ref("style");
const activeDrawer = ref<ActiveDrawer>("");

function openDrawer(drawer: ActiveDrawer) {
  activeDrawer.value = drawer;
}

function closeDrawer() {
  activeDrawer.value = "";
}

function handleDrawerModelValue(value: boolean) {
  if (!value) closeDrawer();
}

function updateTopologyName(value: string) {
  if (!value.trim()) return;
  emit("updateTopology", { name: value.trim() });
}

function updateTopologyVersion(value: string) {
  if (!value.trim()) return;
  emit("updateTopology", { version: value.trim() });
}

function parseSize(size?: string) {
  const [width, height] = (size ?? "").split(/\s+/).map((item) => Number(item));
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 0
  };
}

function updateLabel(value: string) {
  if (!props.selectedNode || !value.trim()) return;
  emit("updateNode", props.selectedNode.key, { label: value.trim() });
}

function nodeIdentifier(node: TopologyNode) {
  const identifier = node.props?.identifier;
  return typeof identifier === "string" ? identifier : "";
}

function updateIdentifier(value: string) {
  if (!props.selectedNode) return;
  emit("updateNode", props.selectedNode.key, {
    props: {
      ...(props.selectedNode.props ?? {}),
      identifier: value.trim()
    }
  });
}

function updateSelectedNodeProps(patch: Record<string, unknown>) {
  if (!props.selectedNode) return;
  emit("updateNode", props.selectedNode.key, {
    props: {
      ...(props.selectedNode.props ?? {}),
      ...patch
    }
  });
}

function isTemplateManagedFormField(fieldName: string) {
  const nodeType = selectedNodeType.value;
  if (!nodeType) return false;

  if (nodeType.category === "annotation") {
    return ["textTemplate", "textColor", "textSize"].includes(fieldName);
  }

  if (nodeType.category === "control" || nodeType.template === "buttonTemplate") {
    return [
      "buttonText",
      "buttonRenderMode",
      "icon",
      "buttonDefaultVisible",
      "buttonStyleBackgroundColor",
      "buttonStyleBorderColor",
      "buttonStyleTextColor",
      "buttonStyleTextSize",
      "buttonStyleBorderWidth",
      "buttonStyleBorderRadius",
      "buttonStylePaddingX",
      "buttonStylePaddingY"
    ].includes(fieldName);
  }

  if (props.selectedNode?.isGroup) {
    return ["transparentBackground", "backgroundOpacity", "dashedBorder"].includes(fieldName);
  }

  return false;
}

function rawDynamicFormFieldValue(node: TopologyNode, field: FormFieldDefinition) {
  return node.props && Object.prototype.hasOwnProperty.call(node.props, field.field)
    ? node.props[field.field]
    : field.defaultValue;
}

function dynamicFormFieldValue(node: TopologyNode, field: FormFieldDefinition) {
  const value = rawDynamicFormFieldValue(node, field);
  if (value === undefined || value === null) return "";
  return String(value);
}

function dynamicFormBooleanValue(node: TopologyNode, field: FormFieldDefinition) {
  const value = rawDynamicFormFieldValue(node, field);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

function dynamicFormColorValue(node: TopologyNode, field: FormFieldDefinition) {
  const value = dynamicFormFieldValue(node, field).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
}

function normalizeDynamicFormValue(field: FormFieldDefinition, value: string | boolean) {
  if (field.type === "boolean") return Boolean(value);
  if (typeof value !== "string") return value;

  if (field.type === "number") {
    if (!value.trim()) return "";
    const nextValue = Number(value);
    return Number.isFinite(nextValue) ? nextValue : "";
  }

  if (field.type === "select") {
    const option = field.options?.find((item) => String(item.value) === value);
    return option ? option.value : value;
  }

  return value;
}

function updateDynamicFormField(field: FormFieldDefinition, value: string | boolean) {
  updateSelectedNodeProps({
    [field.field]: normalizeDynamicFormValue(field, value)
  });
}

function nodeTextTemplate(node: TopologyNode) {
  const template = node.props?.textTemplate;
  return typeof template === "string" ? template : "";
}

function nodeTextColor(node: TopologyNode) {
  const color = node.props?.textColor;
  if (typeof color === "string" && color.trim()) return color;
  return selectedNodeType.value?.annotationDefaults?.textColor ?? "#111827";
}

function nodeTextSize(node: TopologyNode) {
  const size = Number(node.props?.textSize);
  if (Number.isFinite(size) && size > 0) return Math.round(size);
  return Math.round(selectedNodeType.value?.annotationDefaults?.textSize ?? 14);
}

function updateAnnotationTextTemplate(value: string) {
  updateSelectedNodeProps({ textTemplate: value });
}

function updateAnnotationTextColor(value: string) {
  updateSelectedNodeProps({ textColor: value });
}

function updateAnnotationTextSize(value: string) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return;
  updateSelectedNodeProps({ textSize: Math.round(size) });
}

function buttonRenderMode(node: TopologyNode) {
  const mode = node.props?.buttonRenderMode;
  if (mode === "image" || mode === "imageText" || mode === "text") return mode;
  const defaultMode = selectedNodeType.value?.buttonDefaults?.buttonRenderMode;
  return defaultMode === "image" || defaultMode === "imageText" || defaultMode === "text" ? defaultMode : "text";
}

function buttonText(node: TopologyNode) {
  const text = node.props?.buttonText;
  if (typeof text === "string") return text;
  return selectedNodeType.value?.buttonDefaults?.buttonText ?? node.label;
}

function buttonImage(node: TopologyNode) {
  const icon = node.props?.icon;
  if (typeof icon === "string") return icon;
  return selectedNodeType.value?.buttonDefaults?.icon ?? selectedNodeType.value?.icon ?? "";
}

function buttonDefaultVisible(node: TopologyNode) {
  const value = node.props?.buttonDefaultVisible;
  if (typeof value === "boolean") return value;
  return selectedNodeType.value?.buttonDefaults?.buttonDefaultVisible ?? true;
}

function buttonStyleString(node: TopologyNode, field: string, fallback: string) {
  const value = node.props?.[field];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function buttonStyleNumber(node: TopologyNode, field: string, fallback: number) {
  const value = Number(node.props?.[field]);
  return Number.isFinite(value) ? value : fallback;
}

function buttonStyleBackgroundColor(node: TopologyNode) {
  return buttonStyleString(node, "buttonStyleBackgroundColor", selectedNodeType.value?.buttonStyleDefaults?.backgroundColor ?? "#eff6ff");
}

function buttonStyleBorderColor(node: TopologyNode) {
  return buttonStyleString(node, "buttonStyleBorderColor", selectedNodeType.value?.buttonStyleDefaults?.borderColor ?? "#2563eb");
}

function buttonStyleTextColor(node: TopologyNode) {
  return buttonStyleString(node, "buttonStyleTextColor", selectedNodeType.value?.buttonStyleDefaults?.textColor ?? "#1d4ed8");
}

function buttonStyleTextSize(node: TopologyNode) {
  return Math.max(1, Math.round(buttonStyleNumber(node, "buttonStyleTextSize", selectedNodeType.value?.buttonStyleDefaults?.textSize ?? 13)));
}

function buttonStyleBorderWidth(node: TopologyNode) {
  return Math.max(0, buttonStyleNumber(node, "buttonStyleBorderWidth", selectedNodeType.value?.buttonStyleDefaults?.borderWidth ?? 1.5));
}

function buttonStyleBorderRadius(node: TopologyNode) {
  return Math.max(0, Math.round(buttonStyleNumber(node, "buttonStyleBorderRadius", selectedNodeType.value?.buttonStyleDefaults?.borderRadius ?? 6)));
}

function buttonStylePaddingX(node: TopologyNode) {
  return Math.max(0, Math.round(buttonStyleNumber(node, "buttonStylePaddingX", selectedNodeType.value?.buttonStyleDefaults?.paddingX ?? 10)));
}

function buttonStylePaddingY(node: TopologyNode) {
  return Math.max(0, Math.round(buttonStyleNumber(node, "buttonStylePaddingY", selectedNodeType.value?.buttonStyleDefaults?.paddingY ?? 5)));
}

function updateButtonText(value: string) {
  updateSelectedNodeProps({ buttonText: value });
}

function updateButtonRenderMode(value: string) {
  updateSelectedNodeProps({ buttonRenderMode: value });
}

function updateButtonImage(value: string) {
  updateSelectedNodeProps({ icon: value });
}

function updateButtonStyleColor(field: string, value: string) {
  updateSelectedNodeProps({ [field]: value });
}

function updateButtonStyleNumber(field: string, value: string, min = 0) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return;
  updateSelectedNodeProps({ [field]: Math.max(min, nextValue) });
}

function chooseButtonImage() {
  buttonImageInputRef.value?.click();
}

async function handleButtonImageChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const isSvg = file.name.toLowerCase().endsWith(".svg");
  if (!file.type.startsWith("image/") && !isSvg) {
    ElMessage.error("请选择图片文件");
    return;
  }

  uploadingButtonImage.value = true;
  try {
    const result = await uploadImageAsset(file);
    updateButtonImage(result.url);
    ElMessage.success("按钮图片已上传");
  } finally {
    uploadingButtonImage.value = false;
  }
}

function updateShowLabel(value: boolean) {
  updateSelectedNodeProps({ showLabel: value });
}

function nodeLabelPosition(node: TopologyNode): NodeLabelPosition {
  return node.labelPosition ?? "bottom";
}

function updateLabelPosition(value: string) {
  if (!props.selectedNode || !nodeLabelPositionOptions.some((option) => option.value === value)) return;
  emit("updateNode", props.selectedNode.key, { labelPosition: value as NodeLabelPosition });
}

function updateTransparentBackground(value: boolean) {
  updateSelectedNodeProps({ transparentBackground: value });
}

function groupBackgroundColor(node: TopologyNode) {
  return node.runtime?.backgroundColor ?? selectedNodeType.value?.groupStyleDefaults?.backgroundColor ?? "#eef6ff";
}

function groupBorderColor(node: TopologyNode) {
  return node.runtime?.borderColor ?? selectedNodeType.value?.groupStyleDefaults?.borderColor ?? "#3b82f6";
}

function groupBackgroundOpacity(node: TopologyNode) {
  const opacity = Number(node.props?.backgroundOpacity ?? selectedNodeType.value?.groupStyleDefaults?.backgroundOpacity);
  return Number.isFinite(opacity) ? Math.max(0, Math.min(100, Math.round(opacity))) : 100;
}

function updateBackgroundOpacity(value: string) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return;
  updateSelectedNodeProps({ backgroundOpacity: Math.max(0, Math.min(100, Math.round(opacity))) });
}

function updateDashedBorder(value: boolean) {
  updateSelectedNodeProps({ dashedBorder: value });
}

function groupTransparentBackground(node: TopologyNode) {
  const value = node.props?.transparentBackground;
  if (typeof value === "boolean") return value;
  return selectedNodeType.value?.groupStyleDefaults?.transparentBackground === true;
}

function groupDashedBorder(node: TopologyNode) {
  const value = node.props?.dashedBorder;
  if (typeof value === "boolean") return value;
  return selectedNodeType.value?.groupStyleDefaults?.dashedBorder === true;
}

function updateSize(field: "width" | "height", value: string) {
  if (!props.selectedNode) return;
  const size = parseSize(props.selectedNode.size);
  const nextValue = Math.round(Number(value) || 0);
  if (nextValue <= 0) return;
  const nextSize = { ...size, [field]: nextValue };
  emit("updateNode", props.selectedNode.key, { size: `${nextSize.width} ${nextSize.height}` });
}

function updateAngle(value: string) {
  if (!props.selectedNode || props.selectedNode.isGroup) return;
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return;
  emit("updateNode", props.selectedNode.key, { angle: Math.round(nextValue * 100) / 100 });
}

function nodeZOrder(node: TopologyNode) {
  return Number.isFinite(node.zOrder) ? Number(node.zOrder) : 0;
}

function orderedLayerNodes() {
  return [...(props.topology?.nodes ?? [])].sort((left, right) => {
    const delta = nodeZOrder(left) - nodeZOrder(right);
    return delta || left.key.localeCompare(right.key);
  });
}

function updateNodeZOrder(zOrder: number) {
  if (!props.selectedNode) return;
  emit("updateNode", props.selectedNode.key, { zOrder });
}

function moveSelectedLayer(direction: "up" | "down") {
  if (!props.selectedNode) return;
  const ordered = orderedLayerNodes();
  const index = ordered.findIndex((node) => node.key === props.selectedNode?.key);
  const targetIndex = direction === "up" ? index + 1 : index - 1;
  const target = ordered[targetIndex];
  if (index < 0 || !target) return;
  updateNodeZOrder(nodeZOrder(target));
  emit("updateNode", target.key, { zOrder: nodeZOrder(props.selectedNode) });
}

function moveSelectedToTop() {
  if (!props.selectedNode) return;
  const maxZOrder = Math.max(0, ...(props.topology?.nodes ?? []).map(nodeZOrder));
  updateNodeZOrder(maxZOrder + 1);
}

function moveSelectedToBottom() {
  if (!props.selectedNode) return;
  const minZOrder = Math.min(0, ...(props.topology?.nodes ?? []).map(nodeZOrder));
  updateNodeZOrder(minZOrder - 1);
}

function updateRuntimeColor(field: "backgroundColor" | "borderColor", value: string) {
  if (!props.selectedNode) return;
  emit("updateNode", props.selectedNode.key, {
    runtime: {
      ...props.selectedNode.runtime,
      [field]: value
    }
  });
}

function updateLinkLabel(value: string) {
  if (!props.selectedLink) return;
  emit("updateLink", props.selectedLink.key, { label: value.trim() || undefined });
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonObject(value: string) {
  try {
    const parsed = value.trim() ? JSON.parse(value) : {};
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function defaultEventKey(node: TopologyNode) {
  return nodeIdentifier(node) || node.key;
}

function resetNodeEventForm(node: TopologyNode) {
  nodeEventForm.enabled = true;
  nodeEventForm.trigger = "click";
  nodeEventForm.eventName = "nodeClick";
  nodeEventForm.eventKey = defaultEventKey(node);
  nodeEventForm.eventDataText = "{}";
  nodeEventForm.eventDataTemplateText = "{}";
  nodeEventForm.bindNodeKey = node.key;
  nodeEventForm.bindDataPath = "";
}

function addNodeEventConfig() {
  if (!props.selectedNode || !nodeEventForm.eventName.trim() || !nodeEventForm.eventKey.trim()) return;
  const eventData = parseJsonObject(nodeEventForm.eventDataText);
  const eventDataTemplate = parseJsonObject(nodeEventForm.eventDataTemplateText);
  if (!eventData || !eventDataTemplate) return;

  emit("updateNode", props.selectedNode.key, {
    eventConfig: [
      ...(props.selectedNode.eventConfig ?? []),
      {
        id: createRuleId("node_event"),
        enabled: nodeEventForm.enabled,
        trigger: nodeEventForm.trigger,
        eventName: nodeEventForm.eventName.trim(),
        eventKey: nodeEventForm.eventKey.trim(),
        eventData,
        eventDataTemplate,
        bindNodeKey: nodeEventForm.bindNodeKey || undefined,
        bindDataPath: nodeEventForm.bindDataPath.trim() || undefined
      }
    ]
  });
}

function removeNodeEventConfig(eventId: string | undefined, index: number) {
  if (!props.selectedNode) return;
  emit("updateNode", props.selectedNode.key, {
    eventConfig: (props.selectedNode.eventConfig ?? []).filter((event, eventIndex) => {
      return eventId ? event.id !== eventId : eventIndex !== index;
    })
  });
}

function describeNodeEventConfig(event: NonNullable<TopologyNode["eventConfig"]>[number]) {
  return `${event.trigger} / ${event.eventName} / ${event.eventKey}`;
}

function updateLinkDirection(value: TopologyLink["direction"]) {
  if (!props.selectedLink || !value) return;
  emit("updateLink", props.selectedLink.key, { direction: value });
}

function updateLinkArrow(value: boolean) {
  if (!props.selectedLink) return;
  emit("updateLink", props.selectedLink.key, { showArrow: value });
}

function updateLinkDefaultStyle(field: keyof LinkStyle, value: LinkStyle[keyof LinkStyle]) {
  if (!props.selectedLink) return;
  emit("updateLink", props.selectedLink.key, {
    defaultStyle: {
      ...(props.selectedLink.defaultStyle ?? {}),
      [field]: value
    }
  });
}

function updateLinkGlowStyle(field: keyof NonNullable<LinkStyle["glow"]>, value: string | number | boolean) {
  if (!props.selectedLink) return;
  emit("updateLink", props.selectedLink.key, {
    defaultStyle: {
      ...(props.selectedLink.defaultStyle ?? {}),
      glow: {
        ...(props.selectedLink.defaultStyle?.glow ?? {}),
        [field]: value
      }
    }
  });
}

function updateLinkFlowStyle(field: keyof NonNullable<LinkStyle["flow"]>, value: string | number | number[] | undefined) {
  if (!props.selectedLink) return;
  emit("updateLink", props.selectedLink.key, {
    defaultStyle: {
      ...(props.selectedLink.defaultStyle ?? {}),
      flow: {
        ...(props.selectedLink.defaultStyle?.flow ?? {}),
        [field]: value
      }
    }
  });
}

function updateLinkFlowDirection(value: LinkStyle["flowDirection"]) {
  if (!value) return;
  updateLinkDefaultStyle("flowDirection", value);
}

function dashForPreset(value: string, fallback: number[] | undefined) {
  if (value === "custom") return fallback?.length ? [...fallback] : [9, 9];
  const preset = linkDashPresets.find((item) => item.value === value);
  return preset?.dash ? [...preset.dash] : undefined;
}

function updateLinkDashPreset(value: string) {
  updateLinkDefaultStyle("dash", dashForPreset(value, props.selectedLink?.defaultStyle?.dash));
}

function updateLinkFlowDashPreset(value: string) {
  updateLinkFlowStyle("dash", dashForPreset(value, props.selectedLink?.defaultStyle?.flow?.dash));
}

function updateRunningRuleDashPreset(value: string) {
  runningRuleForm.dash = dashForPreset(value, runningRuleForm.dash);
}

function updateRunningRuleFlowDashPreset(value: string) {
  runningRuleForm.flowDash = dashForPreset(value, runningRuleForm.flowDash);
}

function linkDashPresetValue(dash?: number[]) {
  if (!dash?.length) return "solid";
  const current = dash?.join(",");
  return linkDashPresets.find((item) => item.value !== "custom" && item.dash?.join(",") === current)?.value ?? "custom";
}

function dashText(dash?: number[]) {
  return dash?.join(", ") ?? "";
}

function parseDashText(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parts = normalized.replace(/^\[|\]$/g, "").split(/[\s,，]+/).filter(Boolean);
  const dash = parts.map((item) => Number(item));
  if (!dash.length || dash.some((item) => !Number.isFinite(item) || item < 0)) return null;
  return dash;
}

function updateLinkDashFromText(value: string) {
  const dash = parseDashText(value);
  if (dash === null) {
    ElMessage.warning("请输入有效的虚线数组，例如 9, 9");
    return;
  }
  updateLinkDefaultStyle("dash", dash);
}

function updateLinkFlowDashFromText(value: string) {
  const dash = parseDashText(value);
  if (dash === null) {
    ElMessage.warning("请输入有效的流线虚线数组，例如 9, 9");
    return;
  }
  updateLinkFlowStyle("dash", dash);
}

function updateRunningRuleDashFromText(value: string) {
  const dash = parseDashText(value);
  if (dash === null) {
    ElMessage.warning("请输入有效的主线虚线数组，例如 9, 9");
    return;
  }
  runningRuleForm.dash = dash;
}

function updateRunningRuleFlowDashFromText(value: string) {
  const dash = parseDashText(value);
  if (dash === null) {
    ElMessage.warning("请输入有效的流线虚线数组，例如 9, 9");
    return;
  }
  runningRuleForm.flowDash = dash;
}

function percentToOpacity(value: string) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 1;
  return Math.max(0, Math.min(1, percent / 100));
}

function numberInRange(value: string | number, min: number, max: number, fallback: number) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return fallback;
  return Math.max(min, Math.min(max, nextValue));
}

function opacityToPercent(value: number | undefined, fallback = 1) {
  return Math.round((value ?? fallback) * 100);
}

function createRuleId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.round(Math.random() * 1000)}`;
}

const availableRuleNodes = computed(() => props.topology?.nodes ?? []);

const ruleDataSources = computed(() => (props.topology?.dataSources ?? []).filter((source) => source.enabled !== false));

const showRuleSourceSelect = computed(() => ruleDataSources.value.length > 1);

const selectedRuleNode = computed(() => nodeByKey(runningRuleForm.nodeKey));

const selectedRuleNodeFieldOptions = computed(() => fieldOptionsForNode(selectedRuleNode.value));

const selectedNodeFieldOptions = computed(() => fieldOptionsForNode(props.selectedNode ?? null));

const selectedButtonRuleNode = computed(() => nodeByKey(buttonVisibilityRuleForm.nodeKey));

const selectedButtonRuleNodeFieldOptions = computed(() => fieldOptionsForNode(selectedButtonRuleNode.value));

const activeKey = computed(() => props.selectedNode?.key ?? props.selectedLink?.key ?? "");

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

function selectItem(key: string) {
  emit("selectItem", key);
}

function nodeTreeTypeLabel(node: TopologyNode) {
  if (node.isGroup) return "组";
  const nodeType = nodeTypeOf(node.typeId);
  if (nodeType?.category === "annotation") return "标注";
  return "节点";
}

function linkTreeLabel(link: TopologyLink) {
  return link.label || `${nodeByKey(link.from)?.label ?? link.from} -> ${nodeByKey(link.to)?.label ?? link.to}`;
}

function nodeByKey(key: string) {
  return props.topology?.nodes.find((node) => node.key === key) ?? null;
}

function nodeTypeOf(typeId: string) {
  return props.nodeTypes?.find((nodeType) => nodeType.id === typeId);
}

const selectedNodeType = computed(() => props.selectedNode ? nodeTypeOf(props.selectedNode.typeId) : undefined);

const isSelectedAnnotationNode = computed(() => selectedNodeType.value?.category === "annotation");

const isSelectedControlNode = computed(() => selectedNodeType.value?.category === "control" || selectedNodeType.value?.template === "buttonTemplate");

const selectedDynamicFormFields = computed(() => {
  return (selectedNodeType.value?.formSchema ?? []).filter((field) => !isTemplateManagedFormField(field.field));
});

const canPositionSelectedNodeLabel = computed(() => !!props.selectedNode && !props.selectedNode.isGroup && !isSelectedAnnotationNode.value && !isSelectedControlNode.value);

const availableParentGroups = computed(() => {
  const selected = props.selectedNode ?? null;
  if (!selected) return [];
  return (props.topology?.nodes ?? []).filter((node) => canAssignToGroup(selected, node));
});

const selectedNodeStatusOptions = computed(() => nodeStatusOptions.map((status) => ({
  ...status,
  image: selectedNodeType.value?.statusImages?.[status.value]
})));

const selectedNodeStatusOption = computed(() => {
  return selectedNodeStatusOptions.value.find((status) => status.value === nodeStatusRuleForm.status)
    ?? selectedNodeStatusOptions.value[0];
});

function isImageIcon(icon?: string) {
  return !!icon && (
    /^https?:\/\//.test(icon)
    || icon.startsWith("data:image/")
    || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(icon)
  );
}

function isInGroupChain(node: TopologyNode, groupKey: string) {
  let currentGroupKey = node.group;
  while (currentGroupKey) {
    if (currentGroupKey === groupKey) return true;
    currentGroupKey = nodeByKey(currentGroupKey)?.group;
  }
  return false;
}

function canAssignToGroup(node: TopologyNode | null, groupNode: TopologyNode) {
  if (!node || !groupNode.isGroup || node.key === groupNode.key) return false;
  if (node.isGroup && isInGroupChain(groupNode, node.key)) return false;
  const groupType = nodeTypeOf(groupNode.typeId);
  const nodeType = nodeTypeOf(node.typeId);
  if (!groupType || !nodeType) return false;
  if (nodeType.isGroup && !groupType.allowNestedGroup) return false;
  if (!groupType.canContain?.length) return true;
  return groupType.canContain.includes(nodeType.id) || groupType.canContain.includes(nodeType.category);
}

function updateNodeGroup(groupKey: string) {
  if (!props.selectedNode) return;
  emit("updateNode", props.selectedNode.key, { group: groupKey || undefined });
}

function addFieldOption(options: RuleFieldOption[], option: RuleFieldOption) {
  if (!option.field || options.some((item) => item.field === option.field)) return;
  options.push(option);
}

function fieldOptionsForNode(node: TopologyNode | null): RuleFieldOption[] {
  if (!node) return [{ field: "state", label: "状态", type: "string" }];

  const options: RuleFieldOption[] = [];

  for (const [alias, path] of Object.entries(node.dataBinding?.mappings ?? {})) {
    addFieldOption(options, {
      field: alias,
      label: `${alias}${path && path !== alias ? `（${path}）` : ""}`,
      type: "unknown"
    });
  }

  for (const key of Object.keys(node.props ?? {})) {
    addFieldOption(options, { field: key, label: key, type: "unknown" });
  }

  for (const key of Object.keys(node.runtime ?? {})) {
    addFieldOption(options, { field: key, label: `运行态.${key}`, type: "unknown" });
  }

  addFieldOption(options, { field: "state", label: "状态", type: "string" });
  return options;
}

function selectedRuleFieldOption() {
  if (runningRuleForm.field === "__custom__") return undefined;
  return selectedRuleNodeFieldOptions.value.find((option) => option.field === runningRuleForm.field);
}

function selectedNodeRuleFieldOption() {
  if (nodeStatusRuleForm.field === "__custom__") return undefined;
  return selectedNodeFieldOptions.value.find((option) => option.field === nodeStatusRuleForm.field);
}

function selectedButtonRuleFieldOption() {
  if (buttonVisibilityRuleForm.field === "__custom__") return undefined;
  return selectedButtonRuleNodeFieldOptions.value.find((option) => option.field === buttonVisibilityRuleForm.field);
}

function effectiveRunningRuleField() {
  return runningRuleForm.field === "__custom__"
    ? runningRuleForm.customField.trim()
    : runningRuleForm.field;
}

function effectiveNodeStatusRuleField() {
  return nodeStatusRuleForm.field === "__custom__"
    ? nodeStatusRuleForm.customField.trim()
    : nodeStatusRuleForm.field;
}

function effectiveButtonVisibilityRuleField() {
  if (buttonVisibilityRuleForm.sourceType === "metaData") return buttonVisibilityRuleForm.metaField.trim();
  return buttonVisibilityRuleForm.field === "__custom__"
    ? buttonVisibilityRuleForm.customField.trim()
    : buttonVisibilityRuleForm.field;
}

function isAbsoluteRuleField(field: string) {
  const normalizedField = normalizeExpressionPath(field);
  const target = normalizedField.split(".")[0];
  if (!target || target === normalizedField) return false;
  if (["metaData", "mateData", "runtimeData"].includes(target)) return true;
  if (props.topology?.nodes.some((node) => node.key === target)) return true;
  if (props.topology?.dataSources?.some((source) => source.sourceId === target)) return true;
  return false;
}

function scopedRuleField(scopeKey: string, field: string) {
  const normalizedField = normalizeExpressionPath(field);
  if (isAbsoluteRuleField(normalizedField) || !scopeKey) return normalizedField;
  return `${scopeKey}.${normalizedField}`;
}

function normalizeDataKey(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function preferredNodeDataKey(node: TopologyNode | null) {
  const configuredIdentifier = typeof node?.props?.identifier === "string" ? node.props.identifier : "";
  if (normalizeDataKey(configuredIdentifier)) return normalizeDataKey(configuredIdentifier);
  return normalizeDataKey(node?.label)
    || normalizeDataKey(node?.key)
    || normalizeDataKey(node?.typeId);
}

function expressionFieldWithSource(node: TopologyNode | null, field: string, sourceId: string) {
  const normalizedField = normalizeExpressionPath(field);
  if (isAbsoluteRuleField(normalizedField)) return normalizedField;
  if (!sourceId) return scopedRuleField(node?.key ?? "", normalizedField);
  if (normalizedField.includes(".")) return `${sourceId}.${normalizedField}`;
  const dataKey = preferredNodeDataKey(node);
  return dataKey ? `${sourceId}.data.${dataKey}.${normalizedField}` : `${sourceId}.${normalizedField}`;
}

function defaultRuleSourceId(node: TopologyNode | null) {
  if (node?.dataBinding?.sourceId && ruleDataSources.value.some((source) => source.sourceId === node.dataBinding?.sourceId)) {
    return node.dataBinding.sourceId;
  }
  return ruleDataSources.value[0]?.sourceId ?? "";
}

function ensureRuleSourceSelection() {
  if (!showRuleSourceSelect.value) {
    nodeStatusRuleForm.sourceId = "";
    runningRuleForm.sourceId = "";
    buttonVisibilityRuleForm.sourceId = "";
    return;
  }
  if (!ruleDataSources.value.some((source) => source.sourceId === nodeStatusRuleForm.sourceId)) {
    nodeStatusRuleForm.sourceId = defaultRuleSourceId(props.selectedNode ?? null);
  }
  if (!ruleDataSources.value.some((source) => source.sourceId === runningRuleForm.sourceId)) {
    runningRuleForm.sourceId = defaultRuleSourceId(selectedRuleNode.value);
  }
  if (!ruleDataSources.value.some((source) => source.sourceId === buttonVisibilityRuleForm.sourceId)) {
    buttonVisibilityRuleForm.sourceId = defaultRuleSourceId(selectedButtonRuleNode.value);
  }
}

function normalizeValueForField(field: RuleFieldOption | undefined, value: string) {
  if (field?.type === "number") {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) ? nextValue : value;
  }
  if (field?.type === "boolean") return value === "true";

  const optionValue = field?.options?.find((option) => String(option) === value);
  return optionValue ?? value;
}

function normalizeRuleValue(value: string) {
  return normalizeValueForField(selectedRuleFieldOption(), value);
}

function normalizeNodeStatusRuleValue(value: string) {
  return normalizeValueForField(selectedNodeRuleFieldOption(), value);
}

function normalizeButtonVisibilityRuleValue(value: string) {
  return normalizeValueForField(
    buttonVisibilityRuleForm.sourceType === "node" ? selectedButtonRuleFieldOption() : undefined,
    value
  );
}

function updateRunningRuleNode(nodeKey: string) {
  runningRuleForm.nodeKey = nodeKey;
  const fields = selectedRuleNodeFieldOptions.value;
  if (!fields.some((field) => field.field === runningRuleForm.field)) {
    runningRuleForm.field = fields[0]?.field ?? "state";
  }
  if (showRuleSourceSelect.value) runningRuleForm.sourceId = defaultRuleSourceId(selectedRuleNode.value);
}

function updateButtonVisibilityRuleNode(nodeKey: string) {
  buttonVisibilityRuleForm.nodeKey = nodeKey;
  const fields = selectedButtonRuleNodeFieldOptions.value;
  if (!fields.some((field) => field.field === buttonVisibilityRuleForm.field)) {
    buttonVisibilityRuleForm.field = fields.some((field) => field.field === "status")
      ? "status"
      : fields[0]?.field ?? "status";
  }
  if (showRuleSourceSelect.value) buttonVisibilityRuleForm.sourceId = defaultRuleSourceId(selectedButtonRuleNode.value);
}

function updateButtonVisibilityRuleField(field: string) {
  buttonVisibilityRuleForm.field = field;
  const option = selectedButtonRuleFieldOption();
  if (option?.options?.length) buttonVisibilityRuleForm.value = String(option.options[0]);
  else if (option?.type === "boolean") buttonVisibilityRuleForm.value = "true";
}

function updateNodeStatusRuleField(field: string) {
  nodeStatusRuleForm.field = field;
  const option = selectedNodeRuleFieldOption();
  if (option?.options?.length) nodeStatusRuleForm.value = String(option.options[0]);
  else if (option?.type === "boolean") nodeStatusRuleForm.value = "true";
}

function updateNodeRuleStatus(status: string) {
  nodeStatusRuleForm.status = status;
  const option = selectedNodeStatusOptions.value.find((item) => item.value === status);
  if (option) nodeStatusRuleForm.color = option.color;
}

function updateLinkRuleState(state: NonNullable<LinkRuntimeRule["action"]["state"]>) {
  runningRuleForm.lineState = state;
  const option = linkStateOptions.find((item) => item.value === state);
  if (option) runningRuleForm.color = option.color;
  if (state === "running") runningRuleForm.animated = true;
}

function updateLinkRuleStateFromValue(value: string) {
  if (linkStateOptions.some((item) => item.value === value)) {
    updateLinkRuleState(value as NonNullable<LinkRuntimeRule["action"]["state"]>);
  }
}

function selectedLinkEndpointNodes() {
  if (!props.selectedLink) return [];
  return [nodeByKey(props.selectedLink.from), nodeByKey(props.selectedLink.to)].filter(Boolean) as TopologyNode[];
}

function hasMapping(node: TopologyNode, candidates: string[]) {
  const entries = Object.entries(node.dataBinding?.mappings ?? {});
  return entries.some(([alias, path]) => candidates.includes(alias) || candidates.includes(path));
}

function chooseBoundField(node: TopologyNode | null, candidates: string[], fallback: string) {
  if (!node) return fallback;
  const entries = Object.entries(node.dataBinding?.mappings ?? {});
  const matched = entries.find(([alias, path]) => candidates.includes(alias) || candidates.includes(path));
  return matched?.[0] ?? fallback;
}

function chooseBreakerRuleNode() {
  const nodes = selectedLinkEndpointNodes();
  return nodes.find((node) => node.typeId.includes("breaker"))
    ?? nodes.find((node) => hasMapping(node, ["state", "breakerState"]))
    ?? nodes[0]
    ?? null;
}

function chooseVoltageRuleNode() {
  const nodes = selectedLinkEndpointNodes();
  return nodes.find((node) => hasMapping(node, ["outputVoltage", "voltage", "U"]))
    ?? nodes[1]
    ?? nodes[0]
    ?? null;
}

function addLinkRule(rule: LinkRuntimeRule) {
  if (!props.selectedLink) return;
  emit("updateLink", props.selectedLink.key, {
    rules: [
      ...(props.selectedLink.rules ?? []),
      rule
    ]
  });
}

function buildRunningRuleStyle() {
  const style: LinkStyle = {};
  if (runningRuleForm.overrideMainStyle) {
    style.color = runningRuleForm.color;
    style.width = Math.max(1, Math.round(Number(runningRuleForm.width) || 3));
    style.opacity = numberInRange(runningRuleForm.opacity, 0, 1, 1);
    style.lineCap = runningRuleForm.lineCap;
    style.dash = runningRuleForm.dash ? [...runningRuleForm.dash] : undefined;
  }
  if (runningRuleForm.overrideFlowStyle) {
    style.animated = runningRuleForm.animated;
    style.flowDirection = runningRuleForm.flowDirection;
    style.flow = {
      color: runningRuleForm.flowColor,
      width: Math.max(1, Math.round(Number(runningRuleForm.flowWidth) || 3)),
      opacity: numberInRange(runningRuleForm.flowOpacity, 0, 1, 0.85),
      dash: runningRuleForm.flowDash ? [...runningRuleForm.flowDash] : undefined,
      speed: numberInRange(runningRuleForm.flowSpeed, 0, 10, 4)
    };
  }
  return Object.keys(style).length ? style : undefined;
}

function previewRunningRuleForm() {
  if (!props.selectedLink) return;
  activeLinkPreview.value = { linkKey: props.selectedLink.key, source: "form" };
  emit("previewLinkStyle", props.selectedLink.key, buildRunningRuleStyle() ?? {});
}

function previewLinkRule(rule: LinkRuntimeRule) {
  if (!props.selectedLink) return;
  activeLinkPreview.value = { linkKey: props.selectedLink.key, source: "rule", ruleId: rule.id };
  emit("previewLinkStyle", props.selectedLink.key, rule.action.style ?? {});
}

function clearLinkPreview() {
  emit("clearLinkStylePreview", props.selectedLink?.key);
  activeLinkPreview.value = null;
}

function isPreviewingRunningRuleForm() {
  const preview = activeLinkPreview.value;
  if (!preview) return false;
  return preview.linkKey === props.selectedLink?.key && preview.source === "form";
}

function isPreviewingLinkRule(rule: LinkRuntimeRule) {
  const preview = activeLinkPreview.value;
  if (!preview) return false;
  return preview.linkKey === props.selectedLink?.key
    && preview.source === "rule"
    && preview.ruleId === rule.id;
}

function addNodeStatusRule() {
  if (!props.selectedNode) return;
  const ruleField = effectiveNodeStatusRuleField();
  if (!ruleField) return;
  const value = normalizeNodeStatusRuleValue(nodeStatusRuleForm.value);
  const sourceId = nodeStatusRuleForm.sourceId || defaultRuleSourceId(props.selectedNode);
  const field = expressionFieldWithSource(props.selectedNode, ruleField, sourceId);

  emit("updateNode", props.selectedNode.key, {
    displayRules: [
      ...(props.selectedNode.displayRules ?? []),
      {
        id: createRuleId("rule_node_status"),
        name: `${props.selectedNode.label}.${ruleField} = ${String(value)} 时状态为 ${nodeStatusRuleForm.status}`,
        priority: Number.isFinite(nodeStatusRuleForm.priority) ? Math.round(nodeStatusRuleForm.priority) : 10,
        condition: {
          logic: "and",
          conditions: [
            {
              field,
              operator: "eq",
              value
            }
          ]
        },
        action: {
          status: nodeStatusRuleForm.status,
          color: nodeStatusRuleForm.color
        }
      }
    ]
  });
}

function updateButtonDefaultVisible(value: boolean) {
  if (!props.selectedNode || !isSelectedControlNode.value) return;
  updateSelectedNodeProps({ buttonDefaultVisible: value });
}

function addButtonVisibilityRule() {
  if (!props.selectedNode || !isSelectedControlNode.value) return;
  const ruleField = effectiveButtonVisibilityRuleField();
  if (!ruleField) return;
  if (buttonVisibilityRuleForm.sourceType === "node" && !buttonVisibilityRuleForm.nodeKey) return;

  const value = normalizeButtonVisibilityRuleValue(buttonVisibilityRuleForm.value);
  const field = buttonVisibilityRuleForm.sourceType === "metaData"
    ? normalizeExpressionPath(ruleField)
    : expressionFieldWithSource(
      selectedButtonRuleNode.value,
      ruleField,
      buttonVisibilityRuleForm.sourceId || defaultRuleSourceId(selectedButtonRuleNode.value)
    );
  const actionLabel = buttonVisibilityRuleForm.visible ? "显示" : "隐藏";
  const sourceLabel = buttonVisibilityRuleForm.sourceType === "metaData"
    ? "父组件数据"
    : selectedButtonRuleNode.value?.label ?? buttonVisibilityRuleForm.nodeKey;

  emit("updateNode", props.selectedNode.key, {
    displayRules: [
      ...(props.selectedNode.displayRules ?? []),
      {
        id: createRuleId("rule_button_visibility"),
        name: `${sourceLabel}.${ruleField} = ${String(value)} 时按钮${actionLabel}`,
        priority: Number.isFinite(buttonVisibilityRuleForm.priority) ? Math.round(buttonVisibilityRuleForm.priority) : 10,
        condition: {
          logic: "and",
          conditions: [
            {
              field,
              operator: "eq",
              value
            }
          ]
        },
        action: {
          visible: buttonVisibilityRuleForm.visible
        }
      }
    ]
  });
}

function addRunningStateRule() {
  const ruleField = effectiveRunningRuleField();
  if (!props.selectedLink || !runningRuleForm.nodeKey || !ruleField) return;
  const sourceNode = selectedRuleNode.value;
  const value = normalizeRuleValue(runningRuleForm.value);
  const sourceId = runningRuleForm.sourceId || defaultRuleSourceId(sourceNode);
  const field = expressionFieldWithSource(sourceNode, ruleField, sourceId);
  const lineStateLabel = linkStateOptions.find((item) => item.value === runningRuleForm.lineState)?.label ?? runningRuleForm.lineState;
  const style = buildRunningRuleStyle();
  addLinkRule({
    id: createRuleId("rule_link_running"),
    name: `${sourceNode?.label ?? runningRuleForm.nodeKey}.${ruleField} = ${String(value)} 时线路${lineStateLabel}`,
    priority: Number.isFinite(runningRuleForm.priority) ? Math.round(runningRuleForm.priority) : 10,
    trigger: {
      type: "dataChange",
      sources: [field]
    },
    condition: {
      logic: "and",
      conditions: [
        {
          field,
          operator: "eq",
          value
        }
      ]
    },
    action: {
      state: runningRuleForm.lineState,
      ...(style ? { style } : {})
    }
  });
}

function addBreakerRunningRule() {
  if (!props.selectedLink) return;
  const sourceNode = chooseBreakerRuleNode();
  const fieldName = chooseBoundField(sourceNode, ["state", "breakerState"], "state");
  const field = `${sourceNode?.key ?? props.selectedLink.from}.${fieldName}`;
  addLinkRule({
    id: createRuleId("rule_link_running"),
    name: "断路器闭合时线路运行",
    priority: 10,
    trigger: {
      type: "dataChange",
      sources: [field]
    },
    condition: {
      logic: "and",
      conditions: [
        {
          field,
          operator: "eq",
          value: "closed"
        }
      ]
    },
    action: {
      state: "running",
      style: {
        color: "#22c55e",
        width: 3,
        animated: true,
        flowDirection: "fromTo",
        flow: {
          color: "#ffffff",
          width: 3,
          opacity: 0.85,
          dash: [9, 9],
          speed: 4
        }
      }
    }
  });
}

function addVoltageFaultRule() {
  if (!props.selectedLink) return;
  const sourceNode = chooseVoltageRuleNode();
  const fieldName = chooseBoundField(sourceNode, ["outputVoltage", "voltage", "U"], "outputVoltage");
  const field = `${sourceNode?.key ?? props.selectedLink.to}.${fieldName}`;
  addLinkRule({
    id: createRuleId("rule_voltage_fault"),
    name: "输出电压异常",
    priority: 100,
    trigger: {
      type: "dataChange",
      sources: [field]
    },
    condition: {
      logic: "and",
      conditions: [
        {
          field,
          operator: "lt",
          value: 0
        }
      ]
    },
    action: {
      state: "fault",
      style: {
        color: "#ef4444",
        width: 4,
        animated: false
      }
    }
  });
}

function removeLinkRule(ruleId: string) {
  if (!props.selectedLink) return;
  if (activeLinkPreview.value?.linkKey === props.selectedLink.key && activeLinkPreview.value.ruleId === ruleId) {
    clearLinkPreview();
  }
  emit("updateLink", props.selectedLink.key, {
    rules: (props.selectedLink.rules ?? []).filter((rule) => rule.id !== ruleId)
  });
}

function removeNodeDisplayRule(ruleId: string) {
  if (!props.selectedNode) return;
  emit("updateNode", props.selectedNode.key, {
    displayRules: (props.selectedNode.displayRules ?? []).filter((rule) => rule.id !== ruleId)
  });
}

function describeRule(rule: LinkRuntimeRule) {
  const condition = rule.condition.conditions[0];
  if (!condition || "conditions" in condition) return "复合条件";
  return `${condition.field} ${condition.operator} ${condition.value === undefined ? "" : String(condition.value)}`;
}

function describeDisplayRule(rule: NonNullable<TopologyNode["displayRules"]>[number]) {
  const condition = rule.condition.conditions[0];
  if (!condition || "conditions" in condition) return "复合条件";
  return `${condition.field} ${condition.operator} ${condition.value === undefined ? "" : String(condition.value)}`;
}

function selectedNodeKindLabel(node: TopologyNode) {
  if (node.isGroup) return "分组";
  if (isSelectedAnnotationNode.value) return "标注";
  if (isSelectedControlNode.value) return "控件";
  return "节点";
}

function selectedNodeTypeLabel(node: TopologyNode) {
  return selectedNodeType.value?.name ?? node.typeId;
}

function selectedObjectTitle() {
  if (props.selectedNode) return props.selectedNode.label;
  if (props.selectedLink) return props.selectedLink.label || linkTreeLabel(props.selectedLink);
  return props.topology?.name ?? "未选择对象";
}

function selectedObjectKindLabel() {
  if (props.selectedNode) return selectedNodeKindLabel(props.selectedNode);
  if (props.selectedLink) return "连线";
  return "画布";
}

function nodeRuleCount(node: TopologyNode) {
  return node.displayRules?.length ?? 0;
}

function nodeEventCount(node: TopologyNode) {
  return node.eventConfig?.length ?? 0;
}

function linkRuleCount(link: TopologyLink) {
  return link.rules?.length ?? 0;
}

function selectedLinkEndpointLabel(link: TopologyLink) {
  const from = nodeByKey(link.from)?.label ?? link.from;
  const to = nodeByKey(link.to)?.label ?? link.to;
  return `${from}${link.fromPort ? ` / ${link.fromPort}` : ""} -> ${to}${link.toPort ? ` / ${link.toPort}` : ""}`;
}

function addNodeEventFromDrawer() {
  addNodeEventConfig();
  closeDrawer();
}

function addNodeStatusRuleFromDrawer() {
  addNodeStatusRule();
  closeDrawer();
}

function addButtonVisibilityRuleFromDrawer() {
  addButtonVisibilityRule();
  closeDrawer();
}

function addRunningStateRuleFromDrawer() {
  addRunningStateRule();
  closeDrawer();
}

watch(
  () => props.selectedNode?.key,
  () => {
    if (!props.selectedNode || activeRuleNodeKey === props.selectedNode.key) return;
    activeRuleNodeKey = props.selectedNode.key;
    resetNodeEventForm(props.selectedNode);
    ensureRuleSourceSelection();
    updateNodeStatusRuleField(selectedNodeFieldOptions.value.some((field) => field.field === "status") ? "status" : selectedNodeFieldOptions.value[0]?.field ?? "status");
    if (!buttonVisibilityRuleForm.nodeKey || !props.topology?.nodes.some((node) => node.key === buttonVisibilityRuleForm.nodeKey)) {
      updateButtonVisibilityRuleNode(props.topology?.nodes.find((node) => node.key !== props.selectedNode?.key)?.key ?? props.topology?.nodes[0]?.key ?? "");
    }
  },
  { immediate: true }
);

watch(
  () => [props.selectedLink?.key, props.topology?.nodes.map((node) => node.key).join("|")],
  () => {
    if (!props.selectedLink) return;
    const preferredNodeKey = props.selectedLink.from || props.topology?.nodes[0]?.key || "";
    const linkChanged = activeRuleLinkKey !== props.selectedLink.key;
    if (linkChanged && activeRuleLinkKey) {
      emit("clearLinkStylePreview", activeRuleLinkKey);
      activeLinkPreview.value = null;
    }
    activeRuleLinkKey = props.selectedLink.key;
    const nextNodeKey = !linkChanged && props.topology?.nodes.some((node) => node.key === runningRuleForm.nodeKey)
      ? runningRuleForm.nodeKey
      : preferredNodeKey;
    updateRunningRuleNode(nextNodeKey);
    ensureRuleSourceSelection();
  },
  { immediate: true }
);

watch(
  () => props.topology?.dataSources?.map((source) => `${source.sourceId}:${source.enabled !== false}`).join("|"),
  ensureRuleSourceSelection,
  { immediate: true }
);

watch(
  () => props.selectedNode?.key,
  () => {
    if (!props.selectedNode) return;
    closeDrawer();
    if (props.selectedNode.isGroup) {
      activeGroupTab.value = "base";
    } else if (isSelectedControlNode.value) {
      activeNodeTab.value = "appearance";
    } else if (isSelectedAnnotationNode.value) {
      activeNodeTab.value = "data";
    } else {
      activeNodeTab.value = "base";
    }
  },
  { immediate: true }
);

watch(
  () => props.selectedLink?.key,
  () => {
    if (!props.selectedLink) return;
    closeDrawer();
    activeLinkTab.value = "style";
  },
  { immediate: true }
);
</script>

<template>
  <aside class="property">
    <div class="panel-header">属性面板</div>
    <div v-if="topology" class="property-body">
      <section class="inspector-summary">
        <div class="summary-kind">{{ selectedObjectKindLabel() }}</div>
        <div class="summary-title">{{ selectedObjectTitle() }}</div>
        <div v-if="selectedNode" class="summary-meta">
          <span>{{ selectedNodeTypeLabel(selectedNode) }}</span>
          <span>{{ selectedNode.key }}</span>
        </div>
        <div v-else-if="selectedLink" class="summary-meta">
          <span>{{ selectedLinkEndpointLabel(selectedLink) }}</span>
          <span>{{ selectedLink.key }}</span>
        </div>
        <div v-else class="summary-meta">
          <span>{{ topology.nodes.length }} 节点</span>
          <span>{{ topology.links.length }} 连线</span>
        </div>
        <div v-if="selectedNode" class="summary-badges">
          <span>{{ nodeRuleCount(selectedNode) }} 规则</span>
          <span>{{ nodeEventCount(selectedNode) }} 事件</span>
        </div>
        <div v-else-if="selectedLink" class="summary-badges">
          <span>{{ linkRuleCount(selectedLink) }} 规则</span>
        </div>
      </section>

      <template v-if="selectedNode && selectedNode.isGroup">
        <el-tabs v-model="activeGroupTab" class="inspector-tabs">
          <el-tab-pane label="基础" name="base">
            <section class="property-section">
              <label>
                名称
                <input :value="selectedNode.label" @input="updateLabel(($event.target as HTMLInputElement).value)" @change="updateLabel(($event.target as HTMLInputElement).value)" />
              </label>
              <label>
                标识
                <input :value="nodeIdentifier(selectedNode)" placeholder="例如 group-a" @input="updateIdentifier(($event.target as HTMLInputElement).value)" @change="updateIdentifier(($event.target as HTMLInputElement).value)" />
              </label>
              <div class="readonly-grid">
                <span>内部 Key</span>
                <strong>{{ selectedNode.key }}</strong>
                <span>类型</span>
                <strong>{{ selectedNode.typeId }}</strong>
              </div>
              <label>
                所属组
                <select :value="selectedNode.group ?? ''" @change="updateNodeGroup(($event.target as HTMLSelectElement).value)">
                  <option value="">无</option>
                  <option v-for="group in availableParentGroups" :key="group.key" :value="group.key">
                    {{ group.label }}（{{ group.key }}）
                  </option>
                </select>
              </label>
            </section>
          </el-tab-pane>

          <el-tab-pane label="外观" name="appearance">
            <section class="property-section">
              <div class="size-grid">
                <label>
                  宽度
                  <input type="number" :value="parseSize(selectedNode.size).width" @input="updateSize('width', ($event.target as HTMLInputElement).value)" @change="updateSize('width', ($event.target as HTMLInputElement).value)" />
                </label>
                <label>
                  高度
                  <input type="number" :value="parseSize(selectedNode.size).height" @input="updateSize('height', ($event.target as HTMLInputElement).value)" @change="updateSize('height', ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
              <label>
                背景
                <input type="color" :value="groupBackgroundColor(selectedNode)" @input="updateRuntimeColor('backgroundColor', ($event.target as HTMLInputElement).value)" />
              </label>
              <label>
                背景透明度（%）
                <input type="number" min="0" max="100" step="1" :value="groupBackgroundOpacity(selectedNode)" @input="updateBackgroundOpacity(($event.target as HTMLInputElement).value)" @change="updateBackgroundOpacity(($event.target as HTMLInputElement).value)" />
              </label>
              <label>
                边框
                <input type="color" :value="groupBorderColor(selectedNode)" @input="updateRuntimeColor('borderColor', ($event.target as HTMLInputElement).value)" />
              </label>
              <label class="checkbox-row">
                <input type="checkbox" :checked="groupTransparentBackground(selectedNode)" @change="updateTransparentBackground(($event.target as HTMLInputElement).checked)" />
                透明背景
              </label>
              <label class="checkbox-row">
                <input type="checkbox" :checked="groupDashedBorder(selectedNode)" @change="updateDashedBorder(($event.target as HTMLInputElement).checked)" />
                虚线边框
              </label>
            </section>
          </el-tab-pane>

          <el-tab-pane label="成员/层级" name="layers">
            <section class="property-section">
              <label>
                层级
                <input :value="nodeZOrder(selectedNode)" readonly />
              </label>
              <div class="layer-actions">
                <button type="button" @click="moveSelectedToBottom">置底</button>
                <button type="button" @click="moveSelectedLayer('down')">下移一层</button>
                <button type="button" @click="moveSelectedLayer('up')">上移一层</button>
                <button type="button" @click="moveSelectedToTop">置顶</button>
              </div>
            </section>
          </el-tab-pane>
        </el-tabs>
      </template>

      <template v-else-if="selectedNode">
        <el-tabs v-model="activeNodeTab" class="inspector-tabs">
          <el-tab-pane label="基础" name="base">
            <section class="property-section">
              <label>
                名称
                <input :value="selectedNode.label" @input="updateLabel(($event.target as HTMLInputElement).value)" @change="updateLabel(($event.target as HTMLInputElement).value)" />
              </label>
              <label>
                标识
                <input :value="nodeIdentifier(selectedNode)" placeholder="例如 qf1" @input="updateIdentifier(($event.target as HTMLInputElement).value)" @change="updateIdentifier(($event.target as HTMLInputElement).value)" />
              </label>
              <div class="readonly-grid">
                <span>内部 Key</span>
                <strong>{{ selectedNode.key }}</strong>
                <span>类型</span>
                <strong>{{ selectedNode.typeId }}</strong>
              </div>
              <label>
                所属组
                <select :value="selectedNode.group ?? ''" @change="updateNodeGroup(($event.target as HTMLSelectElement).value)">
                  <option value="">无</option>
                  <option v-for="group in availableParentGroups" :key="group.key" :value="group.key">
                    {{ group.label }}（{{ group.key }}）
                  </option>
                </select>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" :checked="selectedNode.props?.showLabel !== false" @change="updateShowLabel(($event.target as HTMLInputElement).checked)" />
                展示名称
              </label>
              <label v-if="canPositionSelectedNodeLabel">
                名称位置
                <select :value="nodeLabelPosition(selectedNode)" @change="updateLabelPosition(($event.target as HTMLSelectElement).value)">
                  <option v-for="option in nodeLabelPositionOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </section>
          </el-tab-pane>

          <el-tab-pane label="外观" name="appearance">
            <section class="property-section">
              <div class="size-grid">
                <label>
                  宽度
                  <input type="number" :value="parseSize(selectedNode.size).width" @input="updateSize('width', ($event.target as HTMLInputElement).value)" @change="updateSize('width', ($event.target as HTMLInputElement).value)" />
                </label>
                <label>
                  高度
                  <input type="number" :value="parseSize(selectedNode.size).height" @input="updateSize('height', ($event.target as HTMLInputElement).value)" @change="updateSize('height', ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
              <label>
                旋转角度
                <input type="number" step="1" :value="selectedNode.angle ?? 0" @input="updateAngle(($event.target as HTMLInputElement).value)" @change="updateAngle(($event.target as HTMLInputElement).value)" />
              </label>
              <label>
                层级
                <input :value="nodeZOrder(selectedNode)" readonly />
              </label>
              <div class="layer-actions">
                <button type="button" @click="moveSelectedToBottom">置底</button>
                <button type="button" @click="moveSelectedLayer('down')">下移一层</button>
                <button type="button" @click="moveSelectedLayer('up')">上移一层</button>
                <button type="button" @click="moveSelectedToTop">置顶</button>
              </div>
            </section>

            <section v-if="isSelectedControlNode" class="property-section">
              <div class="section-title">按钮</div>
              <label>
                按钮文字
                <input :value="buttonText(selectedNode)" placeholder="例如 分闸 / 合闸 / 查看详情" @input="updateButtonText(($event.target as HTMLInputElement).value)" @change="updateButtonText(($event.target as HTMLInputElement).value)" />
              </label>
              <label>
                渲染方式
                <select :value="buttonRenderMode(selectedNode)" @change="updateButtonRenderMode(($event.target as HTMLSelectElement).value)">
                  <option value="text">文字</option>
                  <option value="image">图片</option>
                  <option value="imageText">图片 + 文字</option>
                </select>
              </label>
              <label>
                图片
                <input :value="buttonImage(selectedNode)" placeholder="图片地址或上传图片" @input="updateButtonImage(($event.target as HTMLInputElement).value)" @change="updateButtonImage(($event.target as HTMLInputElement).value)" />
              </label>
              <div class="layer-actions">
                <button type="button" :disabled="uploadingButtonImage" @click="chooseButtonImage">{{ uploadingButtonImage ? "上传中" : "上传图片" }}</button>
                <button type="button" :disabled="!buttonImage(selectedNode)" @click="updateButtonImage('')">清空图片</button>
              </div>
              <input ref="buttonImageInputRef" class="hidden-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" @change="handleButtonImageChange" />
              <label class="checkbox-row">
                <input type="checkbox" :checked="buttonDefaultVisible(selectedNode)" @change="updateButtonDefaultVisible(($event.target as HTMLInputElement).checked)" />
                默认显示
              </label>
              <div v-if="buttonRenderMode(selectedNode) === 'image'" class="hint">纯图片模式会按节点尺寸缩放图片，按钮背景、边框和文字样式不会参与渲染。</div>
              <template v-else>
                <div class="size-grid">
                  <label>
                    背景
                    <input type="color" :value="buttonStyleBackgroundColor(selectedNode)" @input="updateButtonStyleColor('buttonStyleBackgroundColor', ($event.target as HTMLInputElement).value)" />
                  </label>
                  <label>
                    边框
                    <input type="color" :value="buttonStyleBorderColor(selectedNode)" @input="updateButtonStyleColor('buttonStyleBorderColor', ($event.target as HTMLInputElement).value)" />
                  </label>
                </div>
                <div class="size-grid">
                  <label>
                    文字颜色
                    <input type="color" :value="buttonStyleTextColor(selectedNode)" @input="updateButtonStyleColor('buttonStyleTextColor', ($event.target as HTMLInputElement).value)" />
                  </label>
                  <label>
                    文字大小
                    <input type="number" min="1" :value="buttonStyleTextSize(selectedNode)" @input="updateButtonStyleNumber('buttonStyleTextSize', ($event.target as HTMLInputElement).value, 1)" @change="updateButtonStyleNumber('buttonStyleTextSize', ($event.target as HTMLInputElement).value, 1)" />
                  </label>
                </div>
                <div class="size-grid">
                  <label>
                    边框宽度
                    <input type="number" min="0" step="0.5" :value="buttonStyleBorderWidth(selectedNode)" @input="updateButtonStyleNumber('buttonStyleBorderWidth', ($event.target as HTMLInputElement).value)" @change="updateButtonStyleNumber('buttonStyleBorderWidth', ($event.target as HTMLInputElement).value)" />
                  </label>
                  <label>
                    圆角
                    <input type="number" min="0" :value="buttonStyleBorderRadius(selectedNode)" @input="updateButtonStyleNumber('buttonStyleBorderRadius', ($event.target as HTMLInputElement).value)" @change="updateButtonStyleNumber('buttonStyleBorderRadius', ($event.target as HTMLInputElement).value)" />
                  </label>
                </div>
                <div class="size-grid">
                  <label>
                    横向内边距
                    <input type="number" min="0" :value="buttonStylePaddingX(selectedNode)" @input="updateButtonStyleNumber('buttonStylePaddingX', ($event.target as HTMLInputElement).value)" @change="updateButtonStyleNumber('buttonStylePaddingX', ($event.target as HTMLInputElement).value)" />
                  </label>
                  <label>
                    纵向内边距
                    <input type="number" min="0" :value="buttonStylePaddingY(selectedNode)" @input="updateButtonStyleNumber('buttonStylePaddingY', ($event.target as HTMLInputElement).value)" @change="updateButtonStyleNumber('buttonStylePaddingY', ($event.target as HTMLInputElement).value)" />
                  </label>
                </div>
                <button type="button" @click="openDrawer('buttonVisibilityRule')">配置显示隐藏规则</button>
              </template>
            </section>

            <section v-if="isSelectedAnnotationNode" class="property-section">
              <div class="section-title">标注文本</div>
              <label>
                文字颜色
                <input type="color" :value="nodeTextColor(selectedNode)" @input="updateAnnotationTextColor(($event.target as HTMLInputElement).value)" />
              </label>
              <label>
                文字大小
                <input type="number" min="1" step="1" :value="nodeTextSize(selectedNode)" @input="updateAnnotationTextSize(($event.target as HTMLInputElement).value)" @change="updateAnnotationTextSize(($event.target as HTMLInputElement).value)" />
              </label>
            </section>
          </el-tab-pane>

          <el-tab-pane label="数据/业务" name="data">
            <section v-if="selectedDynamicFormFields.length" class="property-section">
              <div class="dynamic-field" v-for="field in selectedDynamicFormFields" :key="field.field">
                <span class="dynamic-field-label">
                  {{ field.label }}
                  <span v-if="field.required" class="required-mark">*</span>
                  <span v-if="field.unit" class="dynamic-field-unit">{{ field.unit }}</span>
                </span>
                <textarea v-if="field.type === 'textarea'" :value="dynamicFormFieldValue(selectedNode, field)" :placeholder="field.field" rows="4" spellcheck="false" @input="updateDynamicFormField(field, ($event.target as HTMLTextAreaElement).value)" @change="updateDynamicFormField(field, ($event.target as HTMLTextAreaElement).value)" />
                <select v-else-if="field.type === 'select'" :value="dynamicFormFieldValue(selectedNode, field)" @change="updateDynamicFormField(field, ($event.target as HTMLSelectElement).value)">
                  <option value="">请选择</option>
                  <option v-if="!field.options?.length" value="" disabled>暂无选项</option>
                  <option v-for="option in field.options ?? []" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
                </select>
                <label v-else-if="field.type === 'boolean'" class="checkbox-row dynamic-checkbox-row">
                  <input type="checkbox" :checked="dynamicFormBooleanValue(selectedNode, field)" @change="updateDynamicFormField(field, ($event.target as HTMLInputElement).checked)" />
                  <span>{{ dynamicFormBooleanValue(selectedNode, field) ? "是" : "否" }}</span>
                </label>
                <input v-else-if="field.type === 'number'" type="number" :value="dynamicFormFieldValue(selectedNode, field)" :placeholder="field.field" @input="updateDynamicFormField(field, ($event.target as HTMLInputElement).value)" @change="updateDynamicFormField(field, ($event.target as HTMLInputElement).value)" />
                <input v-else-if="field.type === 'date'" type="date" :value="dynamicFormFieldValue(selectedNode, field)" @input="updateDynamicFormField(field, ($event.target as HTMLInputElement).value)" @change="updateDynamicFormField(field, ($event.target as HTMLInputElement).value)" />
                <input v-else-if="field.type === 'color'" type="color" :value="dynamicFormColorValue(selectedNode, field)" @input="updateDynamicFormField(field, ($event.target as HTMLInputElement).value)" @change="updateDynamicFormField(field, ($event.target as HTMLInputElement).value)" />
                <input v-else :value="dynamicFormFieldValue(selectedNode, field)" :placeholder="field.field" @input="updateDynamicFormField(field, ($event.target as HTMLInputElement).value)" @change="updateDynamicFormField(field, ($event.target as HTMLInputElement).value)" />
              </div>
            </section>
            <section v-if="isSelectedAnnotationNode" class="property-section">
              <label>
                文本模板
                <textarea :value="nodeTextTemplate(selectedNode)" rows="5" placeholder="例如 Ia: ${ct1.ia} A；多接口可写 ${latest.data.ct1.ia}" spellcheck="false" @input="updateAnnotationTextTemplate(($event.target as HTMLTextAreaElement).value)" @change="updateAnnotationTextTemplate(($event.target as HTMLTextAreaElement).value)" />
              </label>
            </section>
            <div v-if="!selectedDynamicFormFields.length && !isSelectedAnnotationNode" class="hint">当前节点类型暂无业务属性。</div>
          </el-tab-pane>

          <el-tab-pane label="规则" name="rules">
            <section class="property-section">
              <div class="section-header">
                <div>
                  <div class="section-title">节点运行规则</div>
                  <div class="section-note">{{ nodeRuleCount(selectedNode) }} 条规则</div>
                </div>
                <button type="button" @click="openDrawer('nodeRule')">新增状态规则</button>
              </div>
              <button v-if="isSelectedControlNode" type="button" @click="openDrawer('buttonVisibilityRule')">新增按钮显示规则</button>
              <div v-if="selectedNode.displayRules?.length" class="rule-list">
                <div v-for="rule in selectedNode.displayRules" :key="rule.id" class="rule-item">
                  <div>
                    <strong>{{ rule.name }}</strong>
                    <span>优先级 {{ rule.priority }}</span>
                    <span>{{ describeDisplayRule(rule) }}</span>
                  </div>
                  <button type="button" @click="removeNodeDisplayRule(rule.id)">删除</button>
                </div>
              </div>
              <div v-else class="hint">暂无节点运行规则。</div>
            </section>
          </el-tab-pane>

          <el-tab-pane label="事件" name="events">
            <section class="property-section">
              <div class="section-header">
                <div>
                  <div class="section-title">节点事件</div>
                  <div class="section-note">{{ nodeEventCount(selectedNode) }} 个事件</div>
                </div>
                <button type="button" @click="openDrawer('nodeEvent')">新增事件</button>
              </div>
              <div v-if="selectedNode.eventConfig?.length" class="rule-list">
                <div v-for="(event, index) in selectedNode.eventConfig" :key="event.id ?? index" class="rule-item">
                  <div>
                    <strong>{{ event.eventName }}</strong>
                    <span>{{ describeNodeEventConfig(event) }}</span>
                    <span v-if="event.bindNodeKey">绑定 {{ event.bindNodeKey }}{{ event.bindDataPath ? ` / ${event.bindDataPath}` : '' }}</span>
                  </div>
                  <button type="button" @click="removeNodeEventConfig(event.id, index)">删除</button>
                </div>
              </div>
              <div v-else class="hint">暂无节点事件。</div>
            </section>
          </el-tab-pane>
        </el-tabs>
      </template>

      <template v-else-if="selectedLink">
        <el-tabs v-model="activeLinkTab" class="inspector-tabs">
          <el-tab-pane label="基础" name="base">
            <section class="property-section">
              <label>
                名称
                <input :value="selectedLink.label ?? ''" placeholder="连线名称" @input="updateLinkLabel(($event.target as HTMLInputElement).value)" @change="updateLinkLabel(($event.target as HTMLInputElement).value)" />
              </label>
              <div class="readonly-grid">
                <span>标识</span>
                <strong>{{ selectedLink.key }}</strong>
                <span>起点</span>
                <strong>{{ `${selectedLink.from}${selectedLink.fromPort ? ` / ${selectedLink.fromPort}` : ''}` }}</strong>
                <span>终点</span>
                <strong>{{ `${selectedLink.to}${selectedLink.toPort ? ` / ${selectedLink.toPort}` : ''}` }}</strong>
              </div>
              <label>
                连线方向
                <select :value="selectedLink.direction ?? 'forward'" @change="updateLinkDirection(($event.target as HTMLSelectElement).value as TopologyLink['direction'])">
                  <option value="forward">正向</option>
                  <option value="reverse">反向</option>
                  <option value="both">双向</option>
                </select>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" :checked="selectedLink.showArrow === true" @change="updateLinkArrow(($event.target as HTMLInputElement).checked)" />
                显示箭头
              </label>
            </section>
          </el-tab-pane>

          <el-tab-pane label="样式" name="style">
            <section class="property-section">
              <div class="size-grid">
                <label>
                  颜色
                  <input type="color" :value="selectedLink.defaultStyle?.color ?? '#42B0FF'" @input="updateLinkDefaultStyle('color', ($event.target as HTMLInputElement).value)" />
                </label>
                <label>
                  宽度
                  <input type="number" :value="selectedLink.defaultStyle?.width ?? 2" @input="updateLinkDefaultStyle('width', Math.max(1, Number(($event.target as HTMLInputElement).value) || 1))" @change="updateLinkDefaultStyle('width', Math.max(1, Number(($event.target as HTMLInputElement).value) || 1))" />
                </label>
              </div>
              <label>
                透明度
                <input type="number" min="0" max="100" :value="opacityToPercent(selectedLink.defaultStyle?.opacity)" @input="updateLinkDefaultStyle('opacity', percentToOpacity(($event.target as HTMLInputElement).value))" @change="updateLinkDefaultStyle('opacity', percentToOpacity(($event.target as HTMLInputElement).value))" />
              </label>
              <label>
                线端
                <select :value="selectedLink.defaultStyle?.lineCap ?? 'butt'" @change="updateLinkDefaultStyle('lineCap', ($event.target as HTMLSelectElement).value as LinkStyle['lineCap'])">
                  <option value="butt">平直</option>
                  <option value="round">圆角</option>
                  <option value="square">方形</option>
                </select>
              </label>
              <label>
                主线虚线
                <select :value="linkDashPresetValue(selectedLink.defaultStyle?.dash)" @change="updateLinkDashPreset(($event.target as HTMLSelectElement).value)">
                  <option v-for="preset in linkDashPresets" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
                </select>
              </label>
              <button type="button" @click="openDrawer('linkAdvancedStyle')">高级样式</button>
            </section>
          </el-tab-pane>

          <el-tab-pane label="规则" name="rules">
            <section class="property-section">
              <div class="section-header">
                <div>
                  <div class="section-title">运行规则</div>
                  <div class="section-note">{{ linkRuleCount(selectedLink) }} 条规则</div>
                </div>
                <button type="button" @click="openDrawer('linkRule')">新增规则</button>
              </div>
              <div class="rule-actions">
                <button type="button" @click="addBreakerRunningRule">快捷：断路器闭合运行</button>
                <button type="button" @click="addVoltageFaultRule">快捷：电压故障</button>
              </div>
              <div v-if="selectedLink.rules?.length" class="rule-list">
                <div v-for="rule in selectedLink.rules" :key="rule.id" class="rule-item">
                  <div>
                    <strong>{{ rule.name }}</strong>
                    <span>优先级 {{ rule.priority }}</span>
                    <span>{{ describeRule(rule) }}</span>
                  </div>
                  <div class="rule-item-actions">
                    <button v-if="!isPreviewingLinkRule(rule)" type="button" @click="previewLinkRule(rule)">预览</button>
                    <button v-else type="button" @click="clearLinkPreview">停止</button>
                    <button type="button" @click="removeLinkRule(rule.id)">删除</button>
                  </div>
                </div>
              </div>
              <div v-else class="hint">暂无运行规则。</div>
            </section>
          </el-tab-pane>
        </el-tabs>
      </template>

      <template v-else>
        <section class="property-section">
          <label>
            拓扑名称
            <input
              :value="topology.name"
              @input="updateTopologyName(($event.target as HTMLInputElement).value)"
              @change="updateTopologyName(($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            版本
            <input
              :value="topology.version"
              @input="updateTopologyVersion(($event.target as HTMLInputElement).value)"
              @change="updateTopologyVersion(($event.target as HTMLInputElement).value)"
            />
          </label>
          <div class="readonly-grid">
            <span>节点数量</span>
            <strong>{{ topology.nodes.length }}</strong>
            <span>连线数量</span>
            <strong>{{ topology.links.length }}</strong>
          </div>
          <div class="hint">选中画布中的节点、组或连线后，可在这里编辑属性。</div>
        </section>
      </template>
    </div>

    <div v-else class="property-body">
      <div class="hint">拓扑加载后可编辑属性。</div>
    </div>

    <el-drawer :model-value="activeDrawer === 'nodeEvent'" title="新增节点事件" size="420px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedNode && topology" class="drawer-form">
        <label class="checkbox-row">
          <input v-model="nodeEventForm.enabled" type="checkbox" />
          启用事件
        </label>
        <div class="size-grid">
          <label>
            触发方式
            <select v-model="nodeEventForm.trigger">
              <option value="click">click</option>
              <option value="doubleClick">doubleClick</option>
              <option value="contextMenu">contextMenu</option>
            </select>
          </label>
          <label>
            EVENT key
            <input v-model="nodeEventForm.eventKey" placeholder="例如 qf1-open" />
          </label>
        </div>
        <label>
          EVENT name
          <input v-model="nodeEventForm.eventName" placeholder="例如 deviceClick / openBreaker" />
        </label>
        <label>
          绑定节点
          <select v-model="nodeEventForm.bindNodeKey">
            <option value="">不绑定</option>
            <option v-for="node in topology.nodes" :key="node.key" :value="node.key">{{ node.label }}（{{ node.key }}）</option>
          </select>
        </label>
        <label>
          绑定数据路径
          <input v-model="nodeEventForm.bindDataPath" placeholder="例如 state / props.identifier / ${metaData.xxx}" />
        </label>
        <label>
          手写 event data JSON
          <textarea v-model="nodeEventForm.eventDataText" rows="4" spellcheck="false" />
        </label>
        <label>
          event data 模板 JSON
          <textarea v-model="nodeEventForm.eventDataTemplateText" rows="4" placeholder="{ &quot;status&quot;: &quot;${latest.data.qf1.status}&quot; }" spellcheck="false" />
        </label>
        <button type="button" @click="addNodeEventFromDrawer">添加节点事件</button>
      </div>
    </el-drawer>

    <el-drawer :model-value="activeDrawer === 'nodeRule'" title="新增节点状态规则" size="420px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedNode" class="drawer-form">
        <label v-if="showRuleSourceSelect">
          接口
          <select v-model="nodeStatusRuleForm.sourceId">
            <option v-for="source in ruleDataSources" :key="source.sourceId" :value="source.sourceId">{{ source.name || source.sourceId }}（{{ source.sourceId }}）</option>
          </select>
        </label>
        <label>
          数据字段
          <select :value="nodeStatusRuleForm.field" @change="updateNodeStatusRuleField(($event.target as HTMLSelectElement).value)">
            <option v-for="field in selectedNodeFieldOptions" :key="field.field" :value="field.field">{{ field.label }}（{{ field.field }}）</option>
            <option value="__custom__">自定义字段</option>
          </select>
        </label>
        <label v-if="nodeStatusRuleForm.field === '__custom__'">
          字段名
          <input v-model="nodeStatusRuleForm.customField" placeholder="例如 status / data.qf1.status / ${api1.data.qf1.status}" />
        </label>
        <label>
          等于
          <select v-if="selectedNodeRuleFieldOption()?.options?.length" v-model="nodeStatusRuleForm.value">
            <option v-for="option in selectedNodeRuleFieldOption()?.options" :key="String(option)" :value="String(option)">{{ String(option) }}</option>
          </select>
          <select v-else-if="selectedNodeRuleFieldOption()?.type === 'boolean'" v-model="nodeStatusRuleForm.value">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <input v-else v-model="nodeStatusRuleForm.value" placeholder="例如 normal / warning / fault" />
        </label>
        <div class="size-grid">
          <label>
            设置状态
            <select :value="nodeStatusRuleForm.status" @change="updateNodeRuleStatus(($event.target as HTMLSelectElement).value)">
              <option v-for="status in selectedNodeStatusOptions" :key="status.value" :value="status.value">{{ status.label }}{{ status.image ? '（已配置图片）' : '' }}</option>
            </select>
          </label>
          <label>
            状态颜色
            <input v-model="nodeStatusRuleForm.color" type="color" />
          </label>
        </div>
        <div class="status-preview-row">
          <span class="status-preview-label">展示状态</span>
          <span class="status-preview-chip" :style="{ borderColor: selectedNodeStatusOption?.color }">
            <img v-if="selectedNodeStatusOption?.image && isImageIcon(selectedNodeStatusOption.image)" :src="selectedNodeStatusOption.image" :alt="selectedNodeStatusOption.label" />
            <span v-else class="status-preview-color" :style="{ background: selectedNodeStatusOption?.color }" />
            <span>{{ selectedNodeStatusOption?.label }}</span>
          </span>
        </div>
        <label>
          优先级
          <input v-model.number="nodeStatusRuleForm.priority" type="number" />
        </label>
        <button type="button" @click="addNodeStatusRuleFromDrawer">添加节点状态规则</button>
      </div>
    </el-drawer>

    <el-drawer :model-value="activeDrawer === 'buttonVisibilityRule'" title="新增按钮显示规则" size="420px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedNode && topology" class="drawer-form">
        <label>
          条件来源
          <select v-model="buttonVisibilityRuleForm.sourceType">
            <option value="metaData">父组件数据 mateData/metaData</option>
            <option value="node">绑定设备节点</option>
          </select>
        </label>
        <template v-if="buttonVisibilityRuleForm.sourceType === 'metaData'">
          <label>
            字段
            <input v-model="buttonVisibilityRuleForm.metaField" placeholder="例如 qfStatus.button1 / ${mateData.qfStatus.button1}" />
          </label>
        </template>
        <template v-else>
          <label>
            条件节点
            <select :value="buttonVisibilityRuleForm.nodeKey" @change="updateButtonVisibilityRuleNode(($event.target as HTMLSelectElement).value)">
              <option value="">请选择节点</option>
              <option v-for="node in topology.nodes" :key="node.key" :value="node.key">{{ node.label }}（{{ node.key }}）</option>
            </select>
          </label>
          <label v-if="showRuleSourceSelect">
            接口
            <select v-model="buttonVisibilityRuleForm.sourceId">
              <option v-for="source in ruleDataSources" :key="source.sourceId" :value="source.sourceId">{{ source.name || source.sourceId }}（{{ source.sourceId }}）</option>
            </select>
          </label>
          <label>
            字段
            <select :value="buttonVisibilityRuleForm.field" @change="updateButtonVisibilityRuleField(($event.target as HTMLSelectElement).value)">
              <option v-for="field in selectedButtonRuleNodeFieldOptions" :key="field.field" :value="field.field">{{ field.label }}（{{ field.field }}）</option>
              <option value="__custom__">自定义字段</option>
            </select>
          </label>
          <label v-if="buttonVisibilityRuleForm.field === '__custom__'">
            字段名
            <input v-model="buttonVisibilityRuleForm.customField" placeholder="例如 status / ${latest.data.qf1.status}" />
          </label>
        </template>
        <label>
          等于
          <select v-if="buttonVisibilityRuleForm.sourceType === 'node' && selectedButtonRuleFieldOption()?.options?.length" v-model="buttonVisibilityRuleForm.value">
            <option v-for="option in selectedButtonRuleFieldOption()?.options" :key="String(option)" :value="String(option)">{{ String(option) }}</option>
          </select>
          <select v-else-if="buttonVisibilityRuleForm.sourceType === 'node' && selectedButtonRuleFieldOption()?.type === 'boolean'" v-model="buttonVisibilityRuleForm.value">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <input v-else v-model="buttonVisibilityRuleForm.value" placeholder="例如 show / closed" />
        </label>
        <div class="size-grid">
          <label>
            命中动作
            <select v-model="buttonVisibilityRuleForm.visible">
              <option :value="true">显示</option>
              <option :value="false">隐藏</option>
            </select>
          </label>
          <label>
            优先级
            <input v-model.number="buttonVisibilityRuleForm.priority" type="number" />
          </label>
        </div>
        <button type="button" @click="addButtonVisibilityRuleFromDrawer">添加按钮显示规则</button>
      </div>
    </el-drawer>

    <el-drawer :model-value="activeDrawer === 'linkAdvancedStyle'" title="连线高级样式" size="430px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedLink" class="drawer-form">
        <div class="section-title">主线样式</div>
        <label v-if="linkDashPresetValue(selectedLink.defaultStyle?.dash) === 'custom'">
          <span class="label-with-help">
            主线虚线数组
            <button type="button" class="help-button" title="虚线数组按“画线长度、空白长度”循环。例如 [9, 9] 表示画 9px，空 9px。">?</button>
          </span>
          <input :value="dashText(selectedLink.defaultStyle?.dash)" placeholder="例如 9, 9" @change="updateLinkDashFromText(($event.target as HTMLInputElement).value)" />
        </label>
        <div class="section-title">流线样式</div>
        <label class="checkbox-row">
          <input type="checkbox" :checked="selectedLink.defaultStyle?.animated ?? false" @change="updateLinkDefaultStyle('animated', ($event.target as HTMLInputElement).checked)" />
          是否流线
        </label>
        <div class="size-grid">
          <label>
            流向
            <select :value="selectedLink.defaultStyle?.flowDirection ?? 'fromTo'" @change="updateLinkFlowDirection(($event.target as HTMLSelectElement).value as LinkStyle['flowDirection'])">
              <option value="fromTo">正向</option>
              <option value="toFrom">反向</option>
              <option value="both">双向</option>
            </select>
          </label>
          <label>
            流速
            <input type="number" min="0" max="10" step="1" :value="selectedLink.defaultStyle?.flow?.speed ?? 4" @input="updateLinkFlowStyle('speed', numberInRange(($event.target as HTMLInputElement).value, 0, 10, 4))" @change="updateLinkFlowStyle('speed', numberInRange(($event.target as HTMLInputElement).value, 0, 10, 4))" />
          </label>
        </div>
        <div class="size-grid">
          <label>
            流线颜色
            <input type="color" :value="selectedLink.defaultStyle?.flow?.color ?? '#ffffff'" @input="updateLinkFlowStyle('color', ($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            流线宽度
            <input type="number" min="1" :value="selectedLink.defaultStyle?.flow?.width ?? 3" @input="updateLinkFlowStyle('width', Math.max(1, Number(($event.target as HTMLInputElement).value) || 1))" @change="updateLinkFlowStyle('width', Math.max(1, Number(($event.target as HTMLInputElement).value) || 1))" />
          </label>
        </div>
        <label>
          流线透明度
          <input type="number" min="0" max="100" :value="opacityToPercent(selectedLink.defaultStyle?.flow?.opacity, 0.85)" @input="updateLinkFlowStyle('opacity', percentToOpacity(($event.target as HTMLInputElement).value))" @change="updateLinkFlowStyle('opacity', percentToOpacity(($event.target as HTMLInputElement).value))" />
        </label>
        <label>
          流线虚线
          <select :value="linkDashPresetValue(selectedLink.defaultStyle?.flow?.dash)" @change="updateLinkFlowDashPreset(($event.target as HTMLSelectElement).value)">
            <option v-for="preset in linkDashPresets" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
          </select>
        </label>
        <label v-if="linkDashPresetValue(selectedLink.defaultStyle?.flow?.dash) === 'custom'">
          <span class="label-with-help">
            流线虚线数组
            <button type="button" class="help-button" title="虚线数组按“画线长度、空白长度”循环。例如 [9, 9] 表示画 9px，空 9px。">?</button>
          </span>
          <input :value="dashText(selectedLink.defaultStyle?.flow?.dash)" placeholder="例如 9, 9" @change="updateLinkFlowDashFromText(($event.target as HTMLInputElement).value)" />
        </label>
        <div class="section-title">发光样式</div>
        <label class="checkbox-row">
          <input type="checkbox" :checked="selectedLink.defaultStyle?.glow?.enabled ?? false" @change="updateLinkGlowStyle('enabled', ($event.target as HTMLInputElement).checked)" />
          发光
        </label>
        <label>
          发光颜色
          <input type="color" :value="selectedLink.defaultStyle?.glow?.color ?? selectedLink.defaultStyle?.color ?? '#42B0FF'" @input="updateLinkGlowStyle('color', ($event.target as HTMLInputElement).value)" />
        </label>
        <label>
          发光宽度
          <input type="number" min="1" :value="selectedLink.defaultStyle?.glow?.width ?? Math.max(8, (selectedLink.defaultStyle?.width ?? 2) + 8)" @input="updateLinkGlowStyle('width', Math.max(1, Number(($event.target as HTMLInputElement).value) || 1))" @change="updateLinkGlowStyle('width', Math.max(1, Number(($event.target as HTMLInputElement).value) || 1))" />
        </label>
        <label>
          发光透明度
          <input type="number" min="0" max="100" :value="opacityToPercent(selectedLink.defaultStyle?.glow?.opacity, 0.28)" @input="updateLinkGlowStyle('opacity', percentToOpacity(($event.target as HTMLInputElement).value))" @change="updateLinkGlowStyle('opacity', percentToOpacity(($event.target as HTMLInputElement).value))" />
        </label>
      </div>
    </el-drawer>

    <el-drawer :model-value="activeDrawer === 'linkRule'" title="新增连线运行规则" size="430px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedLink" class="drawer-form">
        <label>
          条件节点
          <select :value="runningRuleForm.nodeKey" @change="updateRunningRuleNode(($event.target as HTMLSelectElement).value)">
            <option v-for="node in availableRuleNodes" :key="node.key" :value="node.key">{{ node.label }}（{{ node.key }}）</option>
          </select>
        </label>
        <label v-if="showRuleSourceSelect">
          接口
          <select v-model="runningRuleForm.sourceId">
            <option v-for="source in ruleDataSources" :key="source.sourceId" :value="source.sourceId">{{ source.name || source.sourceId }}（{{ source.sourceId }}）</option>
          </select>
        </label>
        <label>
          状态字段
          <select v-model="runningRuleForm.field">
            <option v-for="field in selectedRuleNodeFieldOptions" :key="field.field" :value="field.field">{{ field.label }}（{{ field.field }}）</option>
            <option value="__custom__">自定义字段</option>
          </select>
        </label>
        <label v-if="runningRuleForm.field === '__custom__'">
          字段名
          <input v-model="runningRuleForm.customField" placeholder="例如 status / data.qf1.status / ${api1.data.qf1.status}" />
        </label>
        <label>
          等于
          <select v-if="selectedRuleFieldOption()?.options?.length" v-model="runningRuleForm.value">
            <option v-for="option in selectedRuleFieldOption()?.options" :key="String(option)" :value="String(option)">{{ String(option) }}</option>
          </select>
          <select v-else-if="selectedRuleFieldOption()?.type === 'boolean'" v-model="runningRuleForm.value">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <input v-else v-model="runningRuleForm.value" placeholder="例如 closed / 1 / true" />
        </label>
        <div class="size-grid">
          <label>
            连线状态
            <select :value="runningRuleForm.lineState" @change="updateLinkRuleStateFromValue(($event.target as HTMLSelectElement).value)">
              <option v-for="state in linkStateOptions" :key="state.value" :value="state.value">{{ state.label }}</option>
            </select>
          </label>
          <label>
            优先级
            <input v-model.number="runningRuleForm.priority" type="number" />
          </label>
        </div>
        <label class="checkbox-row">
          <input v-model="runningRuleForm.overrideMainStyle" type="checkbox" />
          覆盖主线样式
        </label>
        <template v-if="runningRuleForm.overrideMainStyle">
          <div class="size-grid">
            <label>
              主线颜色
              <input v-model="runningRuleForm.color" type="color" />
            </label>
            <label>
              主线宽度
              <input v-model.number="runningRuleForm.width" type="number" min="1" />
            </label>
          </div>
          <div class="size-grid">
            <label>
              主线透明度
              <input type="number" min="0" max="100" :value="opacityToPercent(runningRuleForm.opacity)" @input="runningRuleForm.opacity = percentToOpacity(($event.target as HTMLInputElement).value)" />
            </label>
            <label>
              线端
              <select v-model="runningRuleForm.lineCap">
                <option value="butt">平直</option>
                <option value="round">圆角</option>
                <option value="square">方形</option>
              </select>
            </label>
          </div>
          <label>
            主线虚线
            <select :value="linkDashPresetValue(runningRuleForm.dash)" @change="updateRunningRuleDashPreset(($event.target as HTMLSelectElement).value)">
              <option v-for="preset in linkDashPresets" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
            </select>
          </label>
          <label v-if="linkDashPresetValue(runningRuleForm.dash) === 'custom'">
            主线虚线数组
            <input :value="dashText(runningRuleForm.dash)" placeholder="例如 9, 9" @change="updateRunningRuleDashFromText(($event.target as HTMLInputElement).value)" />
          </label>
        </template>
        <label class="checkbox-row">
          <input v-model="runningRuleForm.overrideFlowStyle" type="checkbox" />
          覆盖流线样式
        </label>
        <template v-if="runningRuleForm.overrideFlowStyle">
          <label class="checkbox-row">
            <input v-model="runningRuleForm.animated" type="checkbox" />
            是否流线
          </label>
          <div class="size-grid">
            <label>
              流向
              <select v-model="runningRuleForm.flowDirection">
                <option value="fromTo">正向</option>
                <option value="toFrom">反向</option>
                <option value="both">双向</option>
              </select>
            </label>
            <label>
              流速
              <input v-model.number="runningRuleForm.flowSpeed" type="number" min="0" max="10" step="1" />
            </label>
          </div>
          <div class="size-grid">
            <label>
              流线颜色
              <input v-model="runningRuleForm.flowColor" type="color" />
            </label>
            <label>
              流线宽度
              <input v-model.number="runningRuleForm.flowWidth" type="number" min="1" />
            </label>
          </div>
          <label>
            流线透明度
            <input type="number" min="0" max="100" :value="opacityToPercent(runningRuleForm.flowOpacity, 0.85)" @input="runningRuleForm.flowOpacity = percentToOpacity(($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            流线虚线
            <select :value="linkDashPresetValue(runningRuleForm.flowDash)" @change="updateRunningRuleFlowDashPreset(($event.target as HTMLSelectElement).value)">
              <option v-for="preset in linkDashPresets" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
            </select>
          </label>
          <label v-if="linkDashPresetValue(runningRuleForm.flowDash) === 'custom'">
            流线虚线数组
            <input :value="dashText(runningRuleForm.flowDash)" placeholder="例如 9, 9" @change="updateRunningRuleFlowDashFromText(($event.target as HTMLInputElement).value)" />
          </label>
        </template>
        <div class="button-row">
          <button v-if="!isPreviewingRunningRuleForm()" type="button" @click="previewRunningRuleForm">预览当前规则</button>
          <button v-else type="button" @click="clearLinkPreview">停止预览</button>
        </div>
        <button type="button" @click="addRunningStateRuleFromDrawer">添加运行态规则</button>
      </div>
    </el-drawer>
  </aside>
</template>

<style scoped>
.property {
  height: 100%;
}

.property-body {
  display: grid;
  gap: 12px;
  padding: 12px;
}

.inspector-summary {
  display: grid;
  gap: 8px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.summary-kind {
  color: #0369a1;
  font-size: 12px;
  font-weight: 700;
}

.summary-title {
  overflow: hidden;
  color: #111827;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-meta,
.summary-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.summary-meta span,
.summary-badges span {
  max-width: 100%;
  overflow: hidden;
  padding: 3px 7px;
  color: #475569;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-badges span {
  color: #155e75;
  background: #ecfeff;
  border-color: #a5f3fc;
}

.inspector-tabs {
  min-width: 0;
}

.inspector-tabs :deep(.el-tabs__header) {
  margin-bottom: 10px;
}

.inspector-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}

.inspector-tabs :deep(.el-tabs__item) {
  height: 34px;
  padding: 0 10px;
  font-size: 13px;
}

.property-section {
  display: grid;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.property-section:last-child {
  border-bottom: 0;
}

.object-tree-section {
  gap: 10px;
}

.tree-block {
  display: grid;
  gap: 4px;
}

.tree-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
}

.tree-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 6px 8px;
  color: #334155;
  text-align: left;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.tree-item.active {
  color: #0f172a;
  background: #e0f2fe;
  border-color: #38bdf8;
}

.tree-kind {
  min-width: 28px;
  color: #64748b;
  font-size: 11px;
}

.tree-name,
.tree-key {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-name {
  font-weight: 600;
}

.tree-key {
  max-width: 76px;
  color: #94a3b8;
  font-size: 11px;
}

.tree-empty {
  padding: 6px 8px;
  color: #94a3b8;
  font-size: 12px;
}

.hidden-file-input {
  display: none;
}

.section-title {
  color: #111827;
  font-size: 13px;
  font-weight: 700;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-note {
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
}

.readonly-grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 10px;
  padding: 10px;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
}

.readonly-grid strong {
  min-width: 0;
  overflow: hidden;
  color: #111827;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subsection-title {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.size-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.button-row {
  display: grid;
  gap: 8px;
}

.label-with-help {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.help-button {
  width: 22px;
  height: 22px;
  padding: 0;
  color: #0369a1;
  font-size: 12px;
  line-height: 1;
  background: #e0f2fe;
  border-color: #bae6fd;
  border-radius: 999px;
}

.help-button:hover {
  background: #bae6fd;
}

.rule-item-actions {
  display: grid;
  gap: 6px;
  min-width: 66px;
}

.layer-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

label {
  display: grid;
  gap: 6px;
  color: #4b5563;
  font-size: 13px;
}

.dynamic-field {
  display: grid;
  gap: 6px;
}

.dynamic-field-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #4b5563;
  font-size: 13px;
}

.required-mark {
  color: #dc2626;
  font-weight: 700;
}

.dynamic-field-unit {
  color: #94a3b8;
  font-size: 12px;
}

input,
textarea {
  width: 100%;
  padding: 8px;
  color: #111827;
  background: #f9fafb;
  border: 1px solid #d8dde6;
  border-radius: 6px;
}

textarea {
  min-height: 72px;
  resize: vertical;
  line-height: 1.5;
}

select {
  width: 100%;
  padding: 8px;
  color: #111827;
  background: #f9fafb;
  border: 1px solid #d8dde6;
  border-radius: 6px;
}

input[type="color"] {
  height: 36px;
  padding: 4px;
}

button {
  padding: 7px 10px;
  color: #155e75;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
  border-radius: 6px;
  cursor: pointer;
}

button:hover {
  background: #cffafe;
}

button.tree-item {
  color: #334155;
  background: #f8fafc;
  border-color: #e2e8f0;
}

button.tree-item:hover {
  background: #eef6ff;
}

button.tree-item.active {
  color: #0f172a;
  background: #e0f2fe;
  border-color: #38bdf8;
}

.checkbox-row {
  grid-template-columns: 16px 1fr;
  align-items: center;
}

.checkbox-row input {
  width: 16px;
  height: 16px;
  padding: 0;
}

.dynamic-checkbox-row {
  color: #111827;
}

.rule-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.rule-builder {
  display: grid;
  gap: 10px;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.drawer-form {
  display: grid;
  gap: 12px;
  padding-right: 4px;
}

.section-subtitle {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.compact-rule-builder {
  margin-top: 8px;
}

.status-preview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.status-preview-label {
  color: #6b7280;
  font-size: 12px;
}

.status-preview-chip {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
  padding: 4px 8px;
  color: #111827;
  border: 1px solid #d8dde6;
  border-radius: 6px;
  font-size: 12px;
}

.status-preview-chip img,
.status-preview-color {
  width: 22px;
  height: 22px;
  border-radius: 4px;
}

.status-preview-chip img {
  object-fit: contain;
}

.rule-list {
  display: grid;
  gap: 8px;
}

.rule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.rule-item strong,
.rule-item span {
  display: block;
}

.rule-item strong {
  color: #111827;
  font-size: 13px;
}

.rule-item span {
  margin-top: 2px;
  color: #6b7280;
  font-size: 12px;
}

.hint {
  padding: 10px;
  color: #4b5563;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}
</style>
