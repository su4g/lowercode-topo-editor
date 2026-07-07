import type { PortDefinition } from "../types/node-type";

export const defaultNodePorts: PortDefinition[] = [
  { id: "top", label: "上端点", direction: "both", maxLinks: 1 },
  { id: "right", label: "右端点", direction: "both", maxLinks: 1 },
  { id: "bottom", label: "下端点", direction: "both", maxLinks: 1 },
  { id: "left", label: "左端点", direction: "both", maxLinks: 1 }
];

export function getNodePorts(ports?: PortDefinition[]): PortDefinition[] {
  return ports?.length ? ports : defaultNodePorts;
}
