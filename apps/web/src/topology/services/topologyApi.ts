import type { TopologyData } from "@topo-editor/topology-shared";
import { request } from "./http";

export type TopologySummary = {
  id: string;
  name: string;
  status: string;
  version?: string;
  updatedAt: string;
};

export function listTopologies(): Promise<TopologySummary[]> {
  return request<TopologySummary[]>("/api/topologies");
}

export function getTopology(id: string): Promise<TopologyData | null> {
  return request<TopologyData | null>(`/api/topologies/${id}`);
}

export function createTopology(topology: TopologyData): Promise<TopologyData> {
  return request<TopologyData>("/api/topologies", {
    method: "POST",
    body: JSON.stringify(topology)
  });
}

export function saveTopology(topology: TopologyData): Promise<TopologyData> {
  return request<TopologyData>(`/api/topologies/${topology.id}`, {
    method: "PUT",
    body: JSON.stringify(topology)
  });
}

export function deleteTopology(id: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/topologies/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
