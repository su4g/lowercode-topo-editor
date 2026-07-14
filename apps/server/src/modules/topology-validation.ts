import type { TopologyData } from "@topo-editor/topology-shared";

export type TopologyValidationError = {
  level: "error";
  targetType: "topology" | "node" | "link";
  targetKey?: string;
  message: string;
};

export type TopologyValidationResult = {
  valid: boolean;
  errors: TopologyValidationError[];
  versionId?: string;
};

export function validateTopology(topology: TopologyData, publish = false): TopologyValidationResult {
  const errors: TopologyValidationError[] = [];
  const nodeKeys = new Set<string>();
  const linkKeys = new Set<string>();

  for (const node of topology.nodes) {
    if (nodeKeys.has(node.key)) {
      errors.push({
        level: "error",
        targetType: "node",
        targetKey: node.key,
        message: `节点 key 重复：${node.key}`
      });
    }
    nodeKeys.add(node.key);
  }

  for (const link of topology.links) {
    if (linkKeys.has(link.key)) {
      errors.push({
        level: "error",
        targetType: "link",
        targetKey: link.key,
        message: `连线 key 重复：${link.key}`
      });
    }
    linkKeys.add(link.key);
    if (!nodeKeys.has(link.from) || !nodeKeys.has(link.to)) {
      errors.push({
        level: "error",
        targetType: "link",
        targetKey: link.key,
        message: `连线端点不存在：${link.from} -> ${link.to}`
      });
    }
  }

  if (publish && topology.nodes.length === 0) {
    errors.push({
      level: "error",
      targetType: "topology",
      message: "拓扑至少需要一个节点"
    });
  }

  return { valid: errors.length === 0, errors };
}
