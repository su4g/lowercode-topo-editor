import type { FastifyInstance } from "fastify";
import { topologyDataSchema, type TopologyData } from "@topo-editor/topology-shared";
import { toPrismaJson } from "../common/json";
import { prisma } from "../prisma/client";
import { fail, ok } from "../common/http";
import { validateTopology } from "./topology-validation";

function latestConfig(row: Awaited<ReturnType<typeof prisma.topology.findFirst>> & { versions?: Array<{ configJson: unknown }> } | null): TopologyData | null {
  if (!row?.versions?.[0]) return null;
  return row.versions[0].configJson as TopologyData;
}

export async function registerTopologyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/topologies", async () => {
    const rows = await prisma.topology.findMany({
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" }
    });

    return ok(rows.map((row) => ({
      id: row.topologyCode,
      name: row.topologyName,
      status: row.status,
      version: row.versions[0]?.versionNo,
      updatedAt: row.updatedAt
    })));
  });

  app.get("/api/topologies/:id", async (request) => {
    const { id } = request.params as { id: string };
    const row = await prisma.topology.findUnique({
      where: { topologyCode: id },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } }
    });
    return ok(latestConfig(row));
  });

  app.post("/api/topologies", async (request, reply) => {
    try {
      const topology = topologyDataSchema.parse(request.body) as TopologyData;
      const validation = validateTopology(topology);
      if (!validation.valid) {
        return reply.status(400).send({ code: 400, message: validation.errors[0]?.message, data: validation });
      }
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.topology.create({
          data: {
            topologyCode: topology.id,
            topologyName: topology.name,
            status: "draft",
            versions: {
              create: {
                versionNo: topology.version,
                versionName: "草稿版本",
                configJson: toPrismaJson(topology),
                createdBy: "local"
              }
            }
          },
          include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } }
        });
        await tx.topologyOperationLog.create({
          data: {
            topologyId: created.id,
            operationType: "create",
            operationDesc: "创建拓扑",
            afterJson: toPrismaJson(topology),
            operator: "local"
          }
        });
        return created;
      });
      return ok(latestConfig(row));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.put("/api/topologies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const topology = topologyDataSchema.parse({ ...(request.body as object), id }) as TopologyData;
      const validation = validateTopology(topology);
      if (!validation.valid) {
        return reply.status(400).send({ code: 400, message: validation.errors[0]?.message, data: validation });
      }
      const row = await prisma.$transaction(async (tx) => {
        const previous = await tx.topology.findUnique({
          where: { topologyCode: id },
          include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } }
        });
        const saved = await tx.topology.upsert({
          where: { topologyCode: id },
          update: {
            topologyName: topology.name,
            status: "draft",
            versions: {
              create: {
                versionNo: topology.version,
                versionName: "草稿版本",
                configJson: toPrismaJson(topology),
                createdBy: "local"
              }
            }
          },
          create: {
            topologyCode: id,
            topologyName: topology.name,
            status: "draft",
            versions: {
              create: {
                versionNo: topology.version,
                versionName: "草稿版本",
                configJson: toPrismaJson(topology),
                createdBy: "local"
              }
            }
          },
          include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } }
        });
        await tx.topologyOperationLog.create({
          data: {
            topologyId: saved.id,
            operationType: "save",
            operationDesc: "保存拓扑",
            beforeJson: previous?.versions[0]?.configJson
              ? toPrismaJson(previous.versions[0].configJson)
              : undefined,
            afterJson: toPrismaJson(topology),
            operator: "local"
          }
        });
        return saved;
      });
      return ok(latestConfig(row));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/api/topologies/:id/versions", async (request) => {
    const { id } = request.params as { id: string };
    const topology = await prisma.topology.findUnique({ where: { topologyCode: id } });
    if (!topology) return ok([]);

    const rows = await prisma.topologyVersion.findMany({
      where: { topologyId: topology.id },
      orderBy: { createdAt: "desc" }
    });
    return ok(rows);
  });

  app.post("/api/topologies/:id/publish", async (request) => {
    const { id } = request.params as { id: string };
    const topology = await prisma.topology.findUnique({
      where: { topologyCode: id },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } }
    });

    if (!topology?.versions[0]) {
      return ok({ valid: false, errors: [{ level: "error", targetType: "topology", message: "拓扑不存在或没有版本" }] });
    }

    const version = topology.versions[0];
    const config = version.configJson as TopologyData;
    const validation = validateTopology(config, true);
    if (!validation.valid) return ok(validation);
    await prisma.$transaction(async (tx) => {
      await tx.topologyVersion.update({
        where: { id: version.id },
        data: { published: true }
      });
      await tx.topology.update({
        where: { id: topology.id },
        data: { status: "published", currentVersionId: version.id }
      });
      await tx.topologyOperationLog.create({
        data: {
          topologyId: topology.id,
          operationType: "publish",
          operationDesc: "发布拓扑",
          afterJson: toPrismaJson(config),
          operator: "local"
        }
      });
    });
    return ok({ ...validation, versionId: version.id });
  });

  app.delete("/api/topologies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const topology = await prisma.topology.findUnique({
        where: { topologyCode: id },
        include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } }
      });
      if (!topology) return reply.status(404).send({ code: 404, message: "拓扑不存在" });

      await prisma.$transaction(async (tx) => {
        await tx.topologyOperationLog.create({
          data: {
            topologyId: topology.id,
            operationType: "delete",
            operationDesc: "删除拓扑",
            beforeJson: topology.versions[0]?.configJson
              ? toPrismaJson(topology.versions[0].configJson)
              : undefined,
            operator: "local"
          }
        });
        await tx.topology.delete({ where: { id: topology.id } });
      });
      return ok({ id });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
