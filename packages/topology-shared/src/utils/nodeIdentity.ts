import type { TopologyNode } from '../types/topology';

export function normalizeNodeIdentityKey(value: string | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function nodeInternalKey(node: Pick<TopologyNode, 'key'> | null | undefined) {
  return node?.key ?? '';
}

export function nodeIdentifier(node: Pick<TopologyNode, 'props'> | null | undefined) {
  const identifier = node?.props?.identifier;
  return typeof identifier === 'string' ? identifier.trim() : '';
}

export function nodeRuleIdentity(node: Pick<TopologyNode, 'key' | 'props'> | null | undefined) {
  return nodeIdentifier(node) || nodeInternalKey(node);
}

export function nodeRuleIdentityCandidates(node: Pick<TopologyNode, 'key' | 'props'> | null | undefined) {
  const values = [nodeIdentifier(node), nodeInternalKey(node)];
  const candidates = values.flatMap((value) => {
    const text = value.trim();
    if (!text) return [];
    return [text, text.toLowerCase(), normalizeNodeIdentityKey(text)];
  });
  return [...new Set(candidates.filter(Boolean))];
}

export function nodeMatchesRuleIdentity(node: Pick<TopologyNode, 'key' | 'props'> | null | undefined, value: string | undefined) {
  const target = value?.trim();
  return !!target && nodeRuleIdentityCandidates(node).includes(target);
}

export function findNodeByRuleIdentity<T extends Pick<TopologyNode, 'key' | 'props'>>(nodes: T[] | undefined, value: string | undefined) {
  return nodes?.find((node) => nodeMatchesRuleIdentity(node, value)) ?? null;
}
