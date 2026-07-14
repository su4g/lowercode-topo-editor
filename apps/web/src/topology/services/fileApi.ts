import { request } from "./http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type TopologyFile = {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  businessType: string;
  url: string;
  createdAt: string;
};

export function listTopologyFiles(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: TopologyFile[]; total: number }> {
  const query = new URLSearchParams();
  if (params.keyword) query.set("keyword", params.keyword);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  return request<{ rows: TopologyFile[]; total: number }>(`/api/topology/files?${query}`);
}

export function deleteTopologyFile(id: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/topology/files/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function topologyFileUrl(file: TopologyFile) {
  return file.url.startsWith("http") ? file.url : `${API_BASE_URL}${file.url}`;
}
