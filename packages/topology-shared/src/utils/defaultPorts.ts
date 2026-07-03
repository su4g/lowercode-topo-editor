import type { PortDefinition } from "../types/node-type";

export const defaultNodePorts: PortDefinition[] = [
  { id: "top", label: "上端点", direction: "both", maxLinks: 1, signalType: "control" },
  { id: "right", label: "右端点", direction: "both", maxLinks: 1, signalType: "control" },
  { id: "bottom", label: "下端点", direction: "both", maxLinks: 1, signalType: "control" },
  { id: "left", label: "左端点", direction: "both", maxLinks: 1, signalType: "control" }
];

export function getNodePorts(ports?: PortDefinition[]): PortDefinition[] {
  return ports?.length ? ports : defaultNodePorts;
}
