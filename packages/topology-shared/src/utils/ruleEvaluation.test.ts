import { describe, expect, it } from 'vitest';
import type { DisplayRule, LinkRuntimeRule } from '../types/rule';
import type { LinkRuntime, NodeRuntime } from '../types/runtime';
import { buildConditionTrace, linkRuleFields, nodeRuleFields, resolveLinkRuntimeWithTrace, resolveNodeRuntimeWithTrace } from './ruleEvaluation';

function nodeRule(overrides: Partial<DisplayRule>): DisplayRule {
  return {
    id: 'rule',
    name: '规则',
    priority: 0,
    condition: { logic: 'and', conditions: [] },
    action: {},
    ...overrides
  };
}

function linkRule(overrides: Partial<LinkRuntimeRule>): LinkRuntimeRule {
  return {
    id: 'rule',
    name: '规则',
    priority: 0,
    trigger: { type: 'dataChange' },
    condition: { logic: 'and', conditions: [] },
    action: {},
    ...overrides
  };
}

describe('nodeRuleFields', () => {
  it('仅收集实际写入 runtime 的字段（含 style 优先）', () => {
    expect(nodeRuleFields(nodeRule({ action: { color: '#f00', visible: false } })).sort()).toEqual(['color', 'visible']);
    expect(nodeRuleFields(nodeRule({ action: { style: { backgroundColor: '#111' }, backgroundColor: '#222' } }))).toEqual(['backgroundColor']);
    expect(nodeRuleFields(nodeRule({ action: {} }))).toEqual([]);
  });
});

describe('linkRuleFields', () => {
  it('收集 state 与 style 中的字段', () => {
    expect(linkRuleFields(linkRule({ action: { state: 'running', style: { color: '#0f0', width: 3 } } })).sort()).toEqual([
      'color',
      'state',
      'width'
    ]);
  });
});

describe('resolveNodeRuntimeWithTrace', () => {
  const base: NodeRuntime = {};

  it('命中的规则按优先级叠加，高优先级覆盖低优先级同名字段', () => {
    const low = nodeRule({ id: 'low', priority: 10, action: { color: '#111', status: 'warning' } });
    const high = nodeRule({ id: 'high', priority: 20, action: { color: '#999' } });
    const { runtime, evaluations } = resolveNodeRuntimeWithTrace([high, low], {}, base);

    expect(runtime.color).toBe('#999');
    expect(runtime.status).toBe('warning');

    const lowEval = evaluations.find((item) => item.ruleId === 'low')!;
    const highEval = evaluations.find((item) => item.ruleId === 'high')!;
    expect(highEval.status).toBe('active');
    expect(highEval.effectiveFields).toEqual(['color']);
    // low 的 color 被 high 覆盖，但 status 存活 → 仍算 active
    expect(lowEval.status).toBe('active');
    expect(lowEval.effectiveFields).toEqual(['status']);
    expect(lowEval.overriddenFields).toEqual(['color']);
  });

  it('命中但所有字段被覆盖 → overridden', () => {
    const low = nodeRule({ id: 'low', priority: 10, action: { color: '#111' } });
    const high = nodeRule({ id: 'high', priority: 20, action: { color: '#999' } });
    const { evaluations } = resolveNodeRuntimeWithTrace([low, high], {}, base);
    expect(evaluations.find((item) => item.ruleId === 'low')!.status).toBe('overridden');
  });

  it('空动作命中 → overridden 且无字段', () => {
    const empty = nodeRule({ id: 'empty', priority: 10, action: {} });
    const { evaluations } = resolveNodeRuntimeWithTrace([empty], {}, base);
    const evaluation = evaluations[0];
    expect(evaluation.status).toBe('overridden');
    expect(evaluation.effectiveFields).toEqual([]);
    expect(evaluation.overriddenFields).toEqual([]);
  });

  it('条件未命中 → inactive，且不写入 runtime', () => {
    const rule = nodeRule({
      id: 'cond',
      priority: 10,
      action: { color: '#111' },
      condition: { logic: 'and', conditions: [{ field: 'temp', operator: 'gt', value: 80 }] }
    });
    const { runtime, evaluations } = resolveNodeRuntimeWithTrace([rule], { temp: 20 }, base);
    expect(runtime.color).toBeUndefined();
    expect(evaluations[0].status).toBe('inactive');
    expect(evaluations[0].effectiveFields).toEqual([]);
  });
});

describe('resolveLinkRuntimeWithTrace', () => {
  it('命中规则写入 state 与 style，覆盖关系正确', () => {
    const base: LinkRuntime = { state: 'off' };
    const low = linkRule({ id: 'low', priority: 10, action: { state: 'running', style: { color: '#111' } } });
    const high = linkRule({ id: 'high', priority: 20, action: { style: { color: '#999' } } });
    const { runtime, evaluations } = resolveLinkRuntimeWithTrace([low, high], {}, base);
    expect(runtime.state).toBe('running');
    expect(runtime.color).toBe('#999');
    expect(evaluations.find((item) => item.ruleId === 'low')!.effectiveFields).toEqual(['state']);
    expect(evaluations.find((item) => item.ruleId === 'high')!.effectiveFields).toEqual(['color']);
  });
});

describe('buildConditionTrace', () => {
  it('逐条记录实际值与通过状态，并按 logic 汇总', () => {
    const trace = buildConditionTrace(
      {
        logic: 'or',
        conditions: [
          { field: 'temp', operator: 'gt', value: 80 },
          { field: 'state', operator: 'eq', value: 'fault' }
        ]
      },
      { temp: 92, state: 'running' }
    );
    expect(trace.passed).toBe(true);
    expect(trace.children?.[0]).toMatchObject({ field: 'temp', actual: 92, passed: true });
    expect(trace.children?.[1]).toMatchObject({ field: 'state', actual: 'running', passed: false });
  });

  it('嵌套分组递归求值', () => {
    const trace = buildConditionTrace(
      {
        logic: 'and',
        conditions: [
          { field: 'a', operator: 'eq', value: 1 },
          { logic: 'or', conditions: [{ field: 'b', operator: 'eq', value: 2 }] }
        ]
      },
      { a: 1, b: 3 }
    );
    expect(trace.passed).toBe(false);
    expect(trace.children?.[1].children?.[0]).toMatchObject({ field: 'b', passed: false });
  });
});
