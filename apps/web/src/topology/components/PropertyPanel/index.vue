<script setup lang="ts">
import { DEFAULT_TOPOLOGY_CANVAS, DEFAULT_TOPOLOGY_TEXT_COLOR, createNodeFieldReference, describeRuleBusiness, expressionFieldWithSource as buildExpressionFieldWithSource, inferRuleFieldReference, normalizeExpressionPath, resolveTopologyTextColor, ruleHealth, type Condition, type ConditionGroup, type ContainerStyle, type DisplayRule, type FormFieldDefinition, type LinkRuntimeRule, type LinkStyle, type NodeLabelPosition, type NodeLabelStyle, type NodeStatusKey, type NodeTypeDefinition, type TopologyCanvasConfig, type TopologyData, type TopologyLink, type TopologyNode } from "@topo-editor/topology-shared";
import { ElMessage } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { isImageAsset, isOssAssetRef, resolveAssetUrl, uploadImageAsset } from "../../services/assetApi";
import JsonTextEditor from "../JsonTextEditor.vue";
import RuleConditionEditor from "./RuleConditionEditor.vue";
import {
  conditionGroupFields,
  createRuleConditionDraft,
  describeConditionGroup,
  fieldOptionsForNode,
  isFlatEqualityConditionGroup,
  isSelectableRuleNode,
  normalizeDraftValue,
  parseRuleConditionDraft,
  type RuleConditionDraft,
  type RuleConditionLogic
} from "./ruleCondition";

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
  previewContainerStyle: [key: string, style: ContainerStyle];
  clearContainerStylePreview: [key?: string];
}>();

type NodeTreeRow = {
  node: TopologyNode;
  level: number;
};

type RuleNodeGroup = {
  typeId: string;
  label: string;
  nodes: TopologyNode[];
};

type ActiveDrawer = "" | "nodeEvent" | "nodeRule" | "buttonVisibilityRule" | "containerRule" | "linkAdvancedStyle" | "linkRule";

const runningRuleForm = reactive({
  editingRuleId: "",
  logic: "and" as RuleConditionLogic,
  conditions: [] as RuleConditionDraft[],
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
const activeContainerPreview = ref<{ nodeKey: string; source: "form" | "rule"; ruleId?: string } | null>(null);

const linkDashPresets = [
  { label: "实线", value: "solid", dash: undefined },
  { label: "短虚线", value: "short-dashed", dash: [9, 9] },
  { label: "长虚线", value: "long-dashed", dash: [16, 10] },
  { label: "点线", value: "dotted", dash: [2, 6] },
  { label: "点划线", value: "dashdot", dash: [12, 6, 2, 6] },
  { label: "自定义", value: "custom", dash: undefined }
] as const;

const nodeStatusRuleForm = reactive({
  editingRuleId: "",
  logic: "and" as RuleConditionLogic,
  conditions: [] as RuleConditionDraft[],
  priority: 10,
  status: "default"
});
let activeRuleNodeKey = "";

const containerRuleForm = reactive({
  editingRuleId: "",
  logic: "and" as RuleConditionLogic,
  conditions: [] as RuleConditionDraft[],
  priority: 10,
  overrideBackgroundStyle: true,
  backgroundColor: "#eef6ff",
  backgroundOpacity: 100,
  transparentBackground: false,
  overrideBorderStyle: true,
  borderColor: "#3b82f6",
  dashedBorder: false
});

const buttonVisibilityRuleForm = reactive({
  editingRuleId: "",
  logic: "and" as RuleConditionLogic,
  conditions: [] as RuleConditionDraft[],
  visible: true,
  priority: 10
});

const nodeEventForm = reactive({
  enabled: true,
  trigger: "click" as NonNullable<TopologyNode["eventConfig"]>[number]["trigger"],
  eventName: "nodeClick",
  eventKey: "",
  eventData: {} as Record<string, unknown>,
  eventDataTemplate: {} as Record<string, unknown>,
  bindNodeKey: "",
  bindDataPath: ""
});

const nodeStatusOptions: Array<{ label: string; value: NodeStatusKey }> = [
  { label: "默认", value: "default" },
  { label: "运行", value: "running" },
  { label: "故障", value: "fault" },
  { label: "离线", value: "offline" }
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
const DEFAULT_NODE_LABEL_STYLE = {
  color: DEFAULT_TOPOLOGY_TEXT_COLOR,
  fontSize: 13,
  fontWeight: "600",
  fontStyle: "normal" as const,
  textDecoration: "none",
  textAlign: "center" as const
};
const annotationFontWeightOptions = [
  { label: "普通", value: "400" },
  { label: "中等", value: "500" },
  { label: "半粗", value: "600" },
  { label: "粗体", value: "700" }
];
const annotationTextDecorationOptions = [
  { label: "无", value: "none" },
  { label: "下划线", value: "underline" },
  { label: "删除线", value: "line-through" },
  { label: "下划线 + 删除线", value: "underline line-through" }
];
const annotationTextAlignOptions = [
  { label: "左对齐", value: "left" },
  { label: "居中", value: "center" },
  { label: "右对齐", value: "right" }
];
const buttonImageInputRef = ref<HTMLInputElement | null>(null);
const uploadingButtonImage = ref(false);
const assetUrlMap = ref<Record<string, string>>({});
const activeNodeTab = ref("base");
const activeGroupTab = ref("base");
const activeLinkTab = ref("style");
const activeDrawer = ref<ActiveDrawer>("");

function openDrawer(drawer: ActiveDrawer) {
  if (drawer === "nodeRule") {
    nodeStatusRuleForm.priority = 10;
    nodeStatusRuleForm.status = "default";
    resetNodeStatusRuleConditions();
  } else if (drawer === "containerRule" && props.selectedNode?.isGroup) {
    containerRuleForm.priority = 10;
    containerRuleForm.overrideBackgroundStyle = true;
    containerRuleForm.overrideBorderStyle = true;
    resetContainerRuleConditions();
    syncContainerRuleStyleDefaults(props.selectedNode);
  } else if (drawer === "buttonVisibilityRule") {
    buttonVisibilityRuleForm.priority = 10;
    buttonVisibilityRuleForm.visible = true;
    resetButtonVisibilityRuleConditions();
  } else if (drawer === "linkRule") {
    runningRuleForm.priority = 10;
    runningRuleForm.lineState = "off";
    runningRuleForm.overrideMainStyle = true;
    runningRuleForm.color = "#42B0FF";
    runningRuleForm.width = 3;
    runningRuleForm.opacity = 1;
    runningRuleForm.lineCap = "butt";
    runningRuleForm.dash = undefined;
    runningRuleForm.overrideFlowStyle = true;
    runningRuleForm.animated = false;
    runningRuleForm.flowDirection = "fromTo";
    runningRuleForm.flowColor = "#ffffff";
    runningRuleForm.flowWidth = 3;
    runningRuleForm.flowOpacity = 0.85;
    runningRuleForm.flowDash = [9, 9];
    runningRuleForm.flowSpeed = 4;
    resetRunningRuleConditions();
  }
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

function topologyCanvas(): TopologyCanvasConfig {
  const width = Number(props.topology?.canvas?.width);
  const height = Number(props.topology?.canvas?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : DEFAULT_TOPOLOGY_CANVAS.width,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : DEFAULT_TOPOLOGY_CANVAS.height
  };
}

function updateTopologyCanvasSize(field: keyof TopologyCanvasConfig, value: string) {
  const nextValue = Math.round(Number(value));
  if (!Number.isFinite(nextValue) || nextValue <= 0) return;
  emit("updateTopology", {
    canvas: {
      ...topologyCanvas(),
      [field]: nextValue
    }
  });
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
    return ["textTemplate", "textColor", "textSize", "fontWeight", "fontStyle", "textDecoration", "textAlign", "lineHeight"].includes(fieldName);
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
  return resolveTopologyTextColor(node.props?.textColor, selectedNodeType.value?.annotationDefaults?.textColor);
}

function nodeTextSize(node: TopologyNode) {
  const size = Number(node.props?.textSize);
  if (Number.isFinite(size) && size > 0) return Math.round(size);
  return Math.round(selectedNodeType.value?.annotationDefaults?.textSize ?? 14);
}

function nodeTextLineHeight(node: TopologyNode) {
  const lineHeight = Number(node.props?.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return Math.round(lineHeight);
  const defaultLineHeight = Number(selectedNodeType.value?.annotationDefaults?.lineHeight);
  if (Number.isFinite(defaultLineHeight) && defaultLineHeight > 0) return Math.round(defaultLineHeight);
  return Math.round(nodeTextSize(node) * 1.4);
}

function nodeTextFontWeight(node: TopologyNode) {
  const fontWeight = node.props?.fontWeight;
  if (typeof fontWeight === "number") return String(fontWeight);
  if (typeof fontWeight === "string" && fontWeight.trim()) return fontWeight;
  const defaultFontWeight = selectedNodeType.value?.annotationDefaults?.fontWeight;
  return defaultFontWeight === undefined || defaultFontWeight === null ? "400" : String(defaultFontWeight);
}

function nodeTextFontStyle(node: TopologyNode) {
  const fontStyle = node.props?.fontStyle;
  if (fontStyle === "italic") return fontStyle;
  return selectedNodeType.value?.annotationDefaults?.fontStyle === "italic" ? "italic" : "normal";
}

function nodeTextDecoration(node: TopologyNode) {
  const textDecoration = node.props?.textDecoration;
  if (typeof textDecoration === "string" && textDecoration.trim()) return textDecoration;
  return selectedNodeType.value?.annotationDefaults?.textDecoration ?? "none";
}

function nodeTextAlign(node: TopologyNode) {
  const textAlign = node.props?.textAlign;
  if (textAlign === "center" || textAlign === "right") return textAlign;
  const defaultTextAlign = selectedNodeType.value?.annotationDefaults?.textAlign;
  return defaultTextAlign === "center" || defaultTextAlign === "right" ? defaultTextAlign : "left";
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

function updateAnnotationLineHeight(value: string) {
  const lineHeight = Number(value);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
  updateSelectedNodeProps({ lineHeight: Math.round(lineHeight) });
}

function updateAnnotationFontWeight(value: string) {
  updateSelectedNodeProps({ fontWeight: value });
}

function updateAnnotationFontStyle(value: string) {
  updateSelectedNodeProps({ fontStyle: value === "italic" ? "italic" : "normal" });
}

function updateAnnotationTextDecoration(value: string) {
  updateSelectedNodeProps({ textDecoration: value });
}

function updateAnnotationTextAlign(value: string) {
  updateSelectedNodeProps({ textAlign: value === "center" || value === "right" ? value : "left" });
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

function assetPreviewUrl(value?: string) {
  return value ? assetUrlMap.value[value] || (!isOssAssetRef(value) ? value : "") : "";
}

async function ensureAssetUrl(value?: string) {
  if (!value || !isImageAsset(value) || assetUrlMap.value[value]) return;
  try {
    const url = await resolveAssetUrl(value);
    if (url) assetUrlMap.value = { ...assetUrlMap.value, [value]: url };
  } catch {
    // Keep the oss reference; preview can resolve it after auth/network recovers.
  }
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
    updateButtonImage(result.ref);
    await ensureAssetUrl(result.ref);
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

function nodeLabelOffset(node: TopologyNode, axis: "x" | "y") {
  const value = Number(node.labelOffset?.[axis]);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function updateNodeLabelOffset(axis: "x" | "y", raw: string) {
  if (!props.selectedNode) return;
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  const current = props.selectedNode.labelOffset ?? { x: 0, y: 0 };
  emit("updateNode", props.selectedNode.key, {
    labelOffset: { ...current, [axis]: Math.round(value) }
  });
}

function nodeLabelStyleColor(node: TopologyNode) {
  const color = node.labelStyle?.color;
  return resolveTopologyTextColor(color, DEFAULT_NODE_LABEL_STYLE.color);
}

function nodeLabelStyleFontSize(node: TopologyNode) {
  const fontSize = Number(node.labelStyle?.fontSize);
  return Number.isFinite(fontSize) && fontSize > 0 ? Math.round(fontSize) : DEFAULT_NODE_LABEL_STYLE.fontSize;
}

function nodeLabelStyleFontWeight(node: TopologyNode) {
  const fontWeight = node.labelStyle?.fontWeight;
  if (typeof fontWeight === "number") return String(fontWeight);
  if (typeof fontWeight === "string" && fontWeight.trim()) return fontWeight;
  return DEFAULT_NODE_LABEL_STYLE.fontWeight;
}

function nodeLabelStyleFontStyle(node: TopologyNode) {
  return node.labelStyle?.fontStyle === "italic" ? "italic" : DEFAULT_NODE_LABEL_STYLE.fontStyle;
}

function nodeLabelStyleTextDecoration(node: TopologyNode) {
  const textDecoration = node.labelStyle?.textDecoration;
  return typeof textDecoration === "string" && textDecoration.trim() ? textDecoration : DEFAULT_NODE_LABEL_STYLE.textDecoration;
}

function nodeLabelStyleTextAlign(node: TopologyNode) {
  const textAlign = node.labelStyle?.textAlign;
  return textAlign === "left" || textAlign === "right" ? textAlign : DEFAULT_NODE_LABEL_STYLE.textAlign;
}

function updateNodeLabelStyle(patch: NodeLabelStyle) {
  if (!props.selectedNode) return;
  emit("updateNode", props.selectedNode.key, {
    labelStyle: {
      ...(props.selectedNode.labelStyle ?? {}),
      ...patch
    }
  });
}

function updateNodeLabelStyleColor(value: string) {
  updateNodeLabelStyle({ color: value });
}

function updateNodeLabelStyleFontSize(value: string) {
  const fontSize = Number(value);
  if (!Number.isFinite(fontSize) || fontSize <= 0) return;
  updateNodeLabelStyle({ fontSize: Math.round(fontSize) });
}

function updateNodeLabelStyleFontWeight(value: string) {
  updateNodeLabelStyle({ fontWeight: value });
}

function updateNodeLabelStyleFontStyle(value: string) {
  updateNodeLabelStyle({ fontStyle: value === "italic" ? "italic" : "normal" });
}

function updateNodeLabelStyleTextDecoration(value: string) {
  updateNodeLabelStyle({ textDecoration: value });
}

function updateNodeLabelStyleTextAlign(value: string) {
  updateNodeLabelStyle({ textAlign: value === "left" || value === "right" ? value : "center" });
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
  const opacity = Number(node.runtime?.backgroundOpacity ?? node.props?.backgroundOpacity ?? selectedNodeType.value?.groupStyleDefaults?.backgroundOpacity);
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
  if (typeof node.runtime?.transparentBackground === "boolean") return node.runtime.transparentBackground;
  const value = node.props?.transparentBackground;
  if (typeof value === "boolean") return value;
  return selectedNodeType.value?.groupStyleDefaults?.transparentBackground === true;
}

function groupDashedBorder(node: TopologyNode) {
  if (typeof node.runtime?.dashedBorder === "boolean") return node.runtime.dashedBorder;
  const value = node.props?.dashedBorder;
  if (typeof value === "boolean") return value;
  return selectedNodeType.value?.groupStyleDefaults?.dashedBorder === true;
}

function syncContainerRuleStyleDefaults(node: TopologyNode) {
  containerRuleForm.backgroundColor = groupBackgroundColor(node);
  containerRuleForm.backgroundOpacity = groupBackgroundOpacity(node);
  containerRuleForm.transparentBackground = groupTransparentBackground(node);
  containerRuleForm.borderColor = groupBorderColor(node);
  containerRuleForm.dashedBorder = groupDashedBorder(node);
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

function defaultEventKey(node: TopologyNode) {
  return nodeIdentifier(node) || node.key;
}

function resetNodeEventForm(node: TopologyNode) {
  nodeEventForm.enabled = true;
  nodeEventForm.trigger = "click";
  nodeEventForm.eventName = "nodeClick";
  nodeEventForm.eventKey = defaultEventKey(node);
  nodeEventForm.eventData = {};
  nodeEventForm.eventDataTemplate = {};
  nodeEventForm.bindNodeKey = node.key;
  nodeEventForm.bindDataPath = "";
}

function addNodeEventConfig() {
  if (!props.selectedNode || !nodeEventForm.eventName.trim() || !nodeEventForm.eventKey.trim()) return;

  emit("updateNode", props.selectedNode.key, {
    eventConfig: [
      ...(props.selectedNode.eventConfig ?? []),
      {
        id: createRuleId("node_event"),
        enabled: nodeEventForm.enabled,
        trigger: nodeEventForm.trigger,
        eventName: nodeEventForm.eventName.trim(),
        eventKey: nodeEventForm.eventKey.trim(),
        eventData: nodeEventForm.eventData,
        eventDataTemplate: nodeEventForm.eventDataTemplate,
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

const ruleNodeNameCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base"
});

const ruleNodeGroups = computed<RuleNodeGroup[]>(() => {
  const groupsByType = new Map<string, TopologyNode[]>();
  for (const node of props.topology?.nodes ?? []) {
    if (!isSelectableRuleNode(node)) continue;
    const nodes = groupsByType.get(node.typeId) ?? [];
    nodes.push(node);
    groupsByType.set(node.typeId, nodes);
  }

  return Array.from(groupsByType, ([typeId, nodes]) => ({
    typeId,
    label: nodeTypeOf(typeId)?.name?.trim() || typeId,
    nodes: [...nodes].sort((left, right) => {
      return ruleNodeNameCollator.compare(left.label, right.label)
        || ruleNodeNameCollator.compare(left.key, right.key);
    })
  })).sort((left, right) => {
    return ruleNodeNameCollator.compare(left.label, right.label)
      || ruleNodeNameCollator.compare(left.typeId, right.typeId);
  });
});

const availableRuleNodes = computed(() => ruleNodeGroups.value.flatMap((group) => group.nodes));

const ruleNodeCascaderOptions = computed(() => ruleNodeGroups.value.map((group) => ({
  value: group.typeId,
  label: group.label,
  children: group.nodes.map((node) => ({
    value: node.key,
    label: node.label
  }))
})));

function isAvailableRuleNodeKey(nodeKey: string) {
  return availableRuleNodes.value.some((node) => node.key === nodeKey);
}

function defaultRuleNodeKey(preferredNodeKey?: string) {
  if (preferredNodeKey && isAvailableRuleNodeKey(preferredNodeKey)) return preferredNodeKey;
  return availableRuleNodes.value[0]?.key ?? "";
}

const ruleDataSources = computed(() => (props.topology?.dataSources ?? []).filter((source) => source.enabled !== false));

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

  const nodeKeys = new Set(nodes.map((item) => item.key));
  for (const node of nodes.filter((item) => !item.group || !nodeKeys.has(item.group))) {
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

const nodeMapByKey = computed(() => new Map((props.topology?.nodes ?? []).map((node) => [node.key, node])));

function nodeByKey(key: string) {
  return nodeMapByKey.value.get(key) ?? null;
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

watch(() => [
  props.selectedNode?.props?.icon,
  selectedNodeType.value?.icon,
  selectedNodeType.value?.buttonDefaults?.icon,
  ...Object.values(selectedNodeType.value?.statusImages ?? {})
], (values) => {
  values.forEach((value) => {
    if (typeof value === "string") void ensureAssetUrl(value);
  });
}, { immediate: true });

function isImageIcon(icon?: string) {
  return isImageAsset(icon);
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

function expressionFieldWithSource(node: TopologyNode | null, field: string, sourceId: string) {
  return buildExpressionFieldWithSource(props.topology, node, field, sourceId);
}

function defaultRuleSourceId(node: TopologyNode | null) {
  if (node?.dataBinding?.sourceId && ruleDataSources.value.some((source) => source.sourceId === node.dataBinding?.sourceId)) {
    return node.dataBinding.sourceId;
  }
  return ruleDataSources.value[0]?.sourceId ?? "";
}

function createNodeCondition(nodeKey: string, field: string, value: string) {
  const node = nodeByKey(nodeKey);
  const options = fieldOptionsForNode(node);
  const selectedField = options.some((option) => option.field === field)
    ? field
    : options[0]?.field ?? "state";
  return createRuleConditionDraft(nodeKey, selectedField, value, defaultRuleSourceId(node));
}

function createMetaDataCondition(field: string, value: string) {
  const draft = createRuleConditionDraft("", "__custom__", value);
  draft.sourceType = "metaData";
  draft.customField = field;
  return draft;
}

function resetNodeStatusRuleConditions() {
  const nodeKey = defaultRuleNodeKey(props.selectedNode?.key);
  nodeStatusRuleForm.editingRuleId = "";
  nodeStatusRuleForm.logic = "and";
  nodeStatusRuleForm.conditions = [createNodeCondition(nodeKey, "status", "normal")];
}

function resetContainerRuleConditions() {
  const nodeKey = defaultRuleNodeKey(props.selectedNode?.key);
  containerRuleForm.editingRuleId = "";
  containerRuleForm.logic = "and";
  containerRuleForm.conditions = [createNodeCondition(nodeKey, "status", "normal")];
}

function resetButtonVisibilityRuleConditions() {
  buttonVisibilityRuleForm.editingRuleId = "";
  buttonVisibilityRuleForm.logic = "and";
  buttonVisibilityRuleForm.conditions = [createMetaDataCondition("qfStatus.button1", "show")];
}

function resetRunningRuleConditions() {
  const nodeKey = defaultRuleNodeKey(props.selectedLink?.from);
  runningRuleForm.editingRuleId = "";
  runningRuleForm.logic = "and";
  runningRuleForm.conditions = [createNodeCondition(nodeKey, "state", "closed")];
}

function buildConditionGroup(drafts: RuleConditionDraft[], logic: RuleConditionLogic): ConditionGroup | null {
  if (!drafts.length) {
    ElMessage.warning("请至少添加一个条件");
    return null;
  }

  const conditions: Condition[] = [];
  for (const [index, draft] of drafts.entries()) {
    if (draft.sourceType === "metaData") {
      const field = normalizeExpressionPath(draft.customField);
      if (!field) {
        ElMessage.warning(`请填写条件 ${index + 1} 的父组件字段`);
        return null;
      }
      conditions.push({
        field,
        ref: { kind: "metadata", field, legacyExpression: field },
        operator: "eq",
        value: normalizeDraftValue(draft)
      });
      continue;
    }

    const node = nodeByKey(draft.nodeKey);
    if (!node || !isSelectableRuleNode(node)) {
      ElMessage.warning(`请重新选择条件 ${index + 1} 的节点`);
      return null;
    }
    const sourceExists = ruleDataSources.value.some((source) => source.sourceId === draft.sourceId);
    if ((draft.sourceId && !sourceExists) || (ruleDataSources.value.length > 1 && !draft.sourceId)) {
      ElMessage.warning(`请重新选择条件 ${index + 1} 的接口`);
      return null;
    }
    const rawField = draft.field === "__custom__" ? draft.customField.trim() : draft.field;
    if (!rawField) {
      ElMessage.warning(`请填写条件 ${index + 1} 的字段`);
      return null;
    }
    const option = draft.field === "__custom__"
      ? undefined
      : fieldOptionsForNode(node).find((item) => item.field === draft.field);
    const sourceId = draft.sourceId || defaultRuleSourceId(node);
    const field = draft.preserveRawField
      ? normalizeExpressionPath(rawField)
      : expressionFieldWithSource(node, rawField, sourceId);
    const ref = draft.preserveRawField
      ? inferRuleFieldReference(field, props.topology ?? { nodes: [], dataSources: [] }, node.key).ref
      : createNodeFieldReference(props.topology ?? { nodes: [node], dataSources: [] }, node, sourceId, rawField);
    conditions.push({
      field,
      ref,
      operator: "eq",
      value: normalizeDraftValue(draft, option)
    });
  }

  return { logic, conditions };
}

function updateNodeRuleStatus(status: string) {
  nodeStatusRuleForm.status = status;
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

function buildContainerRuleStyle() {
  const style: ContainerStyle = {};
  if (containerRuleForm.overrideBackgroundStyle) {
    style.backgroundColor = containerRuleForm.backgroundColor;
    style.backgroundOpacity = Math.max(0, Math.min(100, Math.round(Number(containerRuleForm.backgroundOpacity) || 0)));
    style.transparentBackground = containerRuleForm.transparentBackground;
  }
  if (containerRuleForm.overrideBorderStyle) {
    style.borderColor = containerRuleForm.borderColor;
    style.dashedBorder = containerRuleForm.dashedBorder;
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

function previewContainerRuleForm() {
  if (!props.selectedNode?.isGroup) return;
  activeContainerPreview.value = { nodeKey: props.selectedNode.key, source: "form" };
  emit("previewContainerStyle", props.selectedNode.key, buildContainerRuleStyle() ?? {});
}

function previewContainerRule(rule: NonNullable<TopologyNode["displayRules"]>[number]) {
  if (!props.selectedNode?.isGroup) return;
  activeContainerPreview.value = { nodeKey: props.selectedNode.key, source: "rule", ruleId: rule.id };
  emit("previewContainerStyle", props.selectedNode.key, rule.action.style ?? {});
}

function clearLinkPreview() {
  emit("clearLinkStylePreview", props.selectedLink?.key);
  activeLinkPreview.value = null;
}

function clearContainerPreview() {
  emit("clearContainerStylePreview", props.selectedNode?.key);
  activeContainerPreview.value = null;
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

function isPreviewingContainerRuleForm() {
  const preview = activeContainerPreview.value;
  if (!preview) return false;
  return preview.nodeKey === props.selectedNode?.key && preview.source === "form";
}

function isPreviewingContainerRule(rule: NonNullable<TopologyNode["displayRules"]>[number]) {
  const preview = activeContainerPreview.value;
  if (!preview) return false;
  return preview.nodeKey === props.selectedNode?.key
    && preview.source === "rule"
    && preview.ruleId === rule.id;
}

function conditionRuleName(group: ConditionGroup, action: string) {
  const count = group.conditions.length;
  if (count === 1) return `${describeConditionGroup(group)} 时${action}`;
  return `${count} 个条件${group.logic === "or" ? "任一满足" : "全部满足"}时${action}`;
}

function saveDisplayRule(rule: DisplayRule, editingRuleId: string) {
  if (!props.selectedNode) return;
  const currentRules = props.selectedNode.displayRules ?? [];
  emit("updateNode", props.selectedNode.key, {
    displayRules: editingRuleId
      ? currentRules.map((item) => item.id === editingRuleId ? rule : item)
      : [...currentRules, rule]
  });
}

function saveRunningRule(rule: LinkRuntimeRule, editingRuleId: string) {
  if (!props.selectedLink) return;
  const currentRules = props.selectedLink.rules ?? [];
  emit("updateLink", props.selectedLink.key, {
    rules: editingRuleId
      ? currentRules.map((item) => item.id === editingRuleId ? rule : item)
      : [...currentRules, rule]
  });
}

function addNodeStatusRule() {
  if (!props.selectedNode) return false;
  const condition = buildConditionGroup(nodeStatusRuleForm.conditions, nodeStatusRuleForm.logic);
  if (!condition) return false;
  const editingRule = props.selectedNode.displayRules?.find((rule) => rule.id === nodeStatusRuleForm.editingRuleId);
  const rule: DisplayRule = {
    ...(editingRule ?? {}),
    id: editingRule?.id ?? createRuleId("rule_node_status"),
    name: conditionRuleName(condition, `状态为 ${nodeStatusRuleForm.status}`),
    priority: Number.isFinite(nodeStatusRuleForm.priority) ? Math.round(nodeStatusRuleForm.priority) : 10,
    condition,
    action: {
      ...(editingRule?.action ?? {}),
      status: nodeStatusRuleForm.status
    }
  };
  saveDisplayRule(rule, nodeStatusRuleForm.editingRuleId);
  return true;
}

function addContainerStyleRule() {
  if (!props.selectedNode?.isGroup) return false;
  const condition = buildConditionGroup(containerRuleForm.conditions, containerRuleForm.logic);
  if (!condition) return false;
  const style = buildContainerRuleStyle();
  if (!style) {
    ElMessage.warning("请至少选择一组需要覆盖的容器样式");
    return false;
  }

  const editingRule = props.selectedNode.displayRules?.find((rule) => rule.id === containerRuleForm.editingRuleId);
  const rule: DisplayRule = {
    ...(editingRule ?? {}),
    id: editingRule?.id ?? createRuleId("rule_container_style"),
    name: conditionRuleName(condition, "设置容器样式"),
    priority: Number.isFinite(containerRuleForm.priority) ? Math.round(containerRuleForm.priority) : 10,
    condition,
    action: {
      ...(editingRule?.action ?? {}),
      style
    }
  };
  saveDisplayRule(rule, containerRuleForm.editingRuleId);
  return true;
}

function updateButtonDefaultVisible(value: boolean) {
  if (!props.selectedNode || !isSelectedControlNode.value) return;
  updateSelectedNodeProps({ buttonDefaultVisible: value });
}

function addButtonVisibilityRule() {
  if (!props.selectedNode || !isSelectedControlNode.value) return false;
  const condition = buildConditionGroup(buttonVisibilityRuleForm.conditions, buttonVisibilityRuleForm.logic);
  if (!condition) return false;
  const actionLabel = buttonVisibilityRuleForm.visible ? "按钮显示" : "按钮隐藏";
  const editingRule = props.selectedNode.displayRules?.find((rule) => rule.id === buttonVisibilityRuleForm.editingRuleId);
  const rule: DisplayRule = {
    ...(editingRule ?? {}),
    id: editingRule?.id ?? createRuleId("rule_button_visibility"),
    name: conditionRuleName(condition, actionLabel),
    priority: Number.isFinite(buttonVisibilityRuleForm.priority) ? Math.round(buttonVisibilityRuleForm.priority) : 10,
    condition,
    action: {
      ...(editingRule?.action ?? {}),
      visible: buttonVisibilityRuleForm.visible
    }
  };
  saveDisplayRule(rule, buttonVisibilityRuleForm.editingRuleId);
  return true;
}

function addRunningStateRule() {
  if (!props.selectedLink) return false;
  const condition = buildConditionGroup(runningRuleForm.conditions, runningRuleForm.logic);
  if (!condition) return false;
  const lineStateLabel = linkStateOptions.find((item) => item.value === runningRuleForm.lineState)?.label ?? runningRuleForm.lineState;
  const style = buildRunningRuleStyle();
  const editingRule = props.selectedLink.rules?.find((rule) => rule.id === runningRuleForm.editingRuleId);
  const { style: _existingStyle, ...existingAction } = editingRule?.action ?? {};
  const rule: LinkRuntimeRule = {
    ...(editingRule ?? {}),
    id: editingRule?.id ?? createRuleId("rule_link_running"),
    name: conditionRuleName(condition, `线路${lineStateLabel}`),
    priority: Number.isFinite(runningRuleForm.priority) ? Math.round(runningRuleForm.priority) : 10,
    trigger: {
      ...(editingRule?.trigger ?? {}),
      type: editingRule?.trigger.type ?? "dataChange",
      sources: conditionGroupFields(condition)
    },
    condition,
    action: {
      ...existingAction,
      state: runningRuleForm.lineState,
      ...(style ? { style } : {})
    }
  };
  saveRunningRule(rule, runningRuleForm.editingRuleId);
  return true;
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
  if (activeContainerPreview.value?.nodeKey === props.selectedNode.key && activeContainerPreview.value.ruleId === ruleId) {
    clearContainerPreview();
  }
  emit("updateNode", props.selectedNode.key, {
    displayRules: (props.selectedNode.displayRules ?? []).filter((rule) => rule.id !== ruleId)
  });
}

function describeRule(rule: LinkRuntimeRule) {
  return props.topology ? describeRuleBusiness(rule, props.topology) : describeConditionGroup(rule.condition);
}

function describeDisplayRule(rule: NonNullable<TopologyNode["displayRules"]>[number]) {
  return props.topology ? describeRuleBusiness(rule, props.topology) : describeConditionGroup(rule.condition);
}

function ruleHealthLevel(rule: DisplayRule | LinkRuntimeRule) {
  return props.topology ? ruleHealth(rule, props.topology).level : "valid";
}

function displayRuleDrawer(rule: DisplayRule): ActiveDrawer | null {
  if (Object.prototype.hasOwnProperty.call(rule.action, "visible")) return "buttonVisibilityRule";
  if (Object.prototype.hasOwnProperty.call(rule.action, "status")) return "nodeRule";
  if (rule.action.style) return "containerRule";
  return null;
}

function canEditDisplayRule(rule: DisplayRule) {
  if (!isFlatEqualityConditionGroup(rule.condition)) return false;
  const drawer = displayRuleDrawer(rule);
  if (drawer === "containerRule") return props.selectedNode?.isGroup === true;
  if (drawer === "buttonVisibilityRule") return isSelectedControlNode.value;
  return drawer === "nodeRule";
}

function canEditLinkRule(rule: LinkRuntimeRule) {
  return isFlatEqualityConditionGroup(rule.condition);
}

function conditionDraftsForRule(rule: DisplayRule | LinkRuntimeRule, fallbackNodeKey: string, allowMetaData: boolean) {
  return rule.condition.conditions.map((condition) => (
    parseRuleConditionDraft(condition as Condition, props.topology, fallbackNodeKey, allowMetaData)
  ));
}

function editDisplayRule(rule: DisplayRule) {
  if (!props.selectedNode || !canEditDisplayRule(rule)) return;
  const drawer = displayRuleDrawer(rule);
  if (!drawer) return;
  const fallbackNodeKey = defaultRuleNodeKey(props.selectedNode.key);
  const logic = rule.condition.logic ?? "and";

  if (drawer === "nodeRule") {
    nodeStatusRuleForm.editingRuleId = rule.id;
    nodeStatusRuleForm.logic = logic;
    nodeStatusRuleForm.conditions = conditionDraftsForRule(rule, fallbackNodeKey, false);
    nodeStatusRuleForm.priority = rule.priority;
    nodeStatusRuleForm.status = rule.action.status ?? "default";
  } else if (drawer === "buttonVisibilityRule") {
    buttonVisibilityRuleForm.editingRuleId = rule.id;
    buttonVisibilityRuleForm.logic = logic;
    buttonVisibilityRuleForm.conditions = conditionDraftsForRule(rule, fallbackNodeKey, true);
    buttonVisibilityRuleForm.priority = rule.priority;
    buttonVisibilityRuleForm.visible = rule.action.visible !== false;
  } else {
    const style = rule.action.style ?? {};
    containerRuleForm.editingRuleId = rule.id;
    containerRuleForm.logic = logic;
    containerRuleForm.conditions = conditionDraftsForRule(rule, fallbackNodeKey, false);
    containerRuleForm.priority = rule.priority;
    containerRuleForm.overrideBackgroundStyle = ["backgroundColor", "backgroundOpacity", "transparentBackground"]
      .some((key) => Object.prototype.hasOwnProperty.call(style, key));
    containerRuleForm.overrideBorderStyle = ["borderColor", "dashedBorder"]
      .some((key) => Object.prototype.hasOwnProperty.call(style, key));
    containerRuleForm.backgroundColor = style.backgroundColor ?? groupBackgroundColor(props.selectedNode);
    containerRuleForm.backgroundOpacity = style.backgroundOpacity ?? groupBackgroundOpacity(props.selectedNode);
    containerRuleForm.transparentBackground = style.transparentBackground ?? groupTransparentBackground(props.selectedNode);
    containerRuleForm.borderColor = style.borderColor ?? groupBorderColor(props.selectedNode);
    containerRuleForm.dashedBorder = style.dashedBorder ?? groupDashedBorder(props.selectedNode);
  }
  activeDrawer.value = drawer;
}

function editLinkRule(rule: LinkRuntimeRule) {
  if (!props.selectedLink || !canEditLinkRule(rule)) return;
  const style = rule.action.style ?? {};
  runningRuleForm.editingRuleId = rule.id;
  runningRuleForm.logic = rule.condition.logic ?? "and";
  runningRuleForm.conditions = conditionDraftsForRule(rule, defaultRuleNodeKey(props.selectedLink.from), false);
  runningRuleForm.priority = rule.priority;
  runningRuleForm.lineState = rule.action.state ?? "off";
  runningRuleForm.overrideMainStyle = ["color", "width", "opacity", "lineCap", "dash"]
    .some((key) => Object.prototype.hasOwnProperty.call(style, key));
  runningRuleForm.color = style.color ?? "#42B0FF";
  runningRuleForm.width = style.width ?? 3;
  runningRuleForm.opacity = style.opacity ?? 1;
  runningRuleForm.lineCap = style.lineCap ?? "butt";
  runningRuleForm.dash = style.dash ? [...style.dash] : undefined;
  runningRuleForm.overrideFlowStyle = ["animated", "flowDirection", "flow"]
    .some((key) => Object.prototype.hasOwnProperty.call(style, key));
  runningRuleForm.animated = style.animated ?? false;
  runningRuleForm.flowDirection = style.flowDirection ?? "fromTo";
  runningRuleForm.flowColor = style.flow?.color ?? "#ffffff";
  runningRuleForm.flowWidth = style.flow?.width ?? 3;
  runningRuleForm.flowOpacity = style.flow?.opacity ?? 0.85;
  runningRuleForm.flowDash = style.flow?.dash ? [...style.flow.dash] : undefined;
  runningRuleForm.flowSpeed = style.flow?.speed ?? 4;
  activeDrawer.value = "linkRule";
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
  if (addNodeStatusRule()) closeDrawer();
}

function addButtonVisibilityRuleFromDrawer() {
  if (addButtonVisibilityRule()) closeDrawer();
}

function addContainerStyleRuleFromDrawer() {
  if (addContainerStyleRule()) closeDrawer();
}

function addRunningStateRuleFromDrawer() {
  if (addRunningStateRule()) closeDrawer();
}

watch(
  () => props.selectedNode?.key,
  () => {
    const previewNodeKey = activeContainerPreview.value?.nodeKey;
    if (previewNodeKey && previewNodeKey !== props.selectedNode?.key) {
      emit("clearContainerStylePreview", previewNodeKey);
      activeContainerPreview.value = null;
    }
    if (!props.selectedNode || activeRuleNodeKey === props.selectedNode.key) return;
    activeRuleNodeKey = props.selectedNode.key;
    resetNodeEventForm(props.selectedNode);
    if (props.selectedNode.isGroup) {
      syncContainerRuleStyleDefaults(props.selectedNode);
    }
  },
  { immediate: true }
);

watch(
  () => [
    props.selectedLink?.key,
    props.topology?.nodes.map((node) => `${node.key}:${node.typeId}:${node.label}`).join("|")
  ],
  () => {
    if (!props.selectedLink) return;
    const linkChanged = activeRuleLinkKey !== props.selectedLink.key;
    if (linkChanged && activeRuleLinkKey) {
      emit("clearLinkStylePreview", activeRuleLinkKey);
      activeLinkPreview.value = null;
    }
    activeRuleLinkKey = props.selectedLink.key;
  },
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
              <label class="checkbox-row">
                <input type="checkbox" :checked="selectedNode.props?.showLabel === true" @change="updateShowLabel(($event.target as HTMLInputElement).checked)" />
                展示名称
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

          <el-tab-pane label="规则" name="rules">
            <section class="property-section">
              <div class="section-header">
                <div>
                  <div class="section-title">容器运行规则</div>
                  <div class="section-note">{{ nodeRuleCount(selectedNode) }} 条规则</div>
                </div>
                <button type="button" @click="openDrawer('containerRule')">新增容器规则</button>
              </div>
              <div v-if="selectedNode.displayRules?.length" class="rule-list">
                <div v-for="rule in selectedNode.displayRules" :key="rule.id" class="rule-item" :class="{ 'is-invalid': ruleHealthLevel(rule) === 'invalid' }">
                  <div>
                    <strong>{{ rule.name }}</strong>
                    <span v-if="ruleHealthLevel(rule) !== 'valid'" class="rule-health-badge" :class="{ 'is-warning': ruleHealthLevel(rule) === 'warning' }">{{ ruleHealthLevel(rule) === 'invalid' ? '规则失效' : '需确认' }}</span>
                    <span>优先级 {{ rule.priority }}</span>
                    <span>{{ describeDisplayRule(rule) }}</span>
                  </div>
                  <div class="rule-actions">
                    <button v-if="rule.action.style && !isPreviewingContainerRule(rule)" type="button" @click="previewContainerRule(rule)">预览</button>
                    <button v-else-if="rule.action.style" type="button" @click="clearContainerPreview">停止预览</button>
                    <button v-if="canEditDisplayRule(rule)" type="button" @click="editDisplayRule(rule)">编辑</button>
                    <button type="button" @click="removeNodeDisplayRule(rule.id)">删除</button>
                  </div>
                </div>
              </div>
              <div v-else class="hint">暂无容器运行规则。</div>
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
              <div v-if="canPositionSelectedNodeLabel" class="size-grid">
                <label>
                  水平偏移
                  <input type="number" step="1" :value="nodeLabelOffset(selectedNode, 'x')" @input="updateNodeLabelOffset('x', ($event.target as HTMLInputElement).value)" @change="updateNodeLabelOffset('x', ($event.target as HTMLInputElement).value)" />
                </label>
                <label>
                  垂直偏移
                  <input type="number" step="1" :value="nodeLabelOffset(selectedNode, 'y')" @input="updateNodeLabelOffset('y', ($event.target as HTMLInputElement).value)" @change="updateNodeLabelOffset('y', ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
            </section>

            <section v-if="canPositionSelectedNodeLabel" class="property-section">
              <div class="section-title">名称样式</div>
              <div class="size-grid">
                <label>
                  文字颜色
                  <input type="color" :value="nodeLabelStyleColor(selectedNode)" @input="updateNodeLabelStyleColor(($event.target as HTMLInputElement).value)" />
                </label>
                <label>
                  文字大小
                  <input type="number" min="1" step="1" :value="nodeLabelStyleFontSize(selectedNode)" @input="updateNodeLabelStyleFontSize(($event.target as HTMLInputElement).value)" @change="updateNodeLabelStyleFontSize(($event.target as HTMLInputElement).value)" />
                </label>
              </div>
              <div class="size-grid">
                <label>
                  字重
                  <select :value="nodeLabelStyleFontWeight(selectedNode)" @change="updateNodeLabelStyleFontWeight(($event.target as HTMLSelectElement).value)">
                    <option v-for="option in annotationFontWeightOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label>
                  字形
                  <select :value="nodeLabelStyleFontStyle(selectedNode)" @change="updateNodeLabelStyleFontStyle(($event.target as HTMLSelectElement).value)">
                    <option value="normal">常规</option>
                    <option value="italic">斜体</option>
                  </select>
                </label>
              </div>
              <div class="size-grid">
                <label>
                  装饰线
                  <select :value="nodeLabelStyleTextDecoration(selectedNode)" @change="updateNodeLabelStyleTextDecoration(($event.target as HTMLSelectElement).value)">
                    <option v-for="option in annotationTextDecorationOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label>
                  对齐
                  <select :value="nodeLabelStyleTextAlign(selectedNode)" @change="updateNodeLabelStyleTextAlign(($event.target as HTMLSelectElement).value)">
                    <option v-for="option in annotationTextAlignOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
              </div>
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
              <div class="size-grid">
                <label>
                  文字颜色
                  <input type="color" :value="nodeTextColor(selectedNode)" @input="updateAnnotationTextColor(($event.target as HTMLInputElement).value)" />
                </label>
                <label>
                  文字大小
                  <input type="number" min="1" step="1" :value="nodeTextSize(selectedNode)" @input="updateAnnotationTextSize(($event.target as HTMLInputElement).value)" @change="updateAnnotationTextSize(($event.target as HTMLInputElement).value)" />
                </label>
              </div>
              <div class="size-grid">
                <label>
                  字重
                  <select :value="nodeTextFontWeight(selectedNode)" @change="updateAnnotationFontWeight(($event.target as HTMLSelectElement).value)">
                    <option v-for="option in annotationFontWeightOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label>
                  字形
                  <select :value="nodeTextFontStyle(selectedNode)" @change="updateAnnotationFontStyle(($event.target as HTMLSelectElement).value)">
                    <option value="normal">常规</option>
                    <option value="italic">斜体</option>
                  </select>
                </label>
              </div>
              <div class="size-grid">
                <label>
                  装饰线
                  <select :value="nodeTextDecoration(selectedNode)" @change="updateAnnotationTextDecoration(($event.target as HTMLSelectElement).value)">
                    <option v-for="option in annotationTextDecorationOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label>
                  对齐
                  <select :value="nodeTextAlign(selectedNode)" @change="updateAnnotationTextAlign(($event.target as HTMLSelectElement).value)">
                    <option v-for="option in annotationTextAlignOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
              </div>
              <label>
                行高
                <input type="number" min="1" step="1" :value="nodeTextLineHeight(selectedNode)" @input="updateAnnotationLineHeight(($event.target as HTMLInputElement).value)" @change="updateAnnotationLineHeight(($event.target as HTMLInputElement).value)" />
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
                <div v-for="rule in selectedNode.displayRules" :key="rule.id" class="rule-item" :class="{ 'is-invalid': ruleHealthLevel(rule) === 'invalid' }">
                  <div>
                    <strong>{{ rule.name }}</strong>
                    <span v-if="ruleHealthLevel(rule) !== 'valid'" class="rule-health-badge" :class="{ 'is-warning': ruleHealthLevel(rule) === 'warning' }">{{ ruleHealthLevel(rule) === 'invalid' ? '规则失效' : '需确认' }}</span>
                    <span>优先级 {{ rule.priority }}</span>
                    <span>{{ describeDisplayRule(rule) }}</span>
                  </div>
                  <div class="rule-item-actions">
                    <button v-if="canEditDisplayRule(rule)" type="button" @click="editDisplayRule(rule)">编辑</button>
                    <button type="button" @click="removeNodeDisplayRule(rule.id)">删除</button>
                  </div>
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
                <div v-for="rule in selectedLink.rules" :key="rule.id" class="rule-item" :class="{ 'is-invalid': ruleHealthLevel(rule) === 'invalid' }">
                  <div>
                    <strong>{{ rule.name }}</strong>
                    <span v-if="ruleHealthLevel(rule) !== 'valid'" class="rule-health-badge" :class="{ 'is-warning': ruleHealthLevel(rule) === 'warning' }">{{ ruleHealthLevel(rule) === 'invalid' ? '规则失效' : '需确认' }}</span>
                    <span>优先级 {{ rule.priority }}</span>
                    <span>{{ describeRule(rule) }}</span>
                  </div>
                  <div class="rule-item-actions">
                    <button v-if="!isPreviewingLinkRule(rule)" type="button" @click="previewLinkRule(rule)">预览</button>
                    <button v-else type="button" @click="clearLinkPreview">停止</button>
                    <button v-if="canEditLinkRule(rule)" type="button" @click="editLinkRule(rule)">编辑</button>
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
          <div class="size-grid">
            <label>
              画布宽度
              <input
                type="number"
                min="1"
                step="1"
                :value="topologyCanvas().width"
                @input="updateTopologyCanvasSize('width', ($event.target as HTMLInputElement).value)"
                @change="updateTopologyCanvasSize('width', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              画布高度
              <input
                type="number"
                min="1"
                step="1"
                :value="topologyCanvas().height"
                @input="updateTopologyCanvasSize('height', ($event.target as HTMLInputElement).value)"
                @change="updateTopologyCanvasSize('height', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
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
          <JsonTextEditor v-model="nodeEventForm.eventData" :height="120" />
        </label>
        <label>
          event data 模板 JSON
          <JsonTextEditor
            v-model="nodeEventForm.eventDataTemplate"
            :height="120"
            placeholder='{ "status": "${latest.data.qf1.status}" }'
          />
        </label>
        <button type="button" @click="addNodeEventFromDrawer">添加节点事件</button>
      </div>
    </el-drawer>

    <el-drawer :model-value="activeDrawer === 'nodeRule'" :title="nodeStatusRuleForm.editingRuleId ? '编辑节点状态规则' : '新增节点状态规则'" size="480px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedNode && topology" class="drawer-form">
        <RuleConditionEditor
          v-model="nodeStatusRuleForm.conditions"
          v-model:logic="nodeStatusRuleForm.logic"
          :nodes="topology.nodes"
          :data-sources="ruleDataSources"
          :node-options="ruleNodeCascaderOptions"
        />
        <label>
          设置状态
          <select :value="nodeStatusRuleForm.status" @change="updateNodeRuleStatus(($event.target as HTMLSelectElement).value)">
            <option v-for="status in selectedNodeStatusOptions" :key="status.value" :value="status.value">{{ status.label }}{{ status.image ? '（已配置图片）' : '' }}</option>
          </select>
        </label>
        <div class="status-preview-row">
          <span class="status-preview-label">展示状态</span>
          <span class="status-preview-chip">
            <img
              v-if="selectedNodeStatusOption?.image && isImageIcon(selectedNodeStatusOption.image) && assetPreviewUrl(selectedNodeStatusOption.image)"
              :src="assetPreviewUrl(selectedNodeStatusOption.image)"
              :alt="selectedNodeStatusOption.label"
            />
            <span v-else class="status-preview-missing">未配置图片</span>
            <span>{{ selectedNodeStatusOption?.label }}</span>
          </span>
        </div>
        <label>
          优先级
          <input v-model.number="nodeStatusRuleForm.priority" type="number" />
        </label>
        <button type="button" @click="addNodeStatusRuleFromDrawer">{{ nodeStatusRuleForm.editingRuleId ? "保存节点状态规则" : "添加节点状态规则" }}</button>
      </div>
    </el-drawer>

    <el-drawer :model-value="activeDrawer === 'containerRule'" :title="containerRuleForm.editingRuleId ? '编辑容器运行规则' : '新增容器运行规则'" size="480px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedNode && selectedNode.isGroup && topology" class="drawer-form">
        <RuleConditionEditor
          v-model="containerRuleForm.conditions"
          v-model:logic="containerRuleForm.logic"
          :nodes="topology.nodes"
          :data-sources="ruleDataSources"
          :node-options="ruleNodeCascaderOptions"
        />
        <label>
          优先级
          <input v-model.number="containerRuleForm.priority" type="number" />
        </label>
        <label class="checkbox-row">
          <input v-model="containerRuleForm.overrideBackgroundStyle" type="checkbox" />
          覆盖背景样式
        </label>
        <template v-if="containerRuleForm.overrideBackgroundStyle">
          <div class="size-grid">
            <label>
              背景
              <input v-model="containerRuleForm.backgroundColor" type="color" />
            </label>
            <label>
              背景透明度（%）
              <input v-model.number="containerRuleForm.backgroundOpacity" type="number" min="0" max="100" step="1" />
            </label>
          </div>
          <label class="checkbox-row">
            <input v-model="containerRuleForm.transparentBackground" type="checkbox" />
            透明背景
          </label>
        </template>
        <label class="checkbox-row">
          <input v-model="containerRuleForm.overrideBorderStyle" type="checkbox" />
          覆盖边框样式
        </label>
        <template v-if="containerRuleForm.overrideBorderStyle">
          <label>
            边框
            <input v-model="containerRuleForm.borderColor" type="color" />
          </label>
          <label class="checkbox-row">
            <input v-model="containerRuleForm.dashedBorder" type="checkbox" />
            虚线边框
          </label>
        </template>
        <div class="button-row">
          <button v-if="!isPreviewingContainerRuleForm()" type="button" @click="previewContainerRuleForm">预览当前规则</button>
          <button v-else type="button" @click="clearContainerPreview">停止预览</button>
        </div>
        <button type="button" @click="addContainerStyleRuleFromDrawer">{{ containerRuleForm.editingRuleId ? "保存容器运行规则" : "添加容器运行规则" }}</button>
      </div>
    </el-drawer>

    <el-drawer :model-value="activeDrawer === 'buttonVisibilityRule'" :title="buttonVisibilityRuleForm.editingRuleId ? '编辑按钮显示规则' : '新增按钮显示规则'" size="480px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedNode && topology" class="drawer-form">
        <RuleConditionEditor
          v-model="buttonVisibilityRuleForm.conditions"
          v-model:logic="buttonVisibilityRuleForm.logic"
          :nodes="topology.nodes"
          :data-sources="ruleDataSources"
          :node-options="ruleNodeCascaderOptions"
          allow-meta-data
        />
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
        <button type="button" @click="addButtonVisibilityRuleFromDrawer">{{ buttonVisibilityRuleForm.editingRuleId ? "保存按钮显示规则" : "添加按钮显示规则" }}</button>
      </div>
    </el-drawer>

    <el-drawer :model-value="activeDrawer === 'linkAdvancedStyle'" title="连线高级样式" size="430px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedLink && topology" class="drawer-form">
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

    <el-drawer :model-value="activeDrawer === 'linkRule'" :title="runningRuleForm.editingRuleId ? '编辑连线运行规则' : '新增连线运行规则'" size="480px" @update:model-value="handleDrawerModelValue">
      <div v-if="selectedLink && topology" class="drawer-form">
        <RuleConditionEditor
          v-model="runningRuleForm.conditions"
          v-model:logic="runningRuleForm.logic"
          :nodes="topology.nodes"
          :data-sources="ruleDataSources"
          :node-options="ruleNodeCascaderOptions"
        />
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
        <button type="button" @click="addRunningStateRuleFromDrawer">{{ runningRuleForm.editingRuleId ? "保存运行态规则" : "添加运行态规则" }}</button>
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
  background: linear-gradient(160deg, var(--el-color-primary-light-9, #e6f4f3), #ffffff 70%);
  border: 1px solid var(--el-color-primary-light-8, #cce9e6);
  border-radius: 8px;
}

.summary-kind {
  justify-self: start;
  padding: 1px 8px;
  color: var(--el-color-primary, #009688);
  background: #ffffff;
  border: 1px solid var(--el-color-primary-light-7, #b3ded9);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.summary-title {
  overflow: hidden;
  color: var(--el-text-color-primary, #303133);
  font-size: 16px;
  font-weight: 700;
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
  padding: 3px 8px;
  color: var(--el-text-color-regular, #606266);
  background: #ffffff;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 6px;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-badges span {
  color: var(--el-color-primary, #009688);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-color: var(--el-color-primary-light-7, #b3ded9);
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
  font-weight: 500;
}

.property-section {
  display: grid;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px dashed var(--el-border-color-lighter, #ebeef5);
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
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  font-weight: 600;
}

.tree-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 6px 8px;
  color: var(--el-text-color-regular, #606266);
  text-align: left;
  background: var(--el-fill-color-lighter, #fafafa);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 6px;
}

.tree-item.active {
  color: var(--el-color-primary, #009688);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-color: var(--el-color-primary-light-5, #7fc8c3);
}

.tree-kind {
  min-width: 28px;
  color: var(--el-text-color-secondary, #909399);
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
  color: var(--el-text-color-placeholder, #a8abb2);
  font-size: 11px;
}

.tree-empty {
  padding: 6px 8px;
  color: var(--el-text-color-placeholder, #a8abb2);
  font-size: 12px;
}

.hidden-file-input {
  display: none;
}

.section-title {
  color: var(--el-text-color-primary, #303133);
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
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
}

.readonly-grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 10px;
  padding: 10px;
  color: var(--el-text-color-secondary, #909399);
  background: var(--el-fill-color-lighter, #fafafa);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 6px;
  font-size: 12px;
}

.readonly-grid strong {
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-primary, #303133);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subsection-title {
  color: var(--el-text-color-regular, #606266);
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
  color: var(--el-color-primary, #009688);
  font-size: 12px;
  line-height: 1;
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-color: var(--el-color-primary-light-7, #b3ded9);
  border-radius: 999px;
}

.help-button:hover {
  background: var(--el-color-primary-light-8, #cce9e6);
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
  color: var(--el-text-color-regular, #606266);
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
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
}

.required-mark {
  color: var(--el-color-danger, #f56c6c);
  font-weight: 700;
}

.dynamic-field-unit {
  color: var(--el-text-color-placeholder, #a8abb2);
  font-size: 12px;
}

input,
textarea,
select {
  width: 100%;
  padding: 7px 10px;
  color: var(--el-text-color-primary, #303133);
  background: #ffffff;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

input::placeholder,
textarea::placeholder {
  color: var(--el-text-color-placeholder, #a8abb2);
}

input:hover,
textarea:hover,
select:hover {
  border-color: var(--el-border-color-hover, #c0c4cc);
}

input:focus,
textarea:focus,
select:focus {
  border-color: var(--el-color-primary, #009688);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8, #cce9e6);
  outline: none;
}

input[readonly] {
  color: var(--el-text-color-secondary, #909399);
  background: var(--el-fill-color-light, #f5f7fa);
}

textarea {
  min-height: 72px;
  resize: vertical;
  line-height: 1.5;
}

input[type="color"] {
  height: 34px;
  padding: 3px;
  cursor: pointer;
}

input[type="checkbox"] {
  accent-color: var(--el-color-primary, #009688);
  cursor: pointer;
}

button {
  padding: 7px 12px;
  color: var(--el-text-color-regular, #606266);
  background: #ffffff;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

button:hover {
  color: var(--el-color-primary, #009688);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-color: var(--el-color-primary-light-7, #b3ded9);
}

button:disabled {
  color: var(--el-text-color-placeholder, #a8abb2);
  background: var(--el-fill-color-light, #f5f7fa);
  border-color: var(--el-border-color-lighter, #ebeef5);
  cursor: not-allowed;
}

button.tree-item {
  color: var(--el-text-color-regular, #606266);
  background: var(--el-fill-color-lighter, #fafafa);
  border-color: var(--el-border-color-lighter, #ebeef5);
}

button.tree-item:hover {
  background: var(--el-color-primary-light-9, #e6f4f3);
}

button.tree-item.active {
  color: var(--el-color-primary, #009688);
  background: var(--el-color-primary-light-9, #e6f4f3);
  border-color: var(--el-color-primary-light-5, #7fc8c3);
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
  color: var(--el-text-color-primary, #303133);
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
  background: var(--el-fill-color-lighter, #fafafa);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
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
  border-top: 1px dashed var(--el-border-color-lighter, #ebeef5);
  color: var(--el-text-color-regular, #606266);
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
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 6px;
}

.status-preview-label {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
}

.status-preview-chip {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
  padding: 4px 8px;
  color: var(--el-text-color-primary, #303133);
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  font-size: 12px;
}

.status-preview-chip img {
  width: 22px;
  height: 22px;
  border-radius: 4px;
}

.status-preview-chip img {
  object-fit: contain;
}

.status-preview-missing {
  color: var(--el-text-color-placeholder, #a8abb2);
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
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 6px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.rule-item:hover {
  border-color: var(--el-color-primary-light-5, #7fc8c3);
  box-shadow: 0 2px 8px rgb(15 23 42 / 6%);
}

.rule-item.is-invalid {
  background: #fff7f7;
  border-color: #ef4444;
  box-shadow: inset 3px 0 #dc2626;
}

.rule-item .rule-health-badge {
  display: inline-block;
  width: fit-content;
  padding: 2px 6px;
  color: #991b1b;
  background: #fee2e2;
  border-radius: 5px;
}

.rule-item .rule-health-badge.is-warning {
  color: #92400e;
  background: #fef3c7;
}

.rule-item strong,
.rule-item span {
  display: block;
}

.rule-item strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 13px;
}

.rule-item span {
  margin-top: 2px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
}

.hint {
  padding: 9px 10px 9px 12px;
  color: var(--el-text-color-regular, #606266);
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-left: 3px solid var(--el-color-primary-light-5, #7fc8c3);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
}
</style>
