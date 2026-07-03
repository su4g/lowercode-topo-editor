import type { Condition, ConditionGroup } from "../types/rule";

export type ExpressionContext = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createExpressionContext(metaData?: Record<string, unknown>, parentParams?: Record<string, unknown>): ExpressionContext {
  const mergedMetaData = {
    ...(parentParams ?? {}),
    ...(metaData ?? {})
  };
  return {
    ...mergedMetaData,
    metaData: mergedMetaData,
    mateData: mergedMetaData
  };
}

export function normalizeExpressionPath(path: string) {
  const trimmed = path.trim();
  const dollarMatch = trimmed.match(/^\$\{\s*(.+?)\s*\}$/);
  if (dollarMatch?.[1]) return dollarMatch[1].trim();
  const braceMatch = trimmed.match(/^\{\s*(.+?)\s*\}$/);
  if (braceMatch?.[1]) return braceMatch[1].trim();
  return trimmed;
}

export function readExpressionPath(context: ExpressionContext, path: string): unknown {
  const normalizedPath = normalizeExpressionPath(path);
  if (!normalizedPath) return undefined;
  if (normalizedPath in context) return context[normalizedPath];
  return normalizedPath.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, context);
}

export function resolveTemplateString(template: string, context: ExpressionContext) {
  return template.replace(/\$\{\s*([a-zA-Z0-9_.-]+)\s*\}|\{([a-zA-Z0-9_.-]+)\}/g, (match, dollarKey: string | undefined, braceKey: string | undefined) => {
    const key = dollarKey ?? braceKey;
    if (!key) return match;
    const value = readExpressionPath(context, key);
    return value === undefined || value === null ? "" : String(value);
  });
}

export function resolveExpressionValue(value: unknown, context: ExpressionContext): unknown {
  if (typeof value === "string") return resolveTemplateString(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveExpressionValue(item, context));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveExpressionValue(item, context)]));
  }
  return value;
}

export function pickExpressionFields(data: ExpressionContext, fields?: string[]) {
  if (!fields?.length) return data;
  return fields.reduce<ExpressionContext>((picked, rawField) => {
    const field = normalizeExpressionPath(rawField);
    const value = readExpressionPath(data, field);
    if (value === undefined) return picked;
    const segments = field.split(".").filter(Boolean);
    let current = picked;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        current[segment] = value;
        return;
      }
      if (!isRecord(current[segment])) current[segment] = {};
      current = current[segment] as ExpressionContext;
    });
    return picked;
  }, {});
}

export function compareExpressionValue(actual: unknown, operator: Condition["operator"], expected: unknown) {
  if (operator === "exists") return actual !== undefined && actual !== null && actual !== "";
  if (operator === "empty") return actual === undefined || actual === null || actual === "";
  if (operator === "eq") return actual === expected;
  if (operator === "ne") return actual !== expected;
  if (operator === "in") return Array.isArray(expected) ? expected.includes(actual) : false;
  if (operator === "notIn") return Array.isArray(expected) ? !expected.includes(actual) : true;

  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
  if (operator === "gt") return actualNumber > expectedNumber;
  if (operator === "gte") return actualNumber >= expectedNumber;
  if (operator === "lt") return actualNumber < expectedNumber;
  if (operator === "lte") return actualNumber <= expectedNumber;
  return false;
}

export function isConditionGroup(value: Condition | ConditionGroup): value is ConditionGroup {
  return Array.isArray((value as ConditionGroup).conditions);
}

export function evaluateExpressionConditionGroup(group: ConditionGroup, context: ExpressionContext): boolean {
  const results = group.conditions.map((condition) => {
    if (isConditionGroup(condition)) return evaluateExpressionConditionGroup(condition, context);
    return compareExpressionValue(readExpressionPath(context, condition.field), condition.operator, condition.value);
  });

  return (group.logic ?? "and") === "or"
    ? results.some(Boolean)
    : results.every(Boolean);
}
