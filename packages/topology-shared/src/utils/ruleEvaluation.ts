import type { Condition, DisplayRule, LinkRuntimeRule } from '../types/rule';
import type { LinkRuntime, NodeRuntime } from '../types/runtime';
import { compareExpressionValue, evaluateExpressionConditionGroup, isConditionGroup, readExpressionPath, type ExpressionContext } from './expression';
import type { ConditionGroup } from '../types/rule';

export type RuleStatus = 'active' | 'overridden' | 'inactive';

/** 条件求值追踪：分组节点带 logic/children，叶子条件带 field/operator/expected/actual。 */
export type ConditionTrace = {
  logic?: 'and' | 'or';
  field?: string;
  operator?: Condition['operator'];
  expected?: unknown;
  actual?: unknown;
  passed: boolean;
  children?: ConditionTrace[];
};

export type RuleEvaluation = {
  ruleId: string;
  name: string;
  priority: number;
  /** 条件是否命中 */
  hit: boolean;
  status: RuleStatus;
  /** 命中且存活到最终 runtime 的动作字段 */
  effectiveFields: string[];
  /** 命中但被更高优先级命中规则覆盖的动作字段 */
  overriddenFields: string[];
  conditions: ConditionTrace[];
};

export type RuleOverviewGroup = {
  kind: 'node' | 'link';
  key: string;
  label: string;
  typeName: string;
  statusText: string;
  visible: boolean;
  evaluations: RuleEvaluation[];
  counts: { active: number; overridden: number; inactive: number; total: number };
};

function isSet(value: unknown) {
  return value !== undefined && value !== null;
}

/** 节点规则实际会写入 runtime 的字段，与 applyNodeRule 的 `?? runtime.X` 守卫保持一致。 */
export function nodeRuleFields(rule: DisplayRule): string[] {
  const action = rule.action;
  const style = action.style;
  const fields: string[] = [];
  if (isSet(action.visible)) fields.push('visible');
  if (isSet(action.status)) fields.push('status');
  if (isSet(action.color)) fields.push('color');
  if (isSet(action.text)) fields.push('text');
  if (isSet(style?.backgroundColor ?? action.backgroundColor)) fields.push('backgroundColor');
  if (isSet(style?.backgroundOpacity)) fields.push('backgroundOpacity');
  if (isSet(style?.borderColor ?? action.borderColor)) fields.push('borderColor');
  if (isSet(style?.transparentBackground)) fields.push('transparentBackground');
  if (isSet(style?.dashedBorder)) fields.push('dashedBorder');
  if (isSet(action.opacity)) fields.push('opacity');
  return fields;
}

/** 连线规则实际会写入 runtime 的字段，与 applyLinkRule 的 state + `...style` 展开保持一致。 */
export function linkRuleFields(rule: LinkRuntimeRule): string[] {
  const action = rule.action;
  const style = action.style;
  const fields: string[] = [];
  if (isSet(action.state)) fields.push('state');
  if (style) {
    for (const [key, value] of Object.entries(style)) {
      if (isSet(value)) fields.push(key);
    }
  }
  return [...new Set(fields)];
}

export function applyNodeRule(runtime: NodeRuntime, rule: DisplayRule): NodeRuntime {
  const style = rule.action.style;
  return {
    ...runtime,
    visible: rule.action.visible ?? runtime.visible,
    status: rule.action.status ?? runtime.status,
    color: rule.action.color ?? runtime.color,
    text: rule.action.text ?? runtime.text,
    backgroundColor: style?.backgroundColor ?? rule.action.backgroundColor ?? runtime.backgroundColor,
    backgroundOpacity: style?.backgroundOpacity ?? runtime.backgroundOpacity,
    borderColor: style?.borderColor ?? rule.action.borderColor ?? runtime.borderColor,
    transparentBackground: style?.transparentBackground ?? runtime.transparentBackground,
    dashedBorder: style?.dashedBorder ?? runtime.dashedBorder,
    opacity: rule.action.opacity ?? runtime.opacity
  };
}

export function applyLinkRule(runtime: LinkRuntime, rule: LinkRuntimeRule): LinkRuntime {
  const style = rule.action.style;
  return {
    ...runtime,
    state: rule.action.state ?? runtime.state,
    ...style,
    flow: style?.flow ? { ...(runtime.flow ?? {}), ...style.flow } : runtime.flow,
    glow: style?.glow ? { ...(runtime.glow ?? {}), ...style.glow } : runtime.glow
  };
}

export function buildConditionTrace(group: ConditionGroup, context: ExpressionContext): ConditionTrace {
  const children: ConditionTrace[] = group.conditions.map((condition) => {
    if (isConditionGroup(condition)) return buildConditionTrace(condition, context);
    const actual = readExpressionPath(context, condition.field);
    return {
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual,
      passed: compareExpressionValue(actual, condition.operator, condition.value)
    };
  });
  const logic = group.logic ?? 'and';
  const passed = logic === 'or' ? children.some((child) => child.passed) : children.every((child) => child.passed);
  return { logic, passed, children };
}

type RuleLike = { id: string; name: string; priority: number; condition: ConditionGroup };

function evaluateRules<Rule extends RuleLike, Runtime>(
  rules: Rule[],
  context: ExpressionContext,
  baseRuntime: Runtime,
  applyRule: (runtime: Runtime, rule: Rule) => Runtime,
  ruleFields: (rule: Rule) => string[]
): { runtime: Runtime; evaluations: RuleEvaluation[] } {
  const ordered = [...rules]
    .sort((left, right) => left.priority - right.priority)
    .map((rule) => ({ rule, hit: evaluateExpressionConditionGroup(rule.condition, context) }));

  let runtime = baseRuntime;
  const lastSetterByField = new Map<string, string>();
  for (const { rule, hit } of ordered) {
    if (!hit) continue;
    runtime = applyRule(runtime, rule);
    for (const field of ruleFields(rule)) lastSetterByField.set(field, rule.id);
  }

  const evaluations = ordered.map(({ rule, hit }) => {
    const fields = hit ? ruleFields(rule) : [];
    const effectiveFields = fields.filter((field) => lastSetterByField.get(field) === rule.id);
    const overriddenFields = fields.filter((field) => lastSetterByField.get(field) !== rule.id);
    const status: RuleStatus = !hit ? 'inactive' : effectiveFields.length ? 'active' : 'overridden';
    return {
      ruleId: rule.id,
      name: rule.name,
      priority: rule.priority,
      hit,
      status,
      effectiveFields,
      overriddenFields,
      conditions: buildConditionTrace(rule.condition, context).children ?? []
    };
  });

  return { runtime, evaluations };
}

export function resolveNodeRuntimeWithTrace(rules: DisplayRule[], context: ExpressionContext, baseRuntime: NodeRuntime) {
  return evaluateRules(rules, context, baseRuntime, applyNodeRule, nodeRuleFields);
}

export function resolveLinkRuntimeWithTrace(rules: LinkRuntimeRule[], context: ExpressionContext, baseRuntime: LinkRuntime) {
  return evaluateRules(rules, context, baseRuntime, applyLinkRule, linkRuleFields);
}
