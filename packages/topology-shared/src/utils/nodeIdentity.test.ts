import { describe, expect, it } from 'vitest';
import type { TopologyNode } from '../types/topology';
import { expressionFieldWithSource } from './ruleField';
import { nodeIdentifier, nodeInternalKey, nodeRuleIdentity, nodeRuleIdentityCandidates } from './nodeIdentity';

function node(patch: Partial<TopologyNode>): TopologyNode {
  return {
    key: 'breaker_001',
    typeId: 'breaker',
    label: 'Breaker One',
    loc: '0 0',
    ...patch
  };
}

describe('node identity helpers', () => {
  it('prefers props.identifier over the internal node key', () => {
    const target = node({ props: { identifier: ' qf1 ' } });

    expect(nodeInternalKey(target)).toBe('breaker_001');
    expect(nodeIdentifier(target)).toBe('qf1');
    expect(nodeRuleIdentity(target)).toBe('qf1');
  });

  it('falls back to the internal node key when identifier is absent', () => {
    expect(nodeRuleIdentity(node({ props: {} }))).toBe('breaker_001');
  });

  it('does not include label or typeId as rule identity candidates', () => {
    const candidates = nodeRuleIdentityCandidates(node({ props: { identifier: 'qf1' } }));

    expect(candidates).toEqual(expect.arrayContaining(['qf1', 'breaker_001', 'breaker001']));
    expect(candidates).not.toContain('Breaker One');
    expect(candidates).not.toContain('breaker');
  });
});

describe('topology rule field helpers', () => {
  const topology = {
    nodes: [node({ props: { identifier: 'qf1' } }), node({ key: 'switch_002', label: 'Switch Two', typeId: 'switch', props: {} })],
    dataSources: [{ sourceId: 'sourceA', type: 'static' as const }]
  };

  it('uses identifier for generated source data fields', () => {
    expect(expressionFieldWithSource(topology, topology.nodes[0], 'status', 'sourceA')).toBe('sourceA.data.qf1.status');
  });

  it('uses the raw internal key when identifier is absent', () => {
    expect(expressionFieldWithSource(topology, topology.nodes[1], 'status', 'sourceA')).toBe('sourceA.data.switch_002.status');
  });

  it('keeps custom absolute paths whose first segment is a node identifier', () => {
    expect(expressionFieldWithSource(topology, topology.nodes[0], 'qf1.status', 'sourceA')).toBe('qf1.status');
  });
});
