import type { FastifyInstance } from "fastify";
import { createExpressionContext, pickExpressionFields, resolveExpressionValue, resolveTemplateString, type DataSourceConfig, type DataSourceReference, type DataSourceType, type ExpressionContext } from "@topo-editor/topology-shared";
import { prisma } from "../prisma/client";
import { ok } from "../common/http";

type RuntimeQueryBody = {
  sourceIds: string[];
  fields?: string[];
  preview?: boolean;
  parentParams?: Record<string, unknown>;
  metaData?: Record<string, unknown>;
  sources?: DataSourceReference[];
};

function pickFields(data: Record<string, unknown>, fields?: string[]) {
  return pickExpressionFields(data, fields);
}

function resolveRecord<T extends Record<string, unknown>>(value: T | undefined, context: ExpressionContext) {
  return resolveExpressionValue(value ?? {}, context) as T;
}

function createRuntimeUrl(rawUrl: string, query: Record<string, string>, context: ExpressionContext) {
  const baseUrl = process.env.RUNTIME_API_BASE_URL ?? "http://localhost:3000";
  const url = new URL(resolveTemplateString(rawUrl, context), baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

async function queryHttpSource(config: DataSourceConfig, fields: string[] | undefined, templateContext: ExpressionContext) {
  if (!config.url) return {};

  const headers = resolveRecord(config.headers, templateContext) as Record<string, string>;
  const query = resolveRecord(config.query, templateContext) as Record<string, string>;
  const method = config.method ?? "GET";
  const url = createRuntimeUrl(config.url, query, templateContext);
  const body = resolveRecord(config.body, templateContext);
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json() as unknown;
  return pickFields((payload ?? {}) as Record<string, unknown>, fields);
}

async function querySource(sourceId: string, config: DataSourceConfig, type: DataSourceType | undefined, fields: string[] | undefined, preview: boolean, templateContext: ExpressionContext) {
  if (preview) return pickFields(config.mockData ?? config.data ?? {}, fields);
  if ((type ?? "static") === "static") return pickFields(config.data ?? config.mockData ?? {}, fields);
  if (type === "http") return queryHttpSource(config, fields, templateContext);
  return pickFields(config.data ?? config.mockData ?? {}, fields);
}

export async function registerRuntimeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/topologies/:id/runtime/query", async (request) => {
    const body = request.body as RuntimeQueryBody;
    const rows = await prisma.topologyDataSource.findMany({
      where: {
        sourceCode: { in: body.sourceIds },
        enabled: true
      }
    });
    const rowBySourceId = new Map(rows.map((row) => [row.sourceCode, row]));
    const embeddedBySourceId = new Map((body.sources ?? []).map((source) => [source.sourceId, source]));
    const templateContext = createExpressionContext(body.metaData, body.parentParams);

    const entries = await Promise.all(body.sourceIds.map(async (sourceId) => {
      const embedded = embeddedBySourceId.get(sourceId);
      const row = rowBySourceId.get(sourceId);
      const config = embedded?.config ?? (row?.configJson as DataSourceConfig | undefined) ?? {};
      const type = embedded?.type ?? row?.sourceType as DataSourceType | undefined;
      const enabled = embedded?.enabled ?? row?.enabled ?? true;
      const payload = enabled
        ? await querySource(sourceId, config, type, body.fields, !!body.preview, templateContext)
        : {};

      return [
        sourceId,
        {
          ...payload,
          _quality: Object.fromEntries(Object.keys(payload).map((field) => [field, "good"])),
          _timestamp: Date.now()
        }
      ];
    }));

    return ok(Object.fromEntries(entries));
  });
}
