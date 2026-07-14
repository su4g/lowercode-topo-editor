import { describe, expect, it } from "vitest";
import {
  createExpressionContext,
  evaluateExpressionConditionGroup,
  type ConditionGroup,
  type TopologyData
} from "@topo-editor/topology-shared";
import {
  conditionGroupFields,
  describeConditionGroup,
  isFlatEqualityConditionGroup,
  isSelectableRuleNode,
  normalizeDraftValue,
  parseRuleConditionDraft
} from "./ruleCondition";

const topology: TopologyData = {
  id: "topology",
  name: "测试拓扑",
  version: "1",
  dataSources: [
    { sourceId: "api1", name: "接口一", type: "http", enabled: true }
  ],
  nodes: [
    {
      key: "breaker-1",
      typeId: "breaker",
      label: "断路器1",
      loc: "0 0",
      props: { identifier: "qf1", count: 1 },
      dataBinding: {
        enabled: true,
        sourceId: "api1",
        mappings: { status: "status" }
      }
    },
    {
      key: "blank-1",
      typeId: "blank",
      label: "空节点1",
      loc: "0 0"
    }
  ],
  links: []
};

describe("rule condition editor helpers", () => {
  it("filters blank node types without filtering normal labels", () => {
    expect(isSelectableRuleNode(topology.nodes[0])).toBe(true);
    expect(isSelectableRuleNode(topology.nodes[1])).toBe(false);
    expect(isSelectableRuleNode({ typeId: "breaker" })).toBe(true);
  });

  it("parses generated node and metadata fields for editing", () => {
    const nodeDraft = parseRuleConditionDraft(
      { field: "api1.data.qf1.status", operator: "eq", value: 1 },
      topology,
      "breaker-1",
      false
    );
    expect(nodeDraft).toMatchObject({
      sourceType: "node",
      nodeKey: "breaker-1",
      sourceId: "api1",
      field: "status",
      value: "1",
      valueType: "number"
    });
    expect(normalizeDraftValue(nodeDraft, { field: "status", label: "status", type: "unknown" })).toBe(1);

    const metadataDraft = parseRuleConditionDraft(
      { field: "qfStatus.button1", operator: "eq", value: "show" },
      topology,
      "breaker-1",
      true
    );
    expect(metadataDraft).toMatchObject({
      sourceType: "metaData",
      customField: "qfStatus.button1",
      value: "show"
    });
  });

  it("recognizes only flat equality groups as editable", () => {
    expect(isFlatEqualityConditionGroup({
      logic: "and",
      conditions: [{ field: "a", operator: "eq", value: 1 }]
    })).toBe(true);
    expect(isFlatEqualityConditionGroup({
      logic: "and",
      conditions: [{ field: "a", operator: "lt", value: 1 }]
    })).toBe(false);
    expect(isFlatEqualityConditionGroup({
      logic: "and",
      conditions: [{ logic: "or", conditions: [{ field: "a", operator: "eq", value: 1 }] }]
    })).toBe(false);
  });

  it("describes and evaluates AND/OR condition groups", () => {
    const conditions = [
      { field: "a", operator: "eq" as const, value: 1 },
      { field: "b", operator: "eq" as const, value: 2 }
    ];
    const andGroup: ConditionGroup = { logic: "and", conditions };
    const orGroup: ConditionGroup = { logic: "or", conditions };
    const context = createExpressionContext({ a: 1, b: 0 });

    expect(describeConditionGroup(andGroup)).toBe("a = 1 且 b = 2");
    expect(describeConditionGroup(orGroup)).toBe("a = 1 或 b = 2");
    expect(conditionGroupFields({
      logic: "and",
      conditions: [conditions[0], conditions[0], conditions[1]]
    })).toEqual(["a", "b"]);
    expect(evaluateExpressionConditionGroup(andGroup, context)).toBe(false);
    expect(evaluateExpressionConditionGroup(orGroup, context)).toBe(true);
  });
});
