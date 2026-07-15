import { isConditionGroup, type ConditionGroup, type RuleFieldReference, type TopologyData } from "@topo-editor/topology-shared";

export type TopologyValidationError = {
  level: "error" | "warning";
  code?: string;
  targetType: "topology" | "node" | "link";
  targetKey?: string;
  ruleId?: string;
  path?: string;
  message: string;
};
export type TopologyValidationResult = { valid: boolean; errors: TopologyValidationError[]; versionId?: string };

function normalizedIdentifier(value: unknown) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function issue(errors: TopologyValidationError[], value: TopologyValidationError) { errors.push(value); }

function validateReference(
  ref: RuleFieldReference | undefined,
  targetType: "topology" | "node" | "link",
  targetKey: string,
  ruleId: string,
  path: string,
  topology: TopologyData,
  errors: TopologyValidationError[]
) {
  // Missing refs are legacy V1 rules and remain publishable for compatibility.
  if (!ref) return;
  const add = (level: "error" | "warning", code: string, message: string) => issue(errors, { level, code, targetType, targetKey, ruleId, path, message });
  if (ref.kind === "raw") {
    if (ref.migrationIssue === "ambiguous") add("error", "LEGACY_REFERENCE_AMBIGUOUS", "历史规则表达式匹配到多个对象，需要人工确认");
    else add("warning", "LEGACY_EXPRESSION_UNRESOLVED", "历史自定义表达式尚未转换为结构化引用");
    return;
  }
  if (ref.kind === "metadata") return;
  if (ref.kind === "virtualPoint") {
    add("error", "DEVICE_UNBOUND", "独立拓扑编辑器不支持虚拟设备绑定，请改用节点字段或外部数据");
    return;
  }
  if (ref.nodeKey && !topology.nodes.some((node) => node.key === ref.nodeKey)) add("error", "NODE_NOT_FOUND", `规则引用的节点不存在：${ref.nodeKey}`);
  if (ref.sourceRefId) {
    const source = topology.dataSources?.find((item) => item.refId === ref.sourceRefId);
    if (!source) add("error", "SOURCE_NOT_FOUND", `规则引用的接口不存在：${ref.sourceRefId}`);
    else if (source.enabled === false) add("error", "SOURCE_DISABLED", `规则引用的接口已停用：${source.sourceId}`);
  }
  if (!ref.field?.trim()) add("error", "FIELD_NOT_FOUND", "规则引用字段不能为空");
}

function validateGroup(group: ConditionGroup, targetType: "topology" | "node" | "link", targetKey: string, ruleId: string, path: string, topology: TopologyData, errors: TopologyValidationError[]) {
  group.conditions.forEach((condition, index) => {
    const itemPath = `${path}/conditions/${index}`;
    if (isConditionGroup(condition)) validateGroup(condition, targetType, targetKey, ruleId, itemPath, topology, errors);
    else validateReference(condition.ref, targetType, targetKey, ruleId, `${itemPath}/ref`, topology, errors);
  });
}

function validateRuleReferences(topology: TopologyData, errors: TopologyValidationError[]) {
  topology.nodes.forEach((node, nodeIndex) => (node.displayRules ?? []).forEach((rule, ruleIndex) => validateGroup(rule.condition, "node", node.key, rule.id, `/nodes/${nodeIndex}/displayRules/${ruleIndex}/condition`, topology, errors)));
  topology.links.forEach((link, linkIndex) => (link.rules ?? []).forEach((rule, ruleIndex) => validateGroup(rule.condition, "link", link.key, rule.id, `/links/${linkIndex}/rules/${ruleIndex}/condition`, topology, errors)));
  (topology.globalRules ?? []).forEach((rule, ruleIndex) => validateGroup(rule.condition, "topology", topology.id, rule.id, `/globalRules/${ruleIndex}/condition`, topology, errors));
}

export function validateTopology(topology: TopologyData, publish = false): TopologyValidationResult {
  const errors: TopologyValidationError[] = [];
  const nodeKeys = new Set<string>();
  const identifiers = new Set<string>();
  const linkKeys = new Set<string>();
  const sourceIds = new Set<string>();
  const sourceRefIds = new Set<string>();

  for (const source of topology.dataSources ?? []) {
    if (sourceIds.has(source.sourceId)) issue(errors, { level: "error", targetType: "topology", targetKey: topology.id, message: `接口编码重复：${source.sourceId}` });
    sourceIds.add(source.sourceId);
    if (source.refId) {
      if (sourceRefIds.has(source.refId)) issue(errors, { level: "error", targetType: "topology", targetKey: topology.id, message: `接口稳定引用重复：${source.refId}` });
      sourceRefIds.add(source.refId);
    }
  }
  for (const node of topology.nodes) {
    if (nodeKeys.has(node.key)) issue(errors, { level: "error", targetType: "node", targetKey: node.key, message: `节点 key 重复：${node.key}` });
    nodeKeys.add(node.key);
    const identifier = normalizedIdentifier(node.props?.identifier);
    if (identifier) {
      if (identifiers.has(identifier)) issue(errors, { level: "error", targetType: "node", targetKey: node.key, message: `节点标识重复：${String(node.props?.identifier)}` });
      identifiers.add(identifier);
    }
  }
  for (const link of topology.links) {
    if (linkKeys.has(link.key)) issue(errors, { level: "error", targetType: "link", targetKey: link.key, message: `连线 key 重复：${link.key}` });
    linkKeys.add(link.key);
    if (!nodeKeys.has(link.from) || !nodeKeys.has(link.to)) issue(errors, { level: "error", targetType: "link", targetKey: link.key, message: `连线端点不存在：${link.from} -> ${link.to}` });
  }
  if (publish && topology.nodes.length === 0) issue(errors, { level: "error", targetType: "topology", targetKey: topology.id, message: "拓扑至少需要一个节点" });
  if (publish) validateRuleReferences(topology, errors);
  return { valid: !errors.some((item) => item.level === "error"), errors };
}
