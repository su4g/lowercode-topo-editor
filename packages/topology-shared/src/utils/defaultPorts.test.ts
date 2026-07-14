import { describe, expect, it } from "vitest";
import {
  defaultNodePorts,
  findDuplicatePortPosition,
  getNodePorts,
  inferLegacyPortSide,
  portAlignmentFraction,
  normalizePortDefinition,
  normalizePortPositionPercent,
  portPositionKey
} from "./defaultPorts";

describe("topology port definitions", () => {
  it("defines the default ports explicitly at the middle of each side", () => {
    expect(defaultNodePorts.map(({ id, side, positionPercent }) => ({ id, side, positionPercent }))).toEqual([
      { id: "top", side: "top", positionPercent: 50 },
      { id: "right", side: "right", positionPercent: 50 },
      { id: "bottom", side: "bottom", positionPercent: 50 },
      { id: "left", side: "left", positionPercent: 50 }
    ]);
  });

  it("infers legacy sides from standard ids before direction", () => {
    expect(inferLegacyPortSide({ id: "top", direction: "in" })).toBe("top");
    expect(inferLegacyPortSide({ id: "inputA", direction: "in" })).toBe("left");
    expect(inferLegacyPortSide({ id: "outputA", direction: "out" })).toBe("right");
    expect(inferLegacyPortSide({ id: "bothA", direction: "both" })).toBe("bottom");
  });

  it("normalizes missing and invalid percentages while preserving 0 and 100", () => {
    expect(normalizePortPositionPercent()).toBe(50);
    expect(normalizePortPositionPercent(null as unknown as number)).toBe(50);
    expect(normalizePortPositionPercent(-1)).toBe(50);
    expect(normalizePortPositionPercent(101)).toBe(50);
    expect(normalizePortPositionPercent(Number.NaN)).toBe(50);
    expect(normalizePortPositionPercent(0)).toBe(0);
    expect(normalizePortPositionPercent(100)).toBe(100);
    expect(normalizePortPositionPercent(25.6)).toBe(26);
  });

  it("normalizes a legacy port and produces a stable duplicate-position key", () => {
    const port = normalizePortDefinition({ id: "inputA", label: "输入 A", direction: "in" });
    expect(port).toMatchObject({ side: "left", positionPercent: 50 });
    expect(portPositionKey(port)).toBe("left:50");
  });

  it("maps percentages to fractions along all four sides", () => {
    expect(portAlignmentFraction({ side: "top", positionPercent: 25 })).toEqual({ x: 0.25, y: 0 });
    expect(portAlignmentFraction({ side: "right", positionPercent: 25 })).toEqual({ x: 1, y: 0.25 });
    expect(portAlignmentFraction({ side: "bottom", positionPercent: 75 })).toEqual({ x: 0.75, y: 1 });
    expect(portAlignmentFraction({ side: "left", positionPercent: 75 })).toEqual({ x: 0, y: 0.75 });
  });

  it("keeps an explicit empty port array as no ports", () => {
    expect(getNodePorts([])).toEqual([]);
    expect(getNodePorts()).toBe(defaultNodePorts);
  });

  it("detects only ports that share both the same side and percentage", () => {
    const ports = [
      { id: "a", label: "A", direction: "both" as const, side: "left" as const, positionPercent: 20 },
      { id: "b", label: "B", direction: "both" as const, side: "left" as const, positionPercent: 80 },
      { id: "c", label: "C", direction: "both" as const, side: "right" as const, positionPercent: 20 }
    ];
    expect(findDuplicatePortPosition(ports)).toBeUndefined();
    expect(findDuplicatePortPosition([
      ...ports,
      { id: "d", label: "D", direction: "both", side: "left", positionPercent: 20 }
    ])).toMatchObject({ id: "d", side: "left", positionPercent: 20 });
  });
});
