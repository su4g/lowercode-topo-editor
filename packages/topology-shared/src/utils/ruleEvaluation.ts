import type { Condition, ConditionGroup, DisplayRule, LinkRuntimeRule } from "../types/rule";
import type { LinkRuntime, NodeRuntime } from "../types/runtime";
import type { TopologyData } from "../types/topology";
import { compareExpressionValue, isConditionGroup, readExpressionPath, type ExpressionContext } from "./expression";
import { describeCondition, describeRuleBusiness, materializeRuleField, ruleHealth, type RuleHealth } from "./ruleV2";

export type RuleStatus = "active" | "overridden" | "inactive" | "invalid";
export type ConditionTrace = {
  logic?: "and" | "or";
  field?: string;
  description?: string;
  operator?: Condition["operator"];
  expected?: unknown;
  actual?: unknown;
  passed: boolean;
  children?: ConditionTrace[];
};
export type RuleEvaluation = {
  ruleId: string;
  name: string;
  description?: string;
  priority: number;
  hit: boolean;
  status: RuleStatus;
  health: RuleHealth;
  effectiveFields: string[];
  overriddenFields: string[];
  conditions: ConditionTrace[];
};
export type RuleOverviewGroup = {
  kind: "node" | "link";
  key: string;
  label: string;
  typeName: string;
  statusText: string;
  visible: boolean;
  tested?: boolean;
  evaluations: RuleEvaluation[];
  counts: { active: number; overridden: number; inactive: number; invalid: number; total: number };
};

function isSet(value: unknown) { return value !== undefined && value !== null; }
export function nodeRuleFields(rule: DisplayRule): string[] {
  const action = rule.action; const style = action.style; const fields: string[] = [];
  if (isSet(action.visible)) fields.push("visible");
  if (isSet(action.status)) fields.push("status");
  if (isSet(action.color)) fields.push("color");
  if (isSet(action.text)) fields.push("text");
  if (isSet(style?.backgroundColor ?? action.backgroundColor)) fields.push("backgroundColor");
  if (isSet(style?.backgroundOpacity)) fields.push("backgroundOpacity");
  if (isSet(style?.borderColor ?? action.borderColor)) fields.push("borderColor");
  if (isSet(style?.transparentBackground)) fields.push("transparentBackground");
  if (isSet(style?.dashedBorder)) fields.push("dashedBorder");
  if (isSet(action.opacity)) fields.push("opacity");
  return fields;
}
export function linkRuleFields(rule: LinkRuntimeRule): string[] {
  const fields: string[] = [];
  if (isSet(rule.action.state)) fields.push("state");
  if (rule.action.style) for (const [key, value] of Object.entries(rule.action.style)) if (isSet(value)) fields.push(key);
  return [...new Set(fields)];
}
export function applyNodeRule(runtime: NodeRuntime, rule: DisplayRule): NodeRuntime {
  const style = rule.action.style;
  return { ...runtime, visible: rule.action.visible ?? runtime.visible, status: rule.action.status ?? runtime.status, color: rule.action.color ?? runtime.color, text: rule.action.text ?? runtime.text, backgroundColor: style?.backgroundColor ?? rule.action.backgroundColor ?? runtime.backgroundColor, backgroundOpacity: style?.backgroundOpacity ?? runtime.backgroundOpacity, borderColor: style?.borderColor ?? rule.action.borderColor ?? runtime.borderColor, transparentBackground: style?.transparentBackground ?? runtime.transparentBackground, dashedBorder: style?.dashedBorder ?? runtime.dashedBorder, opacity: rule.action.opacity ?? runtime.opacity };
}
export function applyLinkRule(runtime: LinkRuntime, rule: LinkRuntimeRule): LinkRuntime {
  const style = rule.action.style;
  return { ...runtime, state: rule.action.state ?? runtime.state, ...style, flow: style?.flow ? { ...(runtime.flow ?? {}), ...style.flow } : runtime.flow, glow: style?.glow ? { ...(runtime.glow ?? {}), ...style.glow } : runtime.glow };
}
export function buildConditionTrace(group: ConditionGroup, context: ExpressionContext, topology?: Pick<TopologyData, "nodes" | "dataSources">): ConditionTrace {
  const children = group.conditions.map((condition): ConditionTrace => {
    if (isConditionGroup(condition)) return buildConditionTrace(condition, context, topology);
    const field = topology ? materializeRuleField(condition.ref, topology, condition.field) : condition.field;
    const actual = readExpressionPath(context, field);
    return { field, description: topology ? describeCondition(condition, topology) : undefined, operator: condition.operator, expected: condition.value, actual, passed: compareExpressionValue(actual, condition.operator, condition.value) };
  });
  const logic = group.logic ?? "and";
  return { logic, passed: logic === "or" ? children.some((child) => child.passed) : children.every((child) => child.passed), children };
}

type EvaluatedRule = DisplayRule | LinkRuntimeRule;
function evaluateRules<Rule extends EvaluatedRule, Runtime>(rules: Rule[], context: ExpressionContext, baseRuntime: Runtime, applyRule: (runtime: Runtime, rule: Rule) => Runtime, ruleFields: (rule: Rule) => string[], topology?: Pick<TopologyData, "nodes" | "dataSources">) {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority).map((rule) => {
    const health = topology ? ruleHealth(rule, topology) : { level: "valid" as const, issues: [] };
    const trace = buildConditionTrace(rule.condition, context, topology);
    return { rule, health, trace, hit: health.level !== "invalid" && trace.passed };
  });
  let runtime = baseRuntime;
  const lastSetter = new Map<string, string>();
  for (const { rule, hit } of ordered) if (hit) { runtime = applyRule(runtime, rule); for (const field of ruleFields(rule)) lastSetter.set(field, rule.id); }
  const evaluations: RuleEvaluation[] = ordered.map(({ rule, hit, health, trace }) => {
    const fields = hit ? ruleFields(rule) : [];
    const effectiveFields = fields.filter((field) => lastSetter.get(field) === rule.id);
    const overriddenFields = fields.filter((field) => lastSetter.get(field) !== rule.id);
    const status: RuleStatus = health.level === "invalid" ? "invalid" : !hit ? "inactive" : effectiveFields.length ? "active" : "overridden";
    return { ruleId: rule.id, name: rule.name, description: topology ? describeRuleBusiness(rule, topology) : rule.name, priority: rule.priority, hit, status, health, effectiveFields, overriddenFields, conditions: trace.children ?? [] };
  });
  return { runtime, evaluations };
}
export function resolveNodeRuntimeWithTrace(rules: DisplayRule[], context: ExpressionContext, baseRuntime: NodeRuntime, topology?: Pick<TopologyData, "nodes" | "dataSources">) { return evaluateRules(rules, context, baseRuntime, applyNodeRule, nodeRuleFields, topology); }
export function resolveLinkRuntimeWithTrace(rules: LinkRuntimeRule[], context: ExpressionContext, baseRuntime: LinkRuntime, topology?: Pick<TopologyData, "nodes" | "dataSources">) { return evaluateRules(rules, context, baseRuntime, applyLinkRule, linkRuleFields, topology); }
