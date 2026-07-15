import { describe, expect, it } from "vitest";
import type { DisplayRule, TopologyData, TopologyNode } from "@topo-editor/topology-shared";
import { countInvalidNodeRules } from "./ruleSummary";

const topology: TopologyData = { id: "topology", name: "测试", version: "1", nodes: [], links: [] };
const rule = (id: string, invalid: boolean): DisplayRule => ({ id, name: id, priority: 1, condition: { conditions: [{ field: "legacy.status", ref: invalid ? { kind: "raw", field: "legacy.status", migrationIssue: "ambiguous" } : { kind: "metadata", field: "metaData.status" }, operator: "eq", value: "running" }] }, action: { status: "running" } });
const node = (rules: DisplayRule[]): TopologyNode => ({ key: "n1", typeId: "device", label: "节点", loc: "0 0", displayRules: rules });

describe("property-panel rule summary", () => {
  it("counts invalid rules only", () => expect(countInvalidNodeRules(node([rule("ok", false), rule("bad", true)]), topology)).toBe(1));
});
