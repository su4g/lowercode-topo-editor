import { DEFAULT_TOPOLOGY_TEXT_COLOR } from "../types/topology";

export function resolveTopologyTextColor(...candidates: unknown[]): string {
  const color = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof color === "string" ? color : DEFAULT_TOPOLOGY_TEXT_COLOR;
}
