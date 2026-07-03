import { request } from "./http";

import type { DataSourceReference } from "@topo-editor/topology-shared";

export type RuntimeQueryOptions = {
  preview?: boolean;
  parentParams?: Record<string, unknown>;
  metaData?: Record<string, unknown>;
  sources?: DataSourceReference[];
};

export function queryRuntime(topologyId: string, sourceIds: string[], fields?: string[], options?: RuntimeQueryOptions): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/api/topologies/${topologyId}/runtime/query`, {
    method: "POST",
    body: JSON.stringify({
      sourceIds,
      fields,
      preview: options?.preview,
      parentParams: options?.parentParams,
      metaData: options?.metaData,
      sources: options?.sources
    })
  });
}
