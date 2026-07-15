import { ruleHealth, type TopologyData, type TopologyNode } from "@topo-editor/topology-shared";

export function countInvalidNodeRules(node: Pick<TopologyNode, "displayRules"> | null | undefined, topology: Pick<TopologyData, "nodes" | "dataSources"> | null | undefined) {
  if (!node || !topology) return 0;
  return (node.displayRules ?? []).filter((rule) => ruleHealth(rule, topology).level === "invalid").length;
}
