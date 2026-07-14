import type { TopologyData } from "../types/topology";

export const DEFAULT_RUNTIME_SOURCE_ID = "default";

/** Resolve the implicit runtime source used by short expressions. */
export function defaultRuntimeSource(data: Pick<TopologyData, "dataSources"> | null | undefined) {
  const sources = (data?.dataSources ?? []).filter((source) => source.enabled !== false);
  return sources.find((source) => source.sourceId === DEFAULT_RUNTIME_SOURCE_ID)
    ?? (sources.length === 1 ? sources[0] : null);
}
