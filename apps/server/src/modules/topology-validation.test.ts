import { describe, expect, it } from "vitest";
import type { TopologyData } from "@topo-editor/topology-shared";
import { validateTopology } from "./topology-validation";

const topology = (patch: Partial<TopologyData> = {}): TopologyData => ({
  id: "demo",
  name: "测试拓扑",
  version: "1.0.0",
  nodes: [{ key: "n1", typeId: "device", label: "设备", loc: "0 0" }],
  links: [],
  ...patch
});

describe("validateTopology", () => {
  it("accepts a valid topology", () => {
    expect(validateTopology(topology(), true)).toEqual({ valid: true, errors: [] });
  });

  it("rejects links whose endpoints do not exist", () => {
    const result = validateTopology(topology({
      links: [{ key: "l1", from: "n1", to: "missing" }]
    }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain("连线端点不存在");
  });

  it("requires at least one node when publishing", () => {
    expect(validateTopology(topology({ nodes: [] }), true).valid).toBe(false);
  });
});
