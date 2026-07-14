import type { TopologyData, TopologyNode } from '../types/topology';
import { normalizeExpressionPath } from './expression';
import { nodeMatchesRuleIdentity, nodeRuleIdentity } from './nodeIdentity';

const META_RULE_TARGETS = ['metaData', 'mateData', 'runtimeData'];

export function isAbsoluteTopologyRuleField(field: string, topology: Pick<TopologyData, 'nodes' | 'dataSources'> | null | undefined) {
  const normalizedField = normalizeExpressionPath(field);
  const target = normalizedField.split('.')[0];
  if (!target || target === normalizedField) return false;
  if (META_RULE_TARGETS.includes(target)) return true;
  if (topology?.nodes?.some((node) => nodeMatchesRuleIdentity(node, target))) return true;
  if (topology?.dataSources?.some((source) => source.sourceId === target)) return true;
  return false;
}

export function scopedTopologyRuleField(scopeKey: string, field: string, topology: Pick<TopologyData, 'nodes' | 'dataSources'> | null | undefined) {
  const normalizedField = normalizeExpressionPath(field);
  if (isAbsoluteTopologyRuleField(normalizedField, topology) || !scopeKey) return normalizedField;
  return `${scopeKey}.${normalizedField}`;
}

export function expressionFieldWithSource(
  topology: Pick<TopologyData, 'nodes' | 'dataSources'> | null | undefined,
  node: Pick<TopologyNode, 'key' | 'props'> | null | undefined,
  field: string,
  sourceId: string
) {
  const normalizedField = normalizeExpressionPath(field);
  if (isAbsoluteTopologyRuleField(normalizedField, topology)) return normalizedField;
  if (!sourceId) return scopedTopologyRuleField(node?.key ?? '', normalizedField, topology);
  if (normalizedField.includes('.')) return `${sourceId}.${normalizedField}`;
  const dataKey = nodeRuleIdentity(node);
  return dataKey ? `${sourceId}.data.${dataKey}.${normalizedField}` : `${sourceId}.${normalizedField}`;
}
