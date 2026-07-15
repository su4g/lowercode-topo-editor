import type { TopologyData } from "@topo-editor/topology-shared";
import { request } from "./http";
import { normalizeTopologyData } from "./adapters";

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

export async function getTopology(id: string): Promise<TopologyData | null> {
  return normalizeTopologyData(await request<TopologyData | null>(`/api/topologies/${id}`));
}

export async function createTopology(topology: TopologyData): Promise<TopologyData> {
  const normalized = normalizeTopologyData(topology) ?? topology;
  const result = await request<TopologyData>("/api/topologies", {
    method: "POST",
    body: JSON.stringify(normalized)
  });
  return normalizeTopologyData(result) ?? result;
}

export async function saveTopology(topology: TopologyData): Promise<TopologyData> {
  const normalized = normalizeTopologyData(topology) ?? topology;
  const result = await request<TopologyData>(`/api/topologies/${topology.id}`, {
    method: "PUT",
    body: JSON.stringify(normalized)
  });
  return normalizeTopologyData(result) ?? result;
}

export function deleteTopology(id: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/topologies/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
