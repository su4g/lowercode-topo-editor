import {
  DEFAULT_TOPOLOGY_CANVAS,
  type TopologyCanvasConfig,
  type TopologyData
} from "@topo-editor/topology-shared";

export function normalizeTopologyCanvas(
  canvas?: Partial<TopologyCanvasConfig> | null
): TopologyCanvasConfig {
  const width = Number(canvas?.width);
  const height = Number(canvas?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : DEFAULT_TOPOLOGY_CANVAS.width,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : DEFAULT_TOPOLOGY_CANVAS.height
  };
}

export function normalizeTopologyData(data: TopologyData | null): TopologyData | null {
  if (!data) return null;
  return {
    ...data,
    canvas: normalizeTopologyCanvas(data.canvas),
    dataSources: data.dataSources ?? [],
    nodes: data.nodes ?? [],
    links: data.links ?? []
  };
}
