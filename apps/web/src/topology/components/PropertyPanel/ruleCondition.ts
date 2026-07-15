import type { Condition, ConditionGroup, TopologyData, TopologyNode } from "@topo-editor/topology-shared";
import { findNodeByRuleIdentity, materializeRuleField, normalizeExpressionPath, sourceByRef } from "@topo-editor/topology-shared";

export type RuleConditionLogic = "and" | "or";
export type RuleConditionSourceType = "node" | "metaData";
export type RuleConditionValueType = "string" | "number" | "boolean";

export type RuleConditionDraft = {
  id: string;
  sourceType: RuleConditionSourceType;
  nodeKey: string;
  sourceId: string;
  field: string;
  customField: string;
  value: string;
  valueType: RuleConditionValueType;
  preserveRawField?: boolean;
};

export type RuleFieldOption = {
  field: string;
  label: string;
  type?: "string" | "number" | "boolean" | "enum" | "date" | "unknown";
  options?: Array<string | number | boolean>;
};

export function isSelectableRuleNode(node: Pick<TopologyNode, "typeId">) {
  return node.typeId !== "blank";
}

function draftId() {
  return `condition_${Date.now()}_${Math.round(Math.random() * 100000)}`;
}

function valueTypeOf(value: unknown): RuleConditionValueType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

export function createRuleConditionDraft(
  nodeKey: string,
  field = "state",
  value = "",
  sourceId = ""
): RuleConditionDraft {
  return {
    id: draftId(),
    sourceType: "node",
    nodeKey,
    sourceId,
    field,
    customField: "",
    value,
    valueType: "string"
  };
}

export function cloneRuleConditionDraft(draft: RuleConditionDraft): RuleConditionDraft {
  return {
    ...draft,
    id: draftId(),
    value: "",
    valueType: "string",
    preserveRawField: false
  };
}

export function fieldOptionsForNode(node: TopologyNode | null): RuleFieldOption[] {
  if (!node) return [{ field: "state", label: "状态", type: "string" }];

  const options: RuleFieldOption[] = [];
  const addOption = (option: RuleFieldOption) => {
    if (!option.field || options.some((item) => item.field === option.field)) return;
    options.push(option);
  };

  for (const [alias, path] of Object.entries(node.dataBinding?.mappings ?? {})) {
    addOption({
      field: alias,
      label: `${alias}${path && path !== alias ? `（${path}）` : ""}`,
      type: "unknown"
    });
  }
  for (const [key, value] of Object.entries(node.props ?? {})) {
    addOption({
      field: key,
      label: key,
      type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "unknown"
    });
  }
  for (const [key, value] of Object.entries(node.runtime ?? {})) {
    addOption({
      field: key,
      label: `运行态.${key}`,
      type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "unknown"
    });
  }
  addOption({ field: "state", label: "状态", type: "string" });
  return options;
}

export function normalizeDraftValue(draft: RuleConditionDraft, option?: RuleFieldOption) {
  if (option?.type === "number") {
    const value = Number(draft.value);
    return Number.isFinite(value) ? value : draft.value;
  }
  if (option?.type === "boolean") return draft.value === "true";
  if (draft.valueType === "number") {
    const value = Number(draft.value);
    return Number.isFinite(value) ? value : draft.value;
  }
  if (draft.valueType === "boolean") return draft.value === "true";
  const optionValue = option?.options?.find((value) => String(value) === draft.value);
  return optionValue ?? draft.value;
}

export function isFlatEqualityConditionGroup(group: ConditionGroup) {
  return group.conditions.length > 0
    && group.conditions.every((condition) => !("conditions" in condition) && condition.operator === "eq");
}

function draftForResolvedField(
  condition: Condition,
  nodeKey: string,
  sourceId: string,
  field: string,
  preserveRawField = false
): RuleConditionDraft {
  const nodeField = field || "state";
  return {
    id: draftId(),
    sourceType: "node",
    nodeKey,
    sourceId,
    field: "__custom__",
    customField: nodeField,
    value: condition.value === undefined || condition.value === null ? "" : String(condition.value),
    valueType: valueTypeOf(condition.value),
    preserveRawField
  };
}

function draftForNodeField(
  condition: Condition,
  node: TopologyNode,
  sourceId: string,
  field: string
) {
  const draft = draftForResolvedField(condition, node.key, sourceId, field);
  if (fieldOptionsForNode(node).some((option) => option.field === field)) {
    draft.field = field;
    draft.customField = "";
  }
  return draft;
}

export function parseRuleConditionDraft(
  condition: Condition,
  topology: TopologyData | null,
  fallbackNodeKey: string,
  allowMetaData: boolean
): RuleConditionDraft {
  if (condition.ref?.kind === "metadata") {
    return {
      id: draftId(), sourceType: "metaData", nodeKey: "", sourceId: "", field: "__custom__",
      customField: condition.ref.field || condition.field,
      value: condition.value === undefined || condition.value === null ? "" : String(condition.value),
      valueType: valueTypeOf(condition.value)
    };
  }
  if (condition.ref?.kind === "nodeField" && topology) {
    const node = topology.nodes.find((item) => item.key === condition.ref?.nodeKey);
    if (node) {
      const source = sourceByRef(topology, condition.ref);
      return draftForNodeField(condition, node, source?.sourceId ?? "", condition.ref.field);
    }
  }
  const resolvedField = materializeRuleField(condition.ref, topology, condition.field);
  const rawField = normalizeExpressionPath(resolvedField);
  const segments = rawField.split(".").filter(Boolean);
  const sources = (topology?.dataSources ?? []).filter((source) => source.enabled !== false);
  const source = sources.find((item) => item.sourceId === segments[0]);

  if (allowMetaData && ["metaData", "mateData", "runtimeData"].includes(segments[0])) {
    return {
      id: draftId(),
      sourceType: "metaData",
      nodeKey: "",
      sourceId: "",
      field: "__custom__",
      customField: rawField,
      value: condition.value === undefined || condition.value === null ? "" : String(condition.value),
      valueType: valueTypeOf(condition.value)
    };
  }

  if (source) {
    const sourceSegments = segments.slice(1);
    const identityIndex = sourceSegments[0] === "data" ? 1 : 0;
    const node = findNodeByRuleIdentity(topology?.nodes, sourceSegments[identityIndex]);
    if (node) {
      return draftForNodeField(
        condition,
        node,
        source.sourceId,
        sourceSegments.slice(identityIndex + 1).join(".")
      );
    }
    return draftForResolvedField(
      condition,
      fallbackNodeKey,
      source.sourceId,
      sourceSegments.join(".")
    );
  }

  const node = findNodeByRuleIdentity(topology?.nodes, segments[0]);
  if (node) {
    return draftForNodeField(condition, node, "", segments.slice(1).join("."));
  }

  if (allowMetaData) {
    return {
      id: draftId(),
      sourceType: "metaData",
      nodeKey: "",
      sourceId: "",
      field: "__custom__",
      customField: rawField,
      value: condition.value === undefined || condition.value === null ? "" : String(condition.value),
      valueType: valueTypeOf(condition.value)
    };
  }

  return draftForResolvedField(condition, fallbackNodeKey, "", rawField, true);
}

export function describeConditionGroup(group: ConditionGroup) {
  if (!isFlatEqualityConditionGroup(group)) return "高级条件（只读）";
  const joiner = (group.logic ?? "and") === "or" ? " 或 " : " 且 ";
  return group.conditions
    .map((condition) => {
      const item = condition as Condition;
      return `${item.field} = ${item.value === undefined ? "" : String(item.value)}`;
    })
    .join(joiner);
}

export function conditionGroupFields(group: ConditionGroup): string[] {
  const fields = group.conditions.flatMap((condition) => (
    "conditions" in condition ? conditionGroupFields(condition) : [condition.field]
  ));
  return [...new Set(fields.filter(Boolean))];
}
