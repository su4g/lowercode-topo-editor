import type { PortDefinition, PortSide } from "../types/node-type";

export const DEFAULT_PORT_POSITION_PERCENT = 50;
export const VISUAL_PORT_ID_PREFIX = "__visual__";

export type NormalizedPortDefinition = PortDefinition & {
  side: PortSide;
  positionPercent: number;
};

export const defaultNodePorts: NormalizedPortDefinition[] = [
  { id: "top", label: "上端点", direction: "both", side: "top", positionPercent: 50, maxLinks: 1 },
  { id: "right", label: "右端点", direction: "both", side: "right", positionPercent: 50, maxLinks: 1 },
  { id: "bottom", label: "下端点", direction: "both", side: "bottom", positionPercent: 50, maxLinks: 1 },
  { id: "left", label: "左端点", direction: "both", side: "left", positionPercent: 50, maxLinks: 1 }
];

export function inferLegacyPortSide(port: Pick<PortDefinition, "id" | "direction">): PortSide {
  if (port.id === "top" || port.id === "right" || port.id === "bottom" || port.id === "left") return port.id;
  if (port.direction === "in") return "left";
  if (port.direction === "out") return "right";
  return "bottom";
}

export function normalizePortSide(port: Pick<PortDefinition, "id" | "direction" | "side">): PortSide {
  return port.side === "top" || port.side === "right" || port.side === "bottom" || port.side === "left"
    ? port.side
    : inferLegacyPortSide(port);
}

export function normalizePortPositionPercent(positionPercent?: number): number {
  if (positionPercent === undefined || positionPercent === null) return DEFAULT_PORT_POSITION_PERCENT;
  const value = Number(positionPercent);
  return Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : DEFAULT_PORT_POSITION_PERCENT;
}

export function normalizePortDefinition(port: PortDefinition): NormalizedPortDefinition {
  return {
    ...port,
    side: normalizePortSide(port),
    positionPercent: normalizePortPositionPercent(port.positionPercent)
  };
}

export function portPositionKey(port: Pick<NormalizedPortDefinition, "side" | "positionPercent">): string {
  return `${port.side}:${port.positionPercent}`;
}

export function findDuplicatePortPosition(ports: PortDefinition[]): NormalizedPortDefinition | undefined {
  const positions = new Set<string>();
  for (const port of ports) {
    const normalized = normalizePortDefinition(port);
    const key = portPositionKey(normalized);
    if (positions.has(key)) return normalized;
    positions.add(key);
  }
  return undefined;
}

export function portAlignmentFraction(port: Pick<NormalizedPortDefinition, "side" | "positionPercent">): { x: number; y: number } {
  const fraction = port.positionPercent / 100;
  if (port.side === "top") return { x: fraction, y: 0 };
  if (port.side === "right") return { x: 1, y: fraction };
  if (port.side === "bottom") return { x: fraction, y: 1 };
  return { x: 0, y: fraction };
}

export function getNodePorts(ports?: PortDefinition[]): PortDefinition[] {
  return Array.isArray(ports) ? ports : defaultNodePorts;
}
