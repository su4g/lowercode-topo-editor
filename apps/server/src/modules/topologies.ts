import type { FastifyInstance } from "fastify";
import { topologyDataSchema, type TopologyData } from "@topo-editor/topology-shared";
import { toPrismaJson } from "../common/json";
import { prisma } from "../prisma/client";
import { fail, ok } from "../common/http";

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
      const row = await prisma.topology.create({
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
      return ok(latestConfig(row));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.put("/api/topologies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const topology = topologyDataSchema.parse({ ...(request.body as object), id }) as TopologyData;
      const row = await prisma.topology.upsert({
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
    await prisma.topologyVersion.update({
      where: { id: version.id },
      data: { published: true }
    });
    await prisma.topology.update({
      where: { id: topology.id },
      data: { status: "published", currentVersionId: version.id }
    });
    return ok({ valid: true, versionId: version.id });
  });
}
