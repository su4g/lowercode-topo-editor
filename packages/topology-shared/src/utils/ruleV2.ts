import type { DataSourceReference } from "../types/data-source";
import type { Condition, ConditionGroup, DisplayRule, LinkRuntimeRule, RuleFieldReference } from "../types/rule";
import type { TopologyData, TopologyNode } from "../types/topology";
import { isConditionGroup, normalizeExpressionPath } from "./expression";
import { nodeMatchesRuleIdentity, nodeRuleIdentity } from "./nodeIdentity";

export type RuleHealthLevel = "valid" | "warning" | "invalid";
export type RuleHealthIssue = {
  level: Exclude<RuleHealthLevel, "valid">;
  code: "SOURCE_NOT_FOUND" | "SOURCE_DISABLED" | "NODE_NOT_FOUND" | "DEVICE_UNBOUND" | "POINT_UNBOUND" | "FIELD_NOT_FOUND" | "LEGACY_REFERENCE_AMBIGUOUS" | "LEGACY_EXPRESSION_UNRESOLVED";
  message: string;
};
export type RuleHealth = { level: RuleHealthLevel; issues: RuleHealthIssue[] };
export type RuleLike = DisplayRule | LinkRuntimeRule;

const META_TARGETS = new Set(["metaData", "mateData", "runtimeData", "params"]);

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createSourceRefId(sourceId: string, index = 0) {
  return `source_ref_${hashText(`${index}:${sourceId}`)}`;
}

export function sourceByRef(topology: Pick<TopologyData, "dataSources"> | null | undefined, ref: Pick<RuleFieldReference, "sourceRefId">) {
  if (!ref.sourceRefId) return null;
  return topology?.dataSources?.find((source) => source.refId === ref.sourceRefId) ?? null;
}

function matchingNodes(topology: Pick<TopologyData, "nodes">, identity: string) {
  return topology.nodes.filter((node) => nodeMatchesRuleIdentity(node, identity));
}

function sourceSnapshot(source: DataSourceReference | undefined) {
  return source ? { sourceName: source.name || source.sourceId } : undefined;
}

export function inferRuleFieldReference(
  rawField: string,
  topology: Pick<TopologyData, "nodes" | "dataSources">,
  fallbackNodeKey = ""
): { ref: RuleFieldReference; issue?: RuleHealthIssue } {
  const field = normalizeExpressionPath(rawField);
  const segments = field.split(".").filter(Boolean);
  const target = segments[0] ?? "";
  if (META_TARGETS.has(target)) return { ref: { kind: "metadata", field, legacyExpression: field } };

  const source = topology.dataSources?.find((item) => item.sourceId === target);
  if (source) {
    const sourceSegments = segments.slice(1);
    // Virtual-device binding is intentionally outside this standalone project.
    // Preserve old expressions as raw references instead of silently changing their meaning.
    if (sourceSegments[0] === "devices" && sourceSegments[2] === "params") {
      return {
        ref: { kind: "raw", field, legacyExpression: field, migrationIssue: "unresolved" },
        issue: { level: "warning", code: "LEGACY_EXPRESSION_UNRESOLVED", message: `虚拟设备表达式「${field}」需人工替换` }
      };
    }
    const identityIndex = sourceSegments[0] === "data" ? 1 : 0;
    const identity = sourceSegments[identityIndex] ?? "";
    const matches = matchingNodes(topology, identity);
    if (matches.length === 1) {
      const node = matches[0];
      return {
        ref: {
          kind: "nodeField",
          sourceRefId: source.refId,
          nodeKey: node.key,
          dataPath: sourceSegments.slice(0, identityIndex + 1).join("."),
          field: sourceSegments.slice(identityIndex + 1).join(".") || "state",
          snapshots: { ...sourceSnapshot(source), nodeLabel: node.label },
          legacyExpression: field
        }
      };
    }
    if (matches.length > 1) {
      return {
        ref: { kind: "raw", field, legacyExpression: field, migrationIssue: "ambiguous" },
        issue: { level: "invalid", code: "LEGACY_REFERENCE_AMBIGUOUS", message: `历史表达式「${field}」匹配到多个节点` }
      };
    }
  }

  const matches = matchingNodes(topology, target);
  if (matches.length === 1) {
    const node = matches[0];
    return { ref: { kind: "nodeField", nodeKey: node.key, field: segments.slice(1).join(".") || "state", snapshots: { nodeLabel: node.label }, legacyExpression: field } };
  }
  if (matches.length > 1) {
    return {
      ref: { kind: "raw", field, legacyExpression: field, migrationIssue: "ambiguous" },
      issue: { level: "invalid", code: "LEGACY_REFERENCE_AMBIGUOUS", message: `历史表达式「${field}」匹配到多个节点` }
    };
  }
  return {
    ref: { kind: "raw", field, legacyExpression: field, migrationIssue: "unresolved" },
    issue: { level: "warning", code: "LEGACY_EXPRESSION_UNRESOLVED", message: `自定义表达式「${field}」尚未转换为结构化引用` }
  };
}

export function createNodeFieldReference(
  topology: Pick<TopologyData, "nodes" | "dataSources">,
  node: TopologyNode,
  sourceId: string,
  field: string
): RuleFieldReference {
  const source = topology.dataSources?.find((item) => item.sourceId === sourceId);
  return {
    kind: "nodeField",
    nodeKey: node.key,
    sourceRefId: source?.refId,
    dataPath: source ? `data.${nodeRuleIdentity(node)}` : undefined,
    field,
    snapshots: { nodeLabel: node.label, sourceName: source?.name || source?.sourceId }
  };
}

export function materializeRuleField(ref: RuleFieldReference | undefined, topology: Pick<TopologyData, "nodes" | "dataSources"> | null | undefined, fallback: string) {
  if (!ref) return normalizeExpressionPath(fallback);
  if (ref.kind === "metadata" || ref.kind === "raw" || ref.kind === "virtualPoint") return normalizeExpressionPath(ref.legacyExpression || fallback || ref.field);
  const source = sourceByRef(topology, ref);
  const node = topology?.nodes.find((item) => item.key === ref.nodeKey);
  if (!node) return normalizeExpressionPath(fallback);
  if (source) return `${source.sourceId}.${ref.dataPath || `data.${nodeRuleIdentity(node)}`}.${ref.field}`;
  return `${node.key}.${ref.field}`;
}

export function ruleReferenceHealth(ref: RuleFieldReference | undefined, topology: Pick<TopologyData, "nodes" | "dataSources">): RuleHealth {
  if (!ref) return { level: "warning", issues: [{ level: "warning", code: "LEGACY_EXPRESSION_UNRESOLVED", message: "历史规则尚未建立结构化引用" }] };
  if (ref.kind === "raw") {
    const ambiguous = ref.migrationIssue === "ambiguous";
    return {
      level: ambiguous ? "invalid" : "warning",
      issues: [{ level: ambiguous ? "invalid" : "warning", code: ambiguous ? "LEGACY_REFERENCE_AMBIGUOUS" : "LEGACY_EXPRESSION_UNRESOLVED", message: ambiguous ? `历史表达式「${ref.legacyExpression || ref.field}」匹配到多个对象` : `自定义表达式「${ref.legacyExpression || ref.field}」需要人工确认` }]
    };
  }
  if (ref.kind === "metadata") return { level: "valid", issues: [] };
  if (ref.kind === "virtualPoint") return { level: "invalid", issues: [{ level: "invalid", code: "DEVICE_UNBOUND", message: "独立拓扑编辑器不支持虚拟设备绑定，请改用节点字段或外部数据" }] };

  const issues: RuleHealthIssue[] = [];
  const source = ref.sourceRefId ? sourceByRef(topology, ref) : null;
  if (ref.sourceRefId && !source) issues.push({ level: "invalid", code: "SOURCE_NOT_FOUND", message: `引用的接口「${ref.snapshots?.sourceName || ref.sourceRefId}」不存在` });
  else if (source?.enabled === false) issues.push({ level: "invalid", code: "SOURCE_DISABLED", message: `引用的接口「${source.name || source.sourceId}」已停用` });
  const node = ref.nodeKey ? topology.nodes.find((item) => item.key === ref.nodeKey) : null;
  if (ref.nodeKey && !node) issues.push({ level: "invalid", code: "NODE_NOT_FOUND", message: `引用的节点「${ref.snapshots?.nodeLabel || ref.nodeKey}」不存在` });
  if (!ref.field) issues.push({ level: "invalid", code: "FIELD_NOT_FOUND", message: "规则引用字段为空" });
  return { level: issues.length ? "invalid" : "valid", issues };
}

export function conditionHealth(group: ConditionGroup, topology: Pick<TopologyData, "nodes" | "dataSources">): RuleHealth {
  const issues = group.conditions.flatMap((condition) => isConditionGroup(condition) ? conditionHealth(condition, topology).issues : ruleReferenceHealth(condition.ref, topology).issues);
  return { level: issues.some((issue) => issue.level === "invalid") ? "invalid" : issues.length ? "warning" : "valid", issues };
}

export function ruleHealth(rule: RuleLike, topology: Pick<TopologyData, "nodes" | "dataSources">) {
  return conditionHealth(rule.condition, topology);
}

function migrateConditionGroup(group: ConditionGroup, topology: Pick<TopologyData, "nodes" | "dataSources">, fallbackNodeKey: string): ConditionGroup {
  return {
    ...group,
    conditions: group.conditions.map((condition) => {
      if (isConditionGroup(condition)) return migrateConditionGroup(condition, topology, fallbackNodeKey);
      if (condition.ref) return { ...condition, field: materializeRuleField(condition.ref, topology, condition.field) };
      const { ref } = inferRuleFieldReference(condition.field, topology, fallbackNodeKey);
      return { ...condition, legacyField: condition.legacyField || condition.field, ref, field: materializeRuleField(ref, topology, condition.field) };
    })
  };
}

function migrateRules<Rule extends RuleLike>(rules: Rule[] | undefined, topology: Pick<TopologyData, "nodes" | "dataSources">, fallbackNodeKey: string): Rule[] | undefined {
  return rules?.map((rule) => {
    const condition = migrateConditionGroup(rule.condition, topology, fallbackNodeKey);
    if (!("trigger" in rule)) return { ...rule, condition };
    const collectRefs = (group: ConditionGroup): RuleFieldReference[] => group.conditions.flatMap((item) => isConditionGroup(item) ? collectRefs(item) : item.ref ? [item.ref] : []);
    const refs = collectRefs(condition);
    return { ...rule, condition, trigger: { ...rule.trigger, sourceRefs: rule.trigger.sourceRefs?.length ? rule.trigger.sourceRefs : refs, sources: refs.map((ref, index) => materializeRuleField(ref, topology, rule.trigger.sources?.[index] ?? "")) } };
  });
}

/** Upgrade legacy rules in memory without mutating the caller's topology. */
export function migrateTopologyRulesV2(data: TopologyData): TopologyData {
  const dataSources = (data.dataSources ?? []).map((source, index) => ({ ...source, refId: source.refId || createSourceRefId(source.sourceId, index) }));
  const base = { ...data, dataSources, nodes: data.nodes ?? [] };
  const nodes = base.nodes.map((node) => ({ ...node, displayRules: migrateRules(node.displayRules, base, node.key) }));
  const topology = { ...base, nodes };
  const links = (data.links ?? []).map((link) => ({ ...link, rules: migrateRules(link.rules, topology, link.from) }));
  return { ...topology, schemaVersion: Math.max(2, Number(data.schemaVersion) || 1), links, globalRules: migrateRules(data.globalRules, topology, "") };
}

const OPERATOR_LABELS: Record<Condition["operator"], string> = { eq: "等于", ne: "不等于", gt: "高于", gte: "不低于", lt: "低于", lte: "不高于", in: "属于", notIn: "不属于", exists: "存在", empty: "为空" };
const FIELD_LABELS: Record<string, string> = { collectValue: "采集值", status: "状态", state: "状态", paramName: "点位名称", unit: "单位", reportTime: "上报时间", paramNo: "点位编码", remark: "备注" };
const BUSINESS_VALUE_LABELS: Record<string, string> = { running: "运行", off: "停止", warning: "告警", fault: "故障", offline: "离线", normal: "正常", unknown: "未知", closed: "闭合", open: "断开" };
function valueText(value: unknown): string { if (typeof value === "string") return `「${BUSINESS_VALUE_LABELS[value] || value}」`; if (Array.isArray(value)) return value.map(valueText).join("、"); return String(value ?? "空"); }

export function describeCondition(condition: Condition, topology: Pick<TopologyData, "nodes" | "dataSources">) {
  const ref = condition.ref;
  const operator = OPERATOR_LABELS[condition.operator] || condition.operator;
  const suffix = condition.operator === "exists" || condition.operator === "empty" ? operator : `${operator} ${valueText(condition.value)}`;
  if (!ref) return `${condition.field} ${suffix}`;
  if (ref.kind === "nodeField") { const node = topology.nodes.find((item) => item.key === ref.nodeKey); return `节点「${node?.label || ref.snapshots?.nodeLabel || ref.nodeKey}」的${FIELD_LABELS[ref.field] || ref.field} ${suffix}`; }
  if (ref.kind === "metadata") return `外部数据「${ref.field}」${suffix}`;
  return `自定义条件「${ref.legacyExpression || ref.field}」${suffix}`;
}

export function describeConditionGroupBusiness(group: ConditionGroup, topology: Pick<TopologyData, "nodes" | "dataSources">): string {
  const joiner = (group.logic ?? "and") === "or" ? " 或 " : " 且 ";
  return group.conditions.map((condition) => isConditionGroup(condition) ? `（${describeConditionGroupBusiness(condition, topology)}）` : describeCondition(condition, topology)).join(joiner);
}
export function describeRuleAction(rule: RuleLike) {
  if ("state" in rule.action && rule.action.state) return `将线路状态设为「${BUSINESS_VALUE_LABELS[rule.action.state] || rule.action.state}」`;
  if ("status" in rule.action && rule.action.status) return `将节点状态设为「${BUSINESS_VALUE_LABELS[rule.action.status] || rule.action.status}」`;
  if ("visible" in rule.action && typeof rule.action.visible === "boolean") return rule.action.visible ? "显示节点" : "隐藏节点";
  if ("style" in rule.action && rule.action.style) return "应用配置样式";
  return "执行配置动作";
}
export function describeRuleBusiness(rule: RuleLike, topology: Pick<TopologyData, "nodes" | "dataSources">) { return `${describeConditionGroupBusiness(rule.condition, topology)}时，${describeRuleAction(rule)}`; }
