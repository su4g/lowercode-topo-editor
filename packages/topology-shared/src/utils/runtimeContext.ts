import type { ExpressionContext } from "./expression";
import type { TopologyData, TopologyNode } from "../types/topology";
import { createExpressionContext, readExpressionPath } from "./expression";
import { defaultRuntimeSource } from "./dataSource";
import { nodeIdentifier, nodeRuleIdentityCandidates } from "./nodeIdentity";

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function writeNodeFieldAliases(context: ExpressionContext, node: TopologyNode, field: string, value: unknown) {
  context[`${node.key}.${field}`] = value;
  const identifier = nodeIdentifier(node);
  if (identifier) context[`${identifier}.${field}`] = value;
}
function readDefaultNodeField(sourceData: Record<string, unknown>, node: TopologyNode, fieldName: string) {
  const fieldNames = fieldName === "state" ? ["state", "status"] : fieldName === "status" ? ["status", "state"] : [fieldName];
  for (const key of nodeRuleIdentityCandidates(node)) {
    for (const name of fieldNames) {
      const direct = readExpressionPath(sourceData, `${key}.${name}`);
      if (direct !== undefined) return direct;
      const nested = readExpressionPath(sourceData, `data.${key}.${name}`);
      if (nested !== undefined) return nested;
    }
  }
  return fieldNames.map((name) => readExpressionPath(sourceData, name)).find((value) => value !== undefined);
}
function exposeNodeFields(context: ExpressionContext, node: TopologyNode, sourceData: Record<string, unknown>) {
  for (const name of ["status", "state"]) { const value = readDefaultNodeField(sourceData, node, name); if (value !== undefined) writeNodeFieldAliases(context, node, name, value); }
  for (const key of nodeRuleIdentityCandidates(node)) {
    const direct = readExpressionPath(sourceData, key);
    const nested = readExpressionPath(sourceData, `data.${key}`);
    const record = isRecord(nested) ? nested : isRecord(direct) ? direct : null;
    if (!record) continue;
    for (const [field, value] of Object.entries(record)) writeNodeFieldAliases(context, node, field, value);
  }
}
function exposeSourceAliases(context: ExpressionContext, sourceId: string, sourceData: Record<string, unknown>, nodes: TopologyNode[], exposeShort: boolean) {
  for (const [field, value] of Object.entries(sourceData)) {
    if (field.startsWith("_")) continue;
    if (field === "data" && isRecord(value)) {
      for (const [key, dataValue] of Object.entries(value)) { if (!key.startsWith("_")) { context[`${sourceId}.data.${key}`] = dataValue; if (exposeShort && context[key] === undefined) context[key] = dataValue; } }
    } else { if (context[`${sourceId}.data.${field}`] === undefined) context[`${sourceId}.data.${field}`] = value; if (exposeShort && context[field] === undefined) context[field] = value; }
  }
  for (const node of nodes) for (const key of nodeRuleIdentityCandidates(node)) {
    const direct = readExpressionPath(sourceData, key); const nested = readExpressionPath(sourceData, `data.${key}`); const record = isRecord(nested) ? nested : isRecord(direct) ? direct : null;
    if (record) for (const [field, value] of Object.entries(record)) { context[`${sourceId}.${key}.${field}`] = value; context[`${sourceId}.data.${key}.${field}`] = value; }
  }
}

/** Canonical expression context shared by runtime and editor Mock debugging. */
export function buildTopologyExpressionContext(data: Pick<TopologyData, "nodes" | "dataSources">, runtime: Record<string, unknown>, metaData: Record<string, unknown> = {}): ExpressionContext {
  const context: ExpressionContext = { ...createExpressionContext(metaData), runtimeData: runtime, ...runtime };
  const defaultSource = defaultRuntimeSource(data);
  for (const source of data.dataSources ?? []) { const value = runtime[source.sourceId]; if (isRecord(value)) exposeSourceAliases(context, source.sourceId, value, data.nodes, defaultSource?.sourceId === source.sourceId); }
  const defaultData = defaultSource ? runtime[defaultSource.sourceId] as Record<string, unknown> | undefined : undefined;
  for (const node of data.nodes) {
    const sourceId = node.dataBinding?.sourceId;
    if (!sourceId) { if (isRecord(defaultData)) exposeNodeFields(context, node, defaultData); continue; }
    const sourceData = runtime[sourceId] as Record<string, unknown> | undefined;
    if (!sourceData) continue;
    for (const [field, value] of Object.entries(sourceData)) { context[`${sourceId}.${field}`] = value; context[`${node.key}.${field}`] = value; }
    for (const [alias, path] of Object.entries(node.dataBinding?.mappings ?? {})) context[`${node.key}.${alias}`] = readExpressionPath(sourceData, path);
  }
  if (defaultSource && isRecord(defaultData)) for (const key of ["status", "state"]) { const value = readExpressionPath(defaultData, key); if (value !== undefined) context[key] = value; }
  return context;
}
