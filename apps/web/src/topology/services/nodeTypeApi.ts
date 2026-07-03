import type { NodeTypeDefinition } from "@topo-editor/topology-shared";
import { request } from "./http";

export function listNodeTypes(): Promise<NodeTypeDefinition[]> {
  return request<NodeTypeDefinition[]>("/api/topology/node-types");
}

export function saveNodeType(nodeType: NodeTypeDefinition): Promise<NodeTypeDefinition> {
  return request<NodeTypeDefinition>("/api/topology/node-types", {
    method: "POST",
    body: JSON.stringify(nodeType)
  });
}

export function deleteNodeType(id: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/topology/node-types/${id}`, {
    method: "DELETE"
  });
}
