import { describe, expect, it } from "vitest";
import type { TopologyData } from "../types/topology";
import { resolveNodeRuntimeWithTrace } from "./ruleEvaluation";
import { materializeRuleField, migrateTopologyRulesV2, ruleHealth } from "./ruleV2";

function legacyTopology(): TopologyData {
  return {
    id: "demo", name: "演示拓扑", version: "1",
    dataSources: [{ sourceId: "latest", name: "最新数据", enabled: true }],
    nodes: [{ key: "device_001", typeId: "device", label: "1号断路器", loc: "0 0", props: { identifier: "qf1" }, displayRules: [{ id: "node-rule", name: "旧节点规则", priority: 20, condition: { logic: "and", conditions: [{ field: "latest.data.qf1.status", operator: "eq", value: "closed" }] }, action: { status: "running" } }] }],
    links: []
  };
}

describe("rule engine V2 migration", () => {
  it("upgrades legacy fields and keeps stable source/node references", () => {
    const migrated = migrateTopologyRulesV2(legacyTopology());
    const condition = migrated.nodes[0].displayRules?.[0].condition.conditions[0];
    if (!condition || "conditions" in condition) throw new Error("condition missing");
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.dataSources?.[0].refId).toMatch(/^source_ref_/);
    expect(condition.ref).toMatchObject({ kind: "nodeField", sourceRefId: migrated.dataSources?.[0].refId, nodeKey: "device_001", dataPath: "data.qf1", field: "status" });
  });

  it("source-code and node-identifier changes do not invalidate migrated references", () => {
    const migrated = migrateTopologyRulesV2(legacyTopology());
    migrated.dataSources![0].sourceId = "powerApi";
    migrated.nodes[0].props = { identifier: "breakerA" };
    const rule = migrated.nodes[0].displayRules?.[0];
    const condition = rule?.condition.conditions[0];
    if (!rule || !condition || "conditions" in condition) throw new Error("condition missing");
    expect(ruleHealth(rule, migrated).level).toBe("valid");
    expect(materializeRuleField(condition.ref, migrated, condition.field)).toBe("powerApi.data.qf1.status");
    expect(resolveNodeRuntimeWithTrace([rule], { "powerApi.data.qf1.status": "closed" }, {}, migrated).runtime.status).toBe("running");
  });

  it("preserves virtual-device expressions as unresolved raw references", () => {
    const data = legacyTopology();
    data.nodes[0].displayRules![0].condition.conditions = [{ field: "latest.devices.5515.params.3075.collectValue", operator: "eq", value: 0 }];
    const migrated = migrateTopologyRulesV2(data);
    const condition = migrated.nodes[0].displayRules![0].condition.conditions[0];
    if ("conditions" in condition) throw new Error("leaf expected");
    expect(condition.ref).toMatchObject({ kind: "raw", migrationIssue: "unresolved" });
    expect(ruleHealth(migrated.nodes[0].displayRules![0], migrated).level).toBe("warning");
  });
});
