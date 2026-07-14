<script setup lang="ts">
import {
  defaultNodePorts,
  colorFormFieldDefaultValue,
  findDuplicatePortPosition,
  formFieldDefaultValueError,
  normalizePortDefinition,
  numberFormFieldDefaultValue,
  parseFormFieldDefaultValue,
  parseFormFieldOptions,
  VISUAL_PORT_ID_PREFIX,
  type FormFieldDefinition,
  type NodeStatusKey,
  type NodeTypeDefinition,
  type PortDefinition,
  type PortSide
} from "@topo-editor/topology-shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref, watch } from "vue";
import JsonTextEditor from "../components/JsonTextEditor.vue";
import NodeTypeTabHelpLabel from "../components/NodeTypeTabHelpLabel.vue";
import { displayAssetText, isImageAsset, isOssAssetRef, resolveAssetUrl, uploadImageAsset } from "../services/assetApi";
import { deleteNodeType, listNodeTypes, saveNodeType } from "../services/nodeTypeApi";

type CustomExtensionType = "string" | "number" | "boolean" | "array" | "object";

type EditablePort = {
  id: string;
  label: string;
  direction: PortDefinition["direction"];
  side: PortSide;
  positionPercent: number;
  maxLinks: string;
  linkTypes: string;
};

type EditableFormField = {
  field: string;
  label: string;
  type: FormFieldDefinition["type"];
  required: boolean;
  defaultValue: string;
  unit: string;
  options: string;
};

type CustomExtensionRow = {
  key: string;
  type: CustomExtensionType;
  value: string;
};

type NodeTypeForm = {
  id: string;
  name: string;
  category: NodeTypeDefinition["category"];
  description: string;
  template: string;
  icon: string;
  statusImages: Record<NodeStatusKey, string>;
  defaultWidth: number;
  defaultHeight: number;
  isGroup: boolean;
  allowNestedGroup: boolean;
  canContain: string[];
  groupBackgroundColor: string;
  groupBorderColor: string;
  groupBackgroundOpacity: number;
  groupTransparentBackground: boolean;
  groupDashedBorder: boolean;
  annotationTextColor: string;
  annotationTextSize: number;
  annotationFontWeight: string;
  annotationFontStyle: "normal" | "italic";
  annotationTextDecoration: string;
  annotationTextAlign: "left" | "center" | "right";
  annotationLineHeight: number;
  buttonText: string;
  buttonRenderMode: "text" | "image" | "imageText";
  buttonDefaultVisible: boolean;
  buttonStyleBackgroundColor: string;
  buttonStyleBorderColor: string;
  buttonStyleTextColor: string;
  buttonStyleTextSize: number;
  buttonStyleBorderWidth: number;
  buttonStyleBorderRadius: number;
  buttonStylePaddingX: number;
  buttonStylePaddingY: number;
  ports: EditablePort[];
  formSchema: EditableFormField[];
  customExtensions: CustomExtensionRow[];
};

const nodeTypeConfigKeys = new Set([
  "id",
  "name",
  "category",
  "description",
  "icon",
  "statusImages",
  "template",
  "defaultSize",
  "isGroup",
  "canContain",
  "allowNestedGroup",
  "ports",
  "formSchema",
  "groupStyleDefaults",
  "annotationDefaults",
  "buttonDefaults",
  "buttonStyleDefaults",
  "bindableFields",
  "connectionCapabilities",
  "actions",
  "backendId",
  "enabled",
  "sortNo"
]);

const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);
const uploadingStatus = ref<NodeStatusKey | "icon" | "">("");
const dialogVisible = ref(false);
const activeConfigTab = ref("base");
const fileInputRef = ref<HTMLInputElement | null>(null);
const nodeTypes = ref<NodeTypeDefinition[]>([]);
const editingBackendId = ref<number | undefined>();
const editingOriginalTypeCode = ref("");
const activeCategory = ref<NodeTypeDefinition["category"]>("equipment");
const assetUrlMap = ref<Record<string, string>>({});

const categoryOptions: Array<{ label: string; value: NodeTypeDefinition["category"] }> = [
  { label: "设备", value: "equipment" },
  { label: "容器", value: "container" },
  { label: "标注", value: "annotation" },
  { label: "控件", value: "control" }
];

const categoryLabelMap = Object.fromEntries(categoryOptions.map((option) => [option.value, option.label]));

const statusOptions: Array<{ label: string; value: NodeStatusKey }> = [
  { label: "默认", value: "default" },
  { label: "运行", value: "running" },
  { label: "故障", value: "fault" },
  { label: "离线", value: "offline" }
];

const portDirectionOptions: Array<{ label: string; value: PortDefinition["direction"] }> = [
  { label: "输入", value: "in" },
  { label: "输出", value: "out" },
  { label: "双向", value: "both" }
];

const portSideOptions: Array<{ label: string; value: PortSide }> = [
  { label: "上", value: "top" },
  { label: "右", value: "right" },
  { label: "下", value: "bottom" },
  { label: "左", value: "left" }
];

const formFieldTypeOptions: Array<{ label: string; value: FormFieldDefinition["type"] }> = [
  { label: "文本", value: "text" },
  { label: "数字", value: "number" },
  { label: "下拉", value: "select" },
  { label: "日期", value: "date" },
  { label: "布尔", value: "boolean" },
  { label: "多行文本", value: "textarea" },
  { label: "颜色", value: "color" }
];

const buttonRenderModeOptions: Array<{ label: string; value: NodeTypeForm["buttonRenderMode"] }> = [
  { label: "文字", value: "text" },
  { label: "图片", value: "image" },
  { label: "图片 + 文字", value: "imageText" }
];

const customExtensionTypeOptions: Array<{ label: string; value: CustomExtensionType }> = [
  { label: "文本", value: "string" },
  { label: "数字", value: "number" },
  { label: "布尔", value: "boolean" },
  { label: "数组", value: "array" },
  { label: "对象", value: "object" }
];

const containOptions = computed(() => [
  ...categoryOptions.map((option) => ({ label: `分类：${option.label}`, value: option.value })),
  ...nodeTypes.value.map((nodeType) => ({ label: `类型：${nodeType.name}`, value: nodeType.id }))
]);

const tabHelp = {
  base: "维护节点类型的编码、名称、尺寸和图标。",
  container: "配置节点是否可作为分组容器，以及可容纳哪些节点。",
  ports: "配置节点在画布上的连接端口；空端口表示不可连线。",
  form: "配置实例节点在属性面板中可编辑的业务字段。",
  custom: "保存暂未表单化的扩展字段，避免历史配置丢失。"
};

const fieldHelp = {
  typeCode: "节点类型唯一编码，保存后用于拓扑节点的 typeId。",
  name: "节点库中展示的名称，拖入画布后会作为默认标签前缀。",
  category: "影响节点在节点库中的分组和默认尺寸。",
  template: "对应画布里的节点渲染模板编码。",
  description: "用于记录节点类型用途，不影响画布渲染。",
  defaultSize: "新拖入画布时使用的默认宽高。",
  icon: "可填写图片地址或文本图标；图片会优先按图片渲染。",
  statusImages: "运行态不同状态下使用的替换图片。",
  isGroup: "开启后节点会作为容器分组，可承载其他节点。",
  allowNestedGroup: "开启后该容器允许放入其他容器节点。",
  canContain: "限制容器可包含的分类或节点类型；为空表示不额外限制。",
  portId: "端口唯一编码，连线会保存这个编码。",
  portLabel: "端口悬浮提示中展示的名称。",
  portDirection: "限制端口可作为连线起点、终点或双向连接。",
  portSide: "端口所在的节点边。",
  portPosition: "端口在边上的百分比位置；上、下边从左到右，左、右边从上到下。",
  maxLinks: "限制该端口最多连接的线数；为空表示不限制。",
  linkTypes: "限制允许连接的连线类型；为空表示不限制。",
  fieldCode: "属性字段编码，会保存到节点 props 中。",
  fieldLabel: "属性面板中展示的字段名称。",
  fieldType: "决定属性面板使用的输入控件类型。",
  required: "标记该字段是否为必填配置。",
  defaultValue: "新节点创建时写入 props 的初始值。",
  unit: "字段单位，仅用于展示。",
  options: "下拉或枚举选项；支持一行一个，表单选项可写成 标签:值。",
  customKey: "扩展字段名，会直接保存到节点类型配置中。",
  customType: "扩展值的保存类型。",
  customValue: "扩展字段值；对象类型需填写合法 JSON。",
  groupStyle: "新拖入容器节点时使用的默认组样式，实例仍可在属性面板里覆盖。",
  annotationStyle: "新拖入标注节点时使用的默认文字颜色和大小。",
  buttonConfig: "新拖入控件节点时使用的按钮文字、渲染方式、默认显示和样式。"
};

const tabFieldHelp = {
  base: [
    { label: "类型编码", text: fieldHelp.typeCode },
    { label: "名称", text: fieldHelp.name },
    { label: "分类", text: fieldHelp.category },
    { label: "说明", text: fieldHelp.description },
    { label: "默认尺寸", text: fieldHelp.defaultSize },
    { label: "图标", text: fieldHelp.icon },
    { label: "状态图片", text: fieldHelp.statusImages }
  ],
  container: [
    { label: "容器节点", text: fieldHelp.isGroup },
    { label: "允许嵌套容器", text: fieldHelp.allowNestedGroup },
    { label: "可包含类型", text: fieldHelp.canContain },
    { label: "组样式", text: fieldHelp.groupStyle }
  ],
  ports: [
    { label: "编码", text: fieldHelp.portId },
    { label: "名称", text: fieldHelp.portLabel },
    { label: "方向", text: fieldHelp.portDirection },
    { label: "所在边", text: fieldHelp.portSide },
    { label: "位置", text: fieldHelp.portPosition },
    { label: "最大连接", text: fieldHelp.maxLinks },
    { label: "连线类型", text: fieldHelp.linkTypes }
  ],
  form: [
    { label: "字段", text: fieldHelp.fieldCode },
    { label: "名称", text: fieldHelp.fieldLabel },
    { label: "类型", text: fieldHelp.fieldType },
    { label: "必填", text: fieldHelp.required },
    { label: "默认值", text: fieldHelp.defaultValue },
    { label: "单位", text: fieldHelp.unit },
    { label: "选项", text: fieldHelp.options }
  ],
  custom: [
    { label: "字段名", text: fieldHelp.customKey },
    { label: "类型", text: fieldHelp.customType },
    { label: "值", text: fieldHelp.customValue }
  ]
};

const DEFAULT_GROUP_STYLE = {
  backgroundColor: "#eef6ff",
  borderColor: "#3b82f6",
  backgroundOpacity: 100,
  transparentBackground: false,
  dashedBorder: false
};

const DEFAULT_ANNOTATION_STYLE = {
  textColor: "#111827",
  textSize: 14,
  fontWeight: "400",
  fontStyle: "normal" as const,
  textDecoration: "none",
  textAlign: "left" as const,
  lineHeight: 20
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

const DEFAULT_BUTTON_DEFAULTS = {
  buttonText: "按钮",
  buttonRenderMode: "text" as const,
  buttonDefaultVisible: true
};

const DEFAULT_BUTTON_STYLE = {
  backgroundColor: "#eff6ff",
  borderColor: "#2563eb",
  textColor: "#1d4ed8",
  textSize: 13,
  borderWidth: 1.5,
  borderRadius: 6,
  paddingX: 10,
  paddingY: 5
};

function createEmptyStatusImages(): Record<NodeStatusKey, string> {
  return {
    default: "",
    running: "",
    fault: "",
    offline: ""
  };
}

function createNodeTypeForm(): NodeTypeForm {
  const defaultSize = getFallbackSize("equipment");
  return {
    id: "",
    name: "",
    category: "equipment",
    description: "",
    template: "basicEquipmentTemplate",
    icon: "",
    statusImages: createEmptyStatusImages(),
    defaultWidth: defaultSize.width,
    defaultHeight: defaultSize.height,
    isGroup: false,
    allowNestedGroup: false,
    canContain: [],
    groupBackgroundColor: DEFAULT_GROUP_STYLE.backgroundColor,
    groupBorderColor: DEFAULT_GROUP_STYLE.borderColor,
    groupBackgroundOpacity: DEFAULT_GROUP_STYLE.backgroundOpacity,
    groupTransparentBackground: DEFAULT_GROUP_STYLE.transparentBackground,
    groupDashedBorder: DEFAULT_GROUP_STYLE.dashedBorder,
    annotationTextColor: DEFAULT_ANNOTATION_STYLE.textColor,
    annotationTextSize: DEFAULT_ANNOTATION_STYLE.textSize,
    annotationFontWeight: DEFAULT_ANNOTATION_STYLE.fontWeight,
    annotationFontStyle: DEFAULT_ANNOTATION_STYLE.fontStyle,
    annotationTextDecoration: DEFAULT_ANNOTATION_STYLE.textDecoration,
    annotationTextAlign: DEFAULT_ANNOTATION_STYLE.textAlign,
    annotationLineHeight: DEFAULT_ANNOTATION_STYLE.lineHeight,
    buttonText: DEFAULT_BUTTON_DEFAULTS.buttonText,
    buttonRenderMode: DEFAULT_BUTTON_DEFAULTS.buttonRenderMode,
    buttonDefaultVisible: DEFAULT_BUTTON_DEFAULTS.buttonDefaultVisible,
    buttonStyleBackgroundColor: DEFAULT_BUTTON_STYLE.backgroundColor,
    buttonStyleBorderColor: DEFAULT_BUTTON_STYLE.borderColor,
    buttonStyleTextColor: DEFAULT_BUTTON_STYLE.textColor,
    buttonStyleTextSize: DEFAULT_BUTTON_STYLE.textSize,
    buttonStyleBorderWidth: DEFAULT_BUTTON_STYLE.borderWidth,
    buttonStyleBorderRadius: DEFAULT_BUTTON_STYLE.borderRadius,
    buttonStylePaddingX: DEFAULT_BUTTON_STYLE.paddingX,
    buttonStylePaddingY: DEFAULT_BUTTON_STYLE.paddingY,
    ports: defaultNodePorts.map(toEditablePort),
    formSchema: [],
    customExtensions: []
  };
}

const form = reactive<NodeTypeForm>(createNodeTypeForm());

const dialogTitle = computed(() => (editingOriginalTypeCode.value ? "编辑节点类型" : "新增节点类型"));
const filteredNodeTypes = computed(() => nodeTypes.value.filter((item) => item.category === activeCategory.value));
const categoryCounts = computed(() => Object.fromEntries(
  categoryOptions.map((option) => [option.value, nodeTypes.value.filter((item) => item.category === option.value).length])
) as Record<NodeTypeDefinition["category"], number>);
const typeCodeError = computed(() => {
  const typeCode = form.id.trim();
  if (!typeCode) return "";
  const duplicated = nodeTypes.value.some((item) => item.id === typeCode && item.id !== editingOriginalTypeCode.value);
  return duplicated ? `类型编码「${typeCode}」已存在` : "";
});
const iconFieldLabel = computed(() => {
  if (form.category === "container" || form.category === "annotation") return "背景图";
  if (form.category === "control") return "按钮图片";
  return "图标";
});
const iconFieldPlaceholder = computed(() => {
  if (form.category === "container" || form.category === "annotation") return "背景图地址或上传图片";
  if (form.category === "control") return "按钮图片地址或上传图片";
  return "图片地址或文本图标";
});
const showStatusImages = computed(() => form.category === "equipment");

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function backendIdOf(nodeType: NodeTypeDefinition) {
  return typeof nodeType.backendId === "number" ? nodeType.backendId : undefined;
}

function isImageIcon(icon?: string) {
  return isImageAsset(icon);
}

function assetPreviewUrl(value?: string) {
  return value ? assetUrlMap.value[value] || (!isOssAssetRef(value) ? value : "") : "";
}

function assetLabel(value?: string) {
  return displayAssetText(value);
}

async function ensureAssetUrl(value?: string) {
  if (!value || !isImageAsset(value) || assetUrlMap.value[value]) return;
  try {
    const url = await resolveAssetUrl(value);
    if (url) assetUrlMap.value = { ...assetUrlMap.value, [value]: url };
  } catch {
    // Keep the persistent oss reference in the form; preview can recover on the next refresh.
  }
}

function ensureNodeTypeAssets(items: NodeTypeDefinition[]) {
  for (const nodeType of items) {
    void ensureAssetUrl(nodeType.icon);
    Object.values(nodeType.statusImages ?? {}).forEach((value) => void ensureAssetUrl(value));
    const buttonIcon = nodeType.buttonDefaults?.icon;
    if (typeof buttonIcon === "string") void ensureAssetUrl(buttonIcon);
  }
}

function getFallbackSize(category: NodeTypeDefinition["category"], isGroup?: boolean) {
  if (isGroup || category === "container") return { width: 320, height: 220 };
  if (category === "annotation") return { width: 140, height: 64 };
  if (category === "control") return { width: 112, height: 42 };
  return { width: 104, height: 92 };
}

function numberOrDefault(value: unknown, fallback: number) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function compactString(value: string) {
  const next = value.trim();
  return next || undefined;
}

function listFromText(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)));
}

function textFromList(value?: unknown[]) {
  return (value ?? []).map(String).join("\n");
}

function defaultValueToText(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function formOptionsToText(options?: FormFieldDefinition["options"]) {
  return (options ?? []).map((option) => (
    option.label === String(option.value) ? String(option.value) : `${option.label}:${String(option.value)}`
  )).join("\n");
}

function customExtensionTypeOf(value: unknown): CustomExtensionType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return "string";
}

function customExtensionValueToText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join("\n");
  if (isRecord(value)) return JSON.stringify(value, null, 2);
  if (value === undefined || value === null) return "";
  return String(value);
}

function customExtensionObjectValue(row: CustomExtensionRow) {
  try {
    const parsed = row.value.trim() ? JSON.parse(row.value) : {};
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function updateCustomExtensionObject(row: CustomExtensionRow, value: Record<string, unknown>) {
  row.value = JSON.stringify(value, null, 2);
}

function parseCustomExtension(row: CustomExtensionRow): unknown {
  const value = row.value.trim();
  if (row.type === "number") {
    if (!Number.isFinite(Number(value))) throw new Error(`自定义扩展「${row.key}」不是有效数字`);
    return Number(value);
  }
  if (row.type === "boolean") return /^(true|1|yes|是)$/i.test(value);
  if (row.type === "array") return listFromText(row.value);
  if (row.type === "object") {
    try {
      return value ? JSON.parse(value) : {};
    } catch {
      throw new Error(`自定义扩展「${row.key}」不是合法对象 JSON`);
    }
  }
  return row.value;
}

function toEditablePort(port?: PortDefinition): EditablePort {
  const normalized = normalizePortDefinition(port ?? { id: "", label: "", direction: "both" });
  return {
    id: normalized.id,
    label: normalized.label,
    direction: normalized.direction,
    side: normalized.side,
    positionPercent: normalized.positionPercent,
    maxLinks: normalized.maxLinks === undefined ? "" : String(normalized.maxLinks),
    linkTypes: textFromList(normalized.linkTypes)
  };
}

function toEditableFormField(field?: FormFieldDefinition): EditableFormField {
  const type = field?.type ?? "text";
  const defaultValue = defaultValueToText(field?.defaultValue);
  const normalizedDefaultValue = type === "boolean"
    ? parseFormFieldDefaultValue(defaultValue, type)
    : defaultValue;
  return {
    field: field?.field ?? "",
    label: field?.label ?? "",
    type,
    required: field?.required ?? false,
    defaultValue: typeof normalizedDefaultValue === "boolean" ? String(normalizedDefaultValue) : defaultValue,
    unit: field?.unit ?? "",
    options: formOptionsToText(field?.options)
  };
}

function editableFormFieldOptions(field: EditableFormField) {
  return parseFormFieldOptions(field.options);
}

function formFieldDefaultError(field: EditableFormField) {
  return formFieldDefaultValueError(field, editableFormFieldOptions(field));
}

function isSelectDefaultValueMatched(field: EditableFormField) {
  const value = field.defaultValue.trim();
  return !!value && !!editableFormFieldOptions(field)?.some((option) => String(option.value) === value);
}

function updateDefaultValue(field: EditableFormField, value: unknown) {
  field.defaultValue = value === undefined || value === null ? "" : String(value);
}

function toCustomExtensionRows(nodeType?: NodeTypeDefinition): CustomExtensionRow[] {
  if (!nodeType) return [];
  return Object.entries(nodeType)
    .filter(([key, value]) => !nodeTypeConfigKeys.has(key) && value !== undefined)
    .map(([key, value]) => ({
      key,
      type: customExtensionTypeOf(value),
      value: customExtensionValueToText(value)
    }));
}

function assignForm(next: NodeTypeForm) {
  Object.assign(form, next);
}

function openCreate() {
  editingBackendId.value = undefined;
  editingOriginalTypeCode.value = "";
  assignForm(createNodeTypeForm());
  activeConfigTab.value = "base";
  dialogVisible.value = true;
}

function openEdit(nodeType: NodeTypeDefinition) {
  editingBackendId.value = backendIdOf(nodeType);
  editingOriginalTypeCode.value = nodeType.id;
  const defaultSize = nodeType.defaultSize ?? getFallbackSize(nodeType.category, nodeType.isGroup);
  const groupStyleDefaults = {
    ...DEFAULT_GROUP_STYLE,
    ...(nodeType.groupStyleDefaults ?? {})
  };
  const annotationDefaults = {
    ...DEFAULT_ANNOTATION_STYLE,
    ...(nodeType.annotationDefaults ?? {})
  };
  const buttonDefaults = {
    ...DEFAULT_BUTTON_DEFAULTS,
    ...(nodeType.buttonDefaults ?? {})
  };
  const buttonStyleDefaults = {
    ...DEFAULT_BUTTON_STYLE,
    ...(nodeType.buttonStyleDefaults ?? {})
  };
  assignForm({
    id: nodeType.id,
    name: nodeType.name,
    category: nodeType.category,
    description: nodeType.description ?? "",
    template: nodeType.template,
    icon: nodeType.icon ?? "",
    statusImages: {
      ...createEmptyStatusImages(),
      ...(nodeType.statusImages ?? {})
    },
    defaultWidth: defaultSize.width,
    defaultHeight: defaultSize.height,
    isGroup: !!nodeType.isGroup,
    allowNestedGroup: !!nodeType.allowNestedGroup,
    canContain: [...(nodeType.canContain ?? [])],
    groupBackgroundColor: groupStyleDefaults.backgroundColor,
    groupBorderColor: groupStyleDefaults.borderColor,
    groupBackgroundOpacity: numberOrDefault(groupStyleDefaults.backgroundOpacity, DEFAULT_GROUP_STYLE.backgroundOpacity),
    groupTransparentBackground: !!groupStyleDefaults.transparentBackground,
    groupDashedBorder: !!groupStyleDefaults.dashedBorder,
    annotationTextColor: annotationDefaults.textColor,
    annotationTextSize: numberOrDefault(annotationDefaults.textSize, DEFAULT_ANNOTATION_STYLE.textSize),
    annotationFontWeight: annotationDefaults.fontWeight === undefined || annotationDefaults.fontWeight === null ? DEFAULT_ANNOTATION_STYLE.fontWeight : String(annotationDefaults.fontWeight),
    annotationFontStyle: annotationDefaults.fontStyle === "italic" ? "italic" : "normal",
    annotationTextDecoration: typeof annotationDefaults.textDecoration === "string" && annotationDefaults.textDecoration.trim() ? annotationDefaults.textDecoration : DEFAULT_ANNOTATION_STYLE.textDecoration,
    annotationTextAlign: annotationDefaults.textAlign === "center" || annotationDefaults.textAlign === "right" ? annotationDefaults.textAlign : "left",
    annotationLineHeight: numberOrDefault(annotationDefaults.lineHeight, DEFAULT_ANNOTATION_STYLE.lineHeight),
    buttonText: buttonDefaults.buttonText,
    buttonRenderMode: buttonDefaults.buttonRenderMode === "image" || buttonDefaults.buttonRenderMode === "imageText" ? buttonDefaults.buttonRenderMode : "text",
    buttonDefaultVisible: buttonDefaults.buttonDefaultVisible !== false,
    buttonStyleBackgroundColor: buttonStyleDefaults.backgroundColor,
    buttonStyleBorderColor: buttonStyleDefaults.borderColor,
    buttonStyleTextColor: buttonStyleDefaults.textColor,
    buttonStyleTextSize: numberOrDefault(buttonStyleDefaults.textSize, DEFAULT_BUTTON_STYLE.textSize),
    buttonStyleBorderWidth: numberOrDefault(buttonStyleDefaults.borderWidth, DEFAULT_BUTTON_STYLE.borderWidth),
    buttonStyleBorderRadius: numberOrDefault(buttonStyleDefaults.borderRadius, DEFAULT_BUTTON_STYLE.borderRadius),
    buttonStylePaddingX: numberOrDefault(buttonStyleDefaults.paddingX, DEFAULT_BUTTON_STYLE.paddingX),
    buttonStylePaddingY: numberOrDefault(buttonStyleDefaults.paddingY, DEFAULT_BUTTON_STYLE.paddingY),
    ports: (nodeType.ports ?? []).map(toEditablePort),
    formSchema: (nodeType.formSchema ?? []).map(toEditableFormField),
    customExtensions: toCustomExtensionRows(nodeType)
  });
  activeConfigTab.value = "base";
  dialogVisible.value = true;
}

function applyCategoryDefaultSize() {
  const defaultSize = getFallbackSize(form.category, form.isGroup);
  form.defaultWidth = defaultSize.width;
  form.defaultHeight = defaultSize.height;
}

function buildGroupStyleDefaults(): NonNullable<NodeTypeDefinition["groupStyleDefaults"]> | undefined {
  if (form.category !== "container" && !form.isGroup) return undefined;
  return {
    backgroundColor: form.groupBackgroundColor || DEFAULT_GROUP_STYLE.backgroundColor,
    borderColor: form.groupBorderColor || DEFAULT_GROUP_STYLE.borderColor,
    backgroundOpacity: clampNumber(Math.round(numberOrDefault(form.groupBackgroundOpacity, DEFAULT_GROUP_STYLE.backgroundOpacity)), 0, 100),
    transparentBackground: form.groupTransparentBackground,
    dashedBorder: form.groupDashedBorder
  };
}

function buildAnnotationDefaults(): NonNullable<NodeTypeDefinition["annotationDefaults"]> | undefined {
  if (form.category !== "annotation") return undefined;
  return {
    textColor: form.annotationTextColor || DEFAULT_ANNOTATION_STYLE.textColor,
    textSize: Math.max(1, Math.round(numberOrDefault(form.annotationTextSize, DEFAULT_ANNOTATION_STYLE.textSize))),
    fontWeight: form.annotationFontWeight || DEFAULT_ANNOTATION_STYLE.fontWeight,
    fontStyle: form.annotationFontStyle === "italic" ? "italic" : "normal",
    textDecoration: form.annotationTextDecoration || DEFAULT_ANNOTATION_STYLE.textDecoration,
    textAlign: form.annotationTextAlign === "center" || form.annotationTextAlign === "right" ? form.annotationTextAlign : "left",
    lineHeight: Math.max(1, Math.round(numberOrDefault(form.annotationLineHeight, DEFAULT_ANNOTATION_STYLE.lineHeight)))
  };
}

function buildButtonDefaults(): NonNullable<NodeTypeDefinition["buttonDefaults"]> | undefined {
  if (form.category !== "control") return undefined;
  return {
    buttonText: form.buttonText.trim() || DEFAULT_BUTTON_DEFAULTS.buttonText,
    buttonRenderMode: form.buttonRenderMode,
    icon: compactString(form.icon),
    buttonDefaultVisible: form.buttonDefaultVisible
  };
}

function buildButtonStyleDefaults(): NonNullable<NodeTypeDefinition["buttonStyleDefaults"]> | undefined {
  if (form.category !== "control") return undefined;
  if (form.buttonRenderMode === "image") {
    return undefined;
  }
  return {
    backgroundColor: form.buttonStyleBackgroundColor || DEFAULT_BUTTON_STYLE.backgroundColor,
    borderColor: form.buttonStyleBorderColor || DEFAULT_BUTTON_STYLE.borderColor,
    textColor: form.buttonStyleTextColor || DEFAULT_BUTTON_STYLE.textColor,
    textSize: Math.max(1, Math.round(numberOrDefault(form.buttonStyleTextSize, DEFAULT_BUTTON_STYLE.textSize))),
    borderWidth: Math.max(0, numberOrDefault(form.buttonStyleBorderWidth, DEFAULT_BUTTON_STYLE.borderWidth)),
    borderRadius: Math.max(0, Math.round(numberOrDefault(form.buttonStyleBorderRadius, DEFAULT_BUTTON_STYLE.borderRadius))),
    paddingX: Math.max(0, Math.round(numberOrDefault(form.buttonStylePaddingX, DEFAULT_BUTTON_STYLE.paddingX))),
    paddingY: Math.max(0, Math.round(numberOrDefault(form.buttonStylePaddingY, DEFAULT_BUTTON_STYLE.paddingY)))
  };
}

function addDefaultPorts() {
  form.ports = defaultNodePorts.map(toEditablePort);
}

function addPort() {
  form.ports.push(toEditablePort());
}

function removePort(index: number) {
  form.ports.splice(index, 1);
}

function addFormField() {
  form.formSchema.push(toEditableFormField());
}

function removeFormField(index: number) {
  form.formSchema.splice(index, 1);
}

function addCustomExtension() {
  form.customExtensions.push({ key: "", type: "string", value: "" });
}

function removeCustomExtension(index: number) {
  form.customExtensions.splice(index, 1);
}

function validateUnique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label}「${value}」重复`);
    seen.add(value);
  }
}

function buildPorts(): PortDefinition[] {
  const ports = form.ports.map((port) => {
    const id = port.id.trim();
    const label = port.label.trim();
    if (!id || !label) throw new Error("端口配置需填写端口编码和名称");
    if (id.startsWith(VISUAL_PORT_ID_PREFIX)) throw new Error(`端口编码「${id}」使用了系统保留前缀`);
    if (port.maxLinks.trim() && (!Number.isFinite(Number(port.maxLinks)) || Number(port.maxLinks) <= 0)) {
      throw new Error(`端口「${id}」最大连接数需为正数`);
    }
    return {
      id,
      label,
      direction: port.direction,
      side: port.side,
      positionPercent: Math.round(port.positionPercent),
      maxLinks: port.maxLinks.trim() ? Math.round(Number(port.maxLinks)) : undefined,
      linkTypes: listFromText(port.linkTypes)
    };
  });
  if (ports.some((port) => !Number.isFinite(port.positionPercent) || port.positionPercent! < 0 || port.positionPercent! > 100)) {
    throw new Error("端口位置需为 0 到 100 的整数百分比");
  }
  validateUnique(ports.map((port) => port.id), "端口编码");
  const duplicatePosition = findDuplicatePortPosition(ports);
  if (duplicatePosition) {
    const sideLabel = portSideOptions.find((option) => option.value === duplicatePosition.side)?.label ?? duplicatePosition.side;
    throw new Error(`端口位置「${sideLabel}边 ${duplicatePosition.positionPercent}%」重复`);
  }
  return ports;
}

function buildFormSchema(): FormFieldDefinition[] {
  const fields = form.formSchema.map((field) => {
    const fieldName = field.field.trim();
    const label = field.label.trim();
    if (!fieldName || !label || !field.type) throw new Error("动态表单需填写字段、名称和类型");
    const options = editableFormFieldOptions(field);
    const defaultValueError = formFieldDefaultValueError(field, options);
    if (defaultValueError) throw new Error(`动态表单字段「${fieldName}」${defaultValueError}`);
    const defaultValue = parseFormFieldDefaultValue(field.defaultValue, field.type);
    return {
      field: fieldName,
      label,
      type: field.type,
      required: field.required || undefined,
      defaultValue,
      unit: compactString(field.unit),
      options
    };
  });
  validateUnique(fields.map((field) => field.field), "动态表单字段");
  return fields;
}

function buildCustomExtensions(): Record<string, unknown> {
  const rows = form.customExtensions.filter((row) => row.key.trim() || row.value.trim());
  const keys = rows.map((row) => row.key.trim());
  if (keys.some((key) => !key)) throw new Error("自定义扩展需填写字段名");
  validateUnique(keys, "自定义扩展字段");
  for (const key of keys) {
    if (nodeTypeConfigKeys.has(key)) throw new Error(`自定义扩展「${key}」与内置字段冲突`);
  }
  return Object.fromEntries(rows.map((row) => [row.key.trim(), parseCustomExtension(row)]));
}

async function load() {
  loading.value = true;
  try {
    nodeTypes.value = await listNodeTypes();
    ensureNodeTypeAssets(nodeTypes.value);
  } finally {
    loading.value = false;
  }
}

async function submit() {
  const typeCode = form.id.trim();
  const typeName = form.name.trim();
  if (!typeCode || !typeName) {
    ElMessage.error("请填写类型编码和名称");
    return;
  }

  if (typeCodeError.value) {
    ElMessage.error(typeCodeError.value);
    return;
  }

  if (!Number.isFinite(form.defaultWidth) || !Number.isFinite(form.defaultHeight) || form.defaultWidth <= 0 || form.defaultHeight <= 0) {
    ElMessage.error("请填写有效的默认尺寸");
    return;
  }

  let payload: NodeTypeDefinition;
  try {
    const editingNodeType = editingOriginalTypeCode.value
      ? nodeTypes.value.find((item) => item.id === editingOriginalTypeCode.value)
      : undefined;
    payload = {
      ...buildCustomExtensions(),
      id: typeCode,
      name: typeName,
      category: form.category,
      description: compactString(form.description),
      template: form.template.trim(),
      icon: form.icon.trim() || undefined,
      statusImages: form.category === "equipment"
        ? Object.fromEntries(Object.entries(form.statusImages).filter(([, value]) => value.trim())) as NodeTypeDefinition["statusImages"]
        : undefined,
      defaultSize: {
        width: Math.round(form.defaultWidth),
        height: Math.round(form.defaultHeight)
      },
      isGroup: form.isGroup || undefined,
      allowNestedGroup: form.isGroup && form.allowNestedGroup ? true : undefined,
      canContain: form.isGroup && form.canContain.length ? form.canContain : undefined,
      ports: buildPorts(),
      formSchema: buildFormSchema(),
      groupStyleDefaults: buildGroupStyleDefaults(),
      annotationDefaults: buildAnnotationDefaults(),
      buttonDefaults: buildButtonDefaults(),
      buttonStyleDefaults: buildButtonStyleDefaults(),
      backendId: editingBackendId.value ?? (editingNodeType ? backendIdOf(editingNodeType) : undefined),
      enabled: editingNodeType?.enabled ?? true,
      sortNo: editingNodeType?.sortNo
    };
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "配置校验失败");
    return;
  }

  saving.value = true;
  try {
    await saveNodeType(payload);
    ElMessage.success("节点类型已保存");
    dialogVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

function chooseImage() {
  uploadingStatus.value = "icon";
  fileInputRef.value?.click();
}

function chooseStatusImage(status: NodeStatusKey) {
  uploadingStatus.value = status;
  fileInputRef.value?.click();
}

async function handleImageChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  const isSvg = file.name.toLowerCase().endsWith(".svg");
  if (!file.type.startsWith("image/") && !isSvg) {
    ElMessage.error("请选择图片文件");
    return;
  }

  uploading.value = true;
  try {
    const assetTarget = uploadingStatus.value && uploadingStatus.value !== "icon"
      ? `status:${uploadingStatus.value}`
      : "icon";
    const result = await uploadImageAsset(file, {
      businessType: form.category || "common",
      source: "topology-node-type",
      refType: "topology_node_type",
      refId: form.id.trim(),
      remark: assetTarget
    });
    if (uploadingStatus.value && uploadingStatus.value !== "icon") {
      form.statusImages[uploadingStatus.value] = result.ref;
    } else {
      form.icon = result.ref;
    }
    await ensureAssetUrl(result.ref);
    ElMessage.success("图片已上传");
  } finally {
    uploading.value = false;
    uploadingStatus.value = "";
  }
}

async function remove(nodeType: NodeTypeDefinition) {
  await ElMessageBox.confirm(`确认停用节点类型「${nodeType.name}」？`, "停用节点类型", {
    confirmButtonText: "停用",
    cancelButtonText: "取消",
    type: "warning"
  });
  await deleteNodeType(nodeType.id);
  ElMessage.success("节点类型已停用");
  await load();
}

onMounted(load);

watch(() => [
  form.icon,
  ...Object.values(form.statusImages)
], (values) => {
  values.forEach((value) => void ensureAssetUrl(value));
}, { immediate: true });

// 容器能力仅对容器分类开放；切换到非容器分类时避免停留在已隐藏的 tab
watch(() => form.category, (category) => {
  if (category !== "container") {
    form.isGroup = false;
    if (activeConfigTab.value === "container") activeConfigTab.value = "base";
  }
});
</script>

<template>
  <main class="module-page">
    <header class="topbar">
      <span class="topbar-title">节点库管理</span>
      <span class="topbar-spacer" />
      <el-button type="primary" @click="openCreate">新增节点类型</el-button>
      <el-button @click="load">刷新</el-button>
    </header>

    <section class="module-body">
      <div class="module-card">
        <div class="module-card-header">
          <div>
            <div class="module-card-title">节点库</div>
            <div class="module-card-subtitle">管理节点类型、端口、动态表单和可绑定字段</div>
          </div>
        </div>

        <el-tabs v-model="activeCategory" class="node-type-tabs">
          <el-tab-pane
            v-for="category in categoryOptions"
            :key="category.value"
            :name="category.value"
            :label="`${category.label}（${categoryCounts[category.value] ?? 0}）`"
          />
        </el-tabs>

        <el-table v-loading="loading" :data="filteredNodeTypes" height="calc(100vh - 186px)">
          <el-table-column label="图片" width="76">
            <template #default="{ row }">
              <div class="node-type-icon">
                <img v-if="isImageIcon(row.icon) && assetPreviewUrl(row.icon)" :src="assetPreviewUrl(row.icon)" :alt="row.name" />
                <span v-else>{{ assetLabel(row.icon) || row.id.slice(0, 1).toUpperCase() }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="160" />
          <el-table-column prop="id" label="类型编码" min-width="150" />
          <el-table-column label="分类" width="120">
            <template #default="{ row }">
              {{ categoryLabelMap[row.category] ?? row.category ?? "-" }}
            </template>
          </el-table-column>
          <el-table-column label="默认尺寸" width="120">
            <template #default="{ row }">
              {{ row.defaultSize ? `${row.defaultSize.width} x ${row.defaultSize.height}` : "-" }}
            </template>
          </el-table-column>
          <el-table-column label="端口" width="80">
            <template #default="{ row }">{{ row.ports?.length ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="表单字段" width="100">
            <template #default="{ row }">{{ row.formSchema?.length ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="remove(row)">停用</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="1080px" class="node-type-dialog">
      <el-tabs v-model="activeConfigTab" class="config-tabs">
        <el-tab-pane name="base">
          <template #label>
            <NodeTypeTabHelpLabel label="基础信息" :summary="tabHelp.base" :items="tabFieldHelp.base" />
          </template>
          <div class="config-pane">
          <div class="config-pane-main">
          <el-form label-width="96px">
            <el-form-item :validate-status="typeCodeError ? 'error' : undefined">
              <template #label>
                <span class="required-label"><span class="required-mark">*</span>类型编码</span>
              </template>
              <el-input v-model="form.id" :disabled="!!editingOriginalTypeCode" placeholder="例如 breaker" />
              <div v-if="typeCodeError" class="form-field-error" role="alert">{{ typeCodeError }}</div>
            </el-form-item>
            <el-form-item>
              <template #label>
                <span class="required-label"><span class="required-mark">*</span>名称</span>
              </template>
              <el-input v-model="form.name" placeholder="例如 断路器" />
            </el-form-item>
            <el-form-item>
              <template #label>
                分类
              </template>
              <div class="category-row">
                <el-select v-model="form.category" style="width: 100%;">
                  <el-option
                    v-for="category in categoryOptions"
                    :key="category.value"
                    :label="category.label"
                    :value="category.value"
                  />
                </el-select>
                <el-button @click="applyCategoryDefaultSize">使用默认尺寸</el-button>
              </div>
            </el-form-item>
            <el-form-item>
              <template #label>
                说明
              </template>
              <el-input v-model="form.description" type="textarea" :rows="3" placeholder="节点类型用途说明" />
            </el-form-item>
            <el-form-item>
              <template #label>
                默认尺寸
              </template>
              <div class="default-size-row">
                <el-input-number v-model="form.defaultWidth" controls-position="right" />
                <span class="size-separator">x</span>
                <el-input-number v-model="form.defaultHeight" controls-position="right" />
              </div>
            </el-form-item>
            <el-form-item>
              <template #label>
                {{ iconFieldLabel }}
              </template>
              <div class="icon-upload-row">
                <div class="icon-preview">
                  <img v-if="isImageIcon(form.icon) && assetPreviewUrl(form.icon)" :src="assetPreviewUrl(form.icon)" :alt="iconFieldLabel" />
                  <span v-else>{{ assetLabel(form.icon) || "无" }}</span>
                </div>
                <div class="icon-upload-actions">
                  <el-input v-model="form.icon" :placeholder="iconFieldPlaceholder" />
                  <div class="icon-upload-buttons">
                    <el-button :loading="uploading" @click="chooseImage">上传图片</el-button>
                    <el-button :disabled="!form.icon" @click="form.icon = ''">清空</el-button>
                  </div>
                  <input
                    ref="fileInputRef"
                    class="hidden-file-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
                    @change="handleImageChange"
                  />
                </div>
              </div>
            </el-form-item>
            <el-form-item v-if="showStatusImages">
              <template #label>
                状态图片
              </template>
              <div class="status-image-grid">
                <div v-for="status in statusOptions" :key="status.value" class="status-image-item">
                  <div class="status-image-title">{{ status.label }}</div>
                  <div class="icon-preview">
                    <img
                      v-if="isImageIcon(form.statusImages[status.value]) && assetPreviewUrl(form.statusImages[status.value])"
                      :src="assetPreviewUrl(form.statusImages[status.value])"
                      :alt="status.label"
                    />
                    <span v-else>{{ assetLabel(form.statusImages[status.value]) || "无" }}</span>
                  </div>
                  <el-input v-model="form.statusImages[status.value]" placeholder="状态图片地址" />
                  <div class="icon-upload-buttons">
                    <el-button :loading="uploading && uploadingStatus === status.value" @click="chooseStatusImage(status.value)">上传</el-button>
                    <el-button :disabled="!form.statusImages[status.value]" @click="form.statusImages[status.value] = ''">清空</el-button>
                  </div>
                </div>
              </div>
            </el-form-item>
            <template v-if="form.category === 'annotation'">
              <el-form-item>
                <template #label>
                  文字颜色
                </template>
                <el-color-picker v-model="form.annotationTextColor" />
              </el-form-item>
              <el-form-item>
                <template #label>
                  文字大小
                </template>
                <el-input-number v-model="form.annotationTextSize" :min="1" controls-position="right" />
              </el-form-item>
              <el-form-item>
                <template #label>
                  字重
                </template>
                <el-select v-model="form.annotationFontWeight" style="width: 100%;">
                  <el-option v-for="option in annotationFontWeightOptions" :key="option.value" :label="option.label" :value="option.value" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <template #label>
                  字形
                </template>
                <el-select v-model="form.annotationFontStyle" style="width: 100%;">
                  <el-option label="常规" value="normal" />
                  <el-option label="斜体" value="italic" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <template #label>
                  装饰线
                </template>
                <el-select v-model="form.annotationTextDecoration" style="width: 100%;">
                  <el-option v-for="option in annotationTextDecorationOptions" :key="option.value" :label="option.label" :value="option.value" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <template #label>
                  对齐
                </template>
                <el-select v-model="form.annotationTextAlign" style="width: 100%;">
                  <el-option v-for="option in annotationTextAlignOptions" :key="option.value" :label="option.label" :value="option.value" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <template #label>
                  行高
                </template>
                <el-input-number v-model="form.annotationLineHeight" :min="1" controls-position="right" />
              </el-form-item>
            </template>
            <template v-if="form.category === 'control'">
              <el-form-item>
                <template #label>
                  按钮文字
                </template>
                <el-input v-model="form.buttonText" placeholder="按钮" />
              </el-form-item>
              <el-form-item>
                <template #label>
                  渲染方式
                </template>
                <el-select v-model="form.buttonRenderMode" style="width: 100%;">
                  <el-option v-for="option in buttonRenderModeOptions" :key="option.value" :label="option.label" :value="option.value" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <template #label>
                  默认显示
                </template>
                <el-switch v-model="form.buttonDefaultVisible" />
              </el-form-item>
              <el-form-item>
                <template #label>
                  按钮样式
                </template>
                <div class="style-form-stack">
                  <div v-if="form.buttonRenderMode === 'image'" class="style-optional-hint">
                    纯图片控件会按节点尺寸缩放图片，可以不设置背景、边框和文字样式。
                  </div>
                  <div v-if="form.buttonRenderMode !== 'image'" class="style-form-grid">
                  <label>
                    背景
                    <el-color-picker v-model="form.buttonStyleBackgroundColor" />
                  </label>
                  <label>
                    边框
                    <el-color-picker v-model="form.buttonStyleBorderColor" />
                  </label>
                  <label>
                    文字
                    <el-color-picker v-model="form.buttonStyleTextColor" />
                  </label>
                  <label>
                    字号
                    <el-input-number v-model="form.buttonStyleTextSize" :min="1" controls-position="right" />
                  </label>
                  <label>
                    边框宽
                    <el-input-number v-model="form.buttonStyleBorderWidth" :min="0" :step="0.5" controls-position="right" />
                  </label>
                  <label>
                    圆角
                    <el-input-number v-model="form.buttonStyleBorderRadius" :min="0" controls-position="right" />
                  </label>
                  <label>
                    横向内边距
                    <el-input-number v-model="form.buttonStylePaddingX" :min="0" controls-position="right" />
                  </label>
                  <label>
                    纵向内边距
                    <el-input-number v-model="form.buttonStylePaddingY" :min="0" controls-position="right" />
                  </label>
                  </div>
                </div>
              </el-form-item>
            </template>
          </el-form>
          </div>
          </div>
        </el-tab-pane>

        <el-tab-pane v-if="form.category === 'container'" name="container">
          <template #label>
            <NodeTypeTabHelpLabel label="容器能力" :summary="tabHelp.container" :items="tabFieldHelp.container" />
          </template>
          <div class="config-pane">
          <div class="config-pane-main">
          <el-form label-width="112px">
            <el-form-item>
              <template #label>
                容器节点
              </template>
              <el-switch v-model="form.isGroup" />
            </el-form-item>
            <el-form-item>
              <template #label>
                允许嵌套容器
              </template>
              <el-switch v-model="form.allowNestedGroup" :disabled="!form.isGroup" />
            </el-form-item>
            <el-form-item>
              <template #label>
                可包含类型
              </template>
              <el-select
                v-model="form.canContain"
                multiple
                filterable
                allow-create
                default-first-option
                :disabled="!form.isGroup"
                placeholder="选择分类或节点类型，也可输入自定义编码"
                style="width: 100%;"
              >
                <el-option
                  v-for="option in containOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item v-if="form.category === 'container' || form.isGroup">
              <template #label>
                组样式
              </template>
              <div class="style-form-grid">
                <label>
                  背景
                  <el-color-picker v-model="form.groupBackgroundColor" />
                </label>
                <label>
                  边框
                  <el-color-picker v-model="form.groupBorderColor" />
                </label>
                <label>
                  背景透明度
                  <el-input-number v-model="form.groupBackgroundOpacity" :min="0" :max="100" controls-position="right" />
                </label>
                <label>
                  透明背景
                  <el-switch v-model="form.groupTransparentBackground" />
                </label>
                <label>
                  虚线边框
                  <el-switch v-model="form.groupDashedBorder" />
                </label>
              </div>
            </el-form-item>
          </el-form>
          </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="ports">
          <template #label>
            <NodeTypeTabHelpLabel label="端口配置" :summary="tabHelp.ports" :items="tabFieldHelp.ports" />
          </template>
          <div class="config-pane">
          <div class="config-pane-main">
          <section class="table-section">
            <div class="section-toolbar">
              <span class="section-title">端口</span>
              <span class="section-spacer" />
              <el-button @click="addDefaultPorts">使用默认四端口</el-button>
              <el-button type="primary" @click="addPort">添加端口</el-button>
            </div>
            <el-table :data="form.ports" class="field-table" empty-text="暂无端口，保存后该节点类型不会生成端口">
              <el-table-column min-width="120">
                <template #header>编码</template>
                <template #default="{ row }"><el-input v-model="row.id" placeholder="top" /></template>
              </el-table-column>
              <el-table-column min-width="120">
                <template #header>名称</template>
                <template #default="{ row }"><el-input v-model="row.label" placeholder="上端点" /></template>
              </el-table-column>
              <el-table-column width="112">
                <template #header>方向</template>
                <template #default="{ row }">
                  <el-select v-model="row.direction">
                    <el-option v-for="option in portDirectionOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column width="100">
                <template #header>所在边</template>
                <template #default="{ row }">
                  <el-select v-model="row.side">
                    <el-option v-for="option in portSideOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column width="140">
                <template #header>位置(%)</template>
                <template #default="{ row }">
                  <el-input-number v-model="row.positionPercent" :min="0" :max="100" :step="1" :precision="0" controls-position="right" />
                </template>
              </el-table-column>
              <el-table-column width="110">
                <template #header>最大连接</template>
                <template #default="{ row }"><el-input v-model="row.maxLinks" placeholder="1" /></template>
              </el-table-column>
              <el-table-column min-width="150">
                <template #header>连线类型</template>
                <template #default="{ row }"><el-input v-model="row.linkTypes" type="textarea" :rows="2" placeholder="一行一个或逗号分隔" /></template>
              </el-table-column>
              <el-table-column label="操作" width="80" fixed="right">
                <template #default="{ $index }"><el-button link type="danger" @click="removePort($index)">删除</el-button></template>
              </el-table-column>
            </el-table>
          </section>
          </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="form">
          <template #label>
            <NodeTypeTabHelpLabel label="动态表单" :summary="tabHelp.form" :items="tabFieldHelp.form" />
          </template>
          <div class="config-pane">
          <div class="config-pane-main">
          <section class="table-section">
            <div class="section-toolbar">
              <span class="section-title">节点属性表单字段</span>
              <span class="section-spacer" />
              <el-button type="primary" @click="addFormField">添加字段</el-button>
            </div>
            <el-table :data="form.formSchema" class="field-table" empty-text="暂无动态表单字段">
              <el-table-column min-width="120">
                <template #header>字段</template>
                <template #default="{ row }"><el-input v-model="row.field" placeholder="assetNo" /></template>
              </el-table-column>
              <el-table-column min-width="120">
                <template #header>名称</template>
                <template #default="{ row }"><el-input v-model="row.label" placeholder="资产编号" /></template>
              </el-table-column>
              <el-table-column width="120">
                <template #header>类型</template>
                <template #default="{ row }">
                  <el-select v-model="row.type">
                    <el-option v-for="option in formFieldTypeOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column width="80" align="center">
                <template #header>必填</template>
                <template #default="{ row }"><el-checkbox v-model="row.required" /></template>
              </el-table-column>
              <el-table-column min-width="130">
                <template #header>默认值</template>
                <template #default="{ row }">
                  <div class="default-value-cell" :class="{ 'default-value-cell--error': formFieldDefaultError(row) }">
                    <el-input v-if="row.type === 'text'" v-model="row.defaultValue" placeholder="默认值" />
                    <el-input v-else-if="row.type === 'textarea'" v-model="row.defaultValue" type="textarea" :rows="2" placeholder="默认值" />
                    <el-input-number
                      v-else-if="row.type === 'number'"
                      :model-value="numberFormFieldDefaultValue(row.defaultValue)"
                      controls-position="right"
                      @update:model-value="updateDefaultValue(row, $event)"
                    />
                    <el-select
                      v-else-if="row.type === 'select'"
                      :model-value="row.defaultValue"
                      placeholder="请选择默认值"
                      @update:model-value="updateDefaultValue(row, $event)"
                    >
                      <el-option v-if="row.defaultValue && !isSelectDefaultValueMatched(row)" :label="`无效默认值：${row.defaultValue}`" :value="row.defaultValue" disabled />
                      <el-option v-for="option in editableFormFieldOptions(row) ?? []" :key="String(option.value)" :label="option.label" :value="String(option.value)" />
                    </el-select>
                    <el-date-picker
                      v-else-if="row.type === 'date'"
                      :model-value="row.defaultValue || undefined"
                      type="date"
                      value-format="YYYY-MM-DD"
                      placeholder="选择日期"
                      @update:model-value="updateDefaultValue(row, $event)"
                    />
                    <el-select
                      v-else-if="row.type === 'boolean'"
                      :model-value="row.defaultValue"
                      @update:model-value="updateDefaultValue(row, $event)"
                    >
                      <el-option label="未设置" value="" />
                      <el-option label="是" value="true" />
                      <el-option label="否" value="false" />
                    </el-select>
                    <el-color-picker
                      v-else-if="row.type === 'color'"
                      :model-value="colorFormFieldDefaultValue(row.defaultValue)"
                      color-format="hex"
                      @update:model-value="updateDefaultValue(row, $event)"
                    />
                    <el-input v-else v-model="row.defaultValue" placeholder="默认值" />
                    <span v-if="formFieldDefaultError(row)" class="form-field-error">{{ formFieldDefaultError(row) }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column width="100">
                <template #header>单位</template>
                <template #default="{ row }"><el-input v-model="row.unit" placeholder="V" /></template>
              </el-table-column>
              <el-table-column min-width="180">
                <template #header>选项</template>
                <template #default="{ row }"><el-input v-model="row.options" type="textarea" :rows="2" placeholder="标签:值，一行一个" /></template>
              </el-table-column>
              <el-table-column label="操作" width="80" fixed="right">
                <template #default="{ $index }"><el-button link type="danger" @click="removeFormField($index)">删除</el-button></template>
              </el-table-column>
            </el-table>
          </section>
          </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="custom">
          <template #label>
            <NodeTypeTabHelpLabel label="自定义扩展" :summary="tabHelp.custom" :items="tabFieldHelp.custom" />
          </template>
          <div class="config-pane">
          <div class="config-pane-main">
          <section class="table-section">
            <div class="section-toolbar">
              <span class="section-title">未知扩展字段</span>
              <span class="section-spacer" />
              <el-button type="primary" @click="addCustomExtension">添加扩展项</el-button>
            </div>
            <el-table :data="form.customExtensions" class="field-table" empty-text="暂无自定义扩展项">
              <el-table-column min-width="160">
                <template #header>字段名</template>
                <template #default="{ row }"><el-input v-model="row.key" placeholder="customFlag" /></template>
              </el-table-column>
              <el-table-column width="120">
                <template #header>类型</template>
                <template #default="{ row }">
                  <el-select v-model="row.type">
                    <el-option v-for="option in customExtensionTypeOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column min-width="360">
                <template #header>值</template>
                <template #default="{ row }">
                  <JsonTextEditor
                    v-if="row.type === 'object'"
                    :model-value="customExtensionObjectValue(row)"
                    :height="120"
                    placeholder='{ "key": "value" }'
                    @update:model-value="updateCustomExtensionObject(row, $event)"
                  />
                  <el-input
                    v-else
                    v-model="row.value"
                    type="textarea"
                    :rows="3"
                    placeholder="文本、数字、布尔或一行一个数组值"
                  />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="80" fixed="right">
                <template #default="{ $index }"><el-button link type="danger" @click="removeCustomExtension($index)">删除</el-button></template>
              </el-table-column>
            </el-table>
          </section>
          </div>
          </div>
        </el-tab-pane>
      </el-tabs>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.required-label {
  display: inline-flex;
  align-items: center;
}

.required-mark {
  margin-right: 4px;
  color: var(--el-color-danger);
  font-weight: 700;
}

.form-field-error {
  width: 100%;
  margin-top: 4px;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.25;
}

.node-type-icon,
.icon-preview {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  overflow: hidden;
  color: #155e75;
  background: #cffafe;
  border: 1px solid #a5f3fc;
  border-radius: 6px;
  font-size: 12px;
}

.node-type-icon img,
.icon-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.node-type-tabs {
  padding: 0 12px;
}

/* ===== 编辑弹窗容器 ===== */
.node-type-dialog :deep(.el-dialog) {
  padding: 0;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: 0 24px 60px rgb(15 23 42 / 18%);
}

.node-type-dialog :deep(.el-dialog__header) {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 16px 22px;
  background: linear-gradient(180deg, #f8fafc, #ffffff);
  border-bottom: 1px solid #eef0f4;
}

.node-type-dialog :deep(.el-dialog__title) {
  position: relative;
  padding-left: 12px;
  color: #0f172a;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
}

.node-type-dialog :deep(.el-dialog__title)::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  width: 4px;
  height: 16px;
  transform: translateY(-50%);
  background: var(--el-color-primary, #009688);
  border-radius: 2px;
}

.node-type-dialog :deep(.el-dialog__headerbtn) {
  top: 14px;
}

.node-type-dialog :deep(.el-dialog__body) {
  padding: 6px 22px 0;
}

.node-type-dialog :deep(.el-dialog__footer) {
  padding: 14px 22px;
  background: #fbfcfd;
  border-top: 1px solid #eef0f4;
}

/* ===== 配置 Tabs ===== */
.config-tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
}

.config-tabs :deep(.el-tabs__nav-wrap)::after {
  height: 1px;
  background: #eef0f4;
}

.config-tabs :deep(.el-tabs__item) {
  font-weight: 600;
}

.icon-upload-row {
  display: grid;
  grid-template-columns: 48px 1fr;
  align-items: start;
  gap: 10px;
  width: 100%;
}

.category-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  width: 100%;
}

.default-size-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.size-separator {
  color: #6b7280;
  font-size: 13px;
}

.icon-upload-actions {
  display: grid;
  gap: 8px;
}

.icon-upload-buttons {
  display: flex;
  gap: 8px;
}

.hidden-file-input {
  display: none;
}

.status-image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}

.status-image-item {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid #d8dde6;
  border-radius: 8px;
}

.style-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  width: 100%;
}

.style-form-stack {
  display: grid;
  gap: 10px;
  width: 100%;
}

.style-optional-hint {
  padding: 8px 10px;
  color: #64748b;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}

.style-form-grid label {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  color: #475569;
  font-size: 13px;
}

.status-image-title,
.section-title {
  color: #111827;
  font-size: 13px;
  font-weight: 700;
}

.table-section {
  display: grid;
  gap: 10px;
  margin-bottom: 18px;
}

.section-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-spacer {
  flex: 1;
}

.field-table {
  width: 100%;
  border: 1px solid #e6eaf0;
  border-radius: 8px;
  overflow: hidden;
}

.field-table :deep(thead th.el-table__cell) {
  background: #f8fafc;
  color: #334155;
  font-weight: 700;
}

/* 表格内数字步进器（如端口「位置」列）撑满列宽并左对齐，与相邻文本输入列保持一致 */
.field-table :deep(.el-input-number) {
  width: 100%;
}

.field-table :deep(.el-input-number .el-input__inner) {
  text-align: left;
}

.default-value-cell {
  display: grid;
  gap: 4px;
  width: 100%;
}

.default-value-cell :deep(.el-select),
.default-value-cell :deep(.el-date-editor) {
  width: 100%;
}

.default-value-cell--error :deep(.el-input__wrapper),
.default-value-cell--error :deep(.el-select__wrapper),
.default-value-cell--error :deep(.el-textarea__inner),
.default-value-cell--error :deep(.el-color-picker__trigger) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
</style>
