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

  it("rejects duplicate source codes and normalized node identifiers", () => {
    const result = validateTopology(topology({
      dataSources: [{ sourceId: "latest" }, { sourceId: "latest" }],
      nodes: [
        { key: "n1", typeId: "device", label: "A", loc: "0 0", props: { identifier: "QF-1" } },
        { key: "n2", typeId: "device", label: "B", loc: "0 0", props: { identifier: "qf1" } }
      ]
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.map((item) => item.message)).toEqual(expect.arrayContaining([expect.stringContaining("接口编码重复"), expect.stringContaining("节点标识重复")]));
  });

  it("reports precise invalid rule references before publish", () => {
    const data = topology({
      schemaVersion: 2,
      dataSources: [{ refId: "source-ref-1", sourceId: "latest", enabled: false }],
      nodes: [{
        key: "n1", typeId: "device", label: "设备", loc: "0 0",
        displayRules: [{ id: "rule-1", name: "规则", priority: 1, condition: { logic: "and", conditions: [{ field: "latest.data.n1.state", ref: { kind: "nodeField", nodeKey: "missing", sourceRefId: "source-ref-1", field: "state" }, operator: "eq", value: "on" }] }, action: { status: "running" } }]
      }]
    });
    const result = validateTopology(data, true);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "NODE_NOT_FOUND", ruleId: "rule-1", targetKey: "n1" }),
      expect.objectContaining({ code: "SOURCE_DISABLED", ruleId: "rule-1" })
    ]));
  });

  it("keeps unresolved custom expressions as publish warnings", () => {
    const data = topology({ nodes: [{ key: "n1", typeId: "device", label: "设备", loc: "0 0", displayRules: [{ id: "raw", name: "自定义", priority: 1, condition: { conditions: [{ field: "custom.value", ref: { kind: "raw", field: "custom.value", migrationIssue: "unresolved" }, operator: "eq", value: 1 }] }, action: { status: "running" } }] }] });
    const result = validateTopology(data, true);
    expect(result.valid).toBe(true);
    expect(result.errors[0]).toMatchObject({ level: "warning", code: "LEGACY_EXPRESSION_UNRESOLVED" });
  });
});
