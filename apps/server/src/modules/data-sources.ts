import type { FastifyInstance } from "fastify";
import type { DataSource } from "@topo-editor/topology-shared";
import { toPrismaJson } from "../common/json";
import { prisma } from "../prisma/client";
import { fail, ok } from "../common/http";

function toDataSource(row: Awaited<ReturnType<typeof prisma.topologyDataSource.findFirst>>): DataSource | null {
  if (!row) return null;
  return {
    id: row.sourceCode,
    name: row.sourceName,
    type: row.sourceType as DataSource["type"],
    enabled: row.enabled,
    config: row.configJson as DataSource["config"]
  };
}

export async function registerDataSourceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/topology/data-sources", async () => {
    const rows = await prisma.topologyDataSource.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" }
    });
    return ok(rows.map(toDataSource).filter(Boolean));
  });

  app.post("/api/topology/data-sources", async (request, reply) => {
    try {
      const body = request.body as DataSource;
      const row = await prisma.topologyDataSource.upsert({
        where: { sourceCode: body.id },
        update: {
          sourceName: body.name,
          sourceType: body.type,
          enabled: body.enabled ?? true,
          configJson: toPrismaJson(body.config)
        },
        create: {
          sourceCode: body.id,
          sourceName: body.name,
          sourceType: body.type,
          enabled: body.enabled ?? true,
          configJson: toPrismaJson(body.config)
        }
      });
      return ok(toDataSource(row));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/topology/data-sources/preview", async (request) => {
    const body = request.body as { sourceId: string; fields?: string[] };
    const row = await prisma.topologyDataSource.findUnique({ where: { sourceCode: body.sourceId } });
    const data = (row?.configJson as { data?: Record<string, unknown> } | undefined)?.data ?? {};

    if (!body.fields?.length) return ok(data);

    const picked = Object.fromEntries(body.fields.map((field) => [field, data[field]]));
    return ok(picked);
  });
}
