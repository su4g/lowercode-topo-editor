import type { FastifyInstance } from "fastify";
import { getNodePorts, type NodeTypeDefinition } from "@topo-editor/topology-shared";
import { toPrismaJson } from "../common/json";
import { prisma } from "../prisma/client";
import { fail, ok } from "../common/http";

function toDefinition(row: Awaited<ReturnType<typeof prisma.topologyNodeType.findFirst>>): NodeTypeDefinition | null {
  if (!row) return null;
  return {
    id: row.typeCode,
    name: row.typeName,
    category: row.category as NodeTypeDefinition["category"],
    template: row.templateCode,
    icon: row.icon ?? undefined,
    ...(row.configJson as Record<string, unknown>)
  } as NodeTypeDefinition;
}

export async function registerNodeTypeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/topology/node-types", async () => {
    const rows = await prisma.topologyNodeType.findMany({
      where: { enabled: true },
      orderBy: [{ sortNo: "asc" }, { createdAt: "asc" }]
    });
    return ok(rows.map(toDefinition).filter(Boolean));
  });

  app.post("/api/topology/node-types", async (request, reply) => {
    try {
      const body = request.body as NodeTypeDefinition;
      const row = await prisma.topologyNodeType.upsert({
        where: { typeCode: body.id },
        update: {
          typeName: body.name,
          category: body.category,
          templateCode: body.template,
          icon: body.icon,
          configJson: toPrismaJson({
            description: body.description,
            defaultSize: body.defaultSize,
            statusImages: body.statusImages,
            isGroup: body.isGroup,
            canContain: body.canContain,
            allowNestedGroup: body.allowNestedGroup,
            ports: getNodePorts(body.ports),
            formSchema: body.formSchema ?? [],
            bindableFields: body.bindableFields ?? [],
            connectionCapabilities: body.connectionCapabilities ?? [],
            actions: body.actions ?? []
          })
        },
        create: {
          typeCode: body.id,
          typeName: body.name,
          category: body.category,
          templateCode: body.template,
          icon: body.icon,
          configJson: toPrismaJson({
            description: body.description,
            defaultSize: body.defaultSize,
            statusImages: body.statusImages,
            isGroup: body.isGroup,
            canContain: body.canContain,
            allowNestedGroup: body.allowNestedGroup,
            ports: getNodePorts(body.ports),
            formSchema: body.formSchema ?? [],
            bindableFields: body.bindableFields ?? [],
            connectionCapabilities: body.connectionCapabilities ?? [],
            actions: body.actions ?? []
          })
        }
      });
      return ok(toDefinition(row));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete("/api/topology/node-types/:id", async (request) => {
    const { id } = request.params as { id: string };
    await prisma.topologyNodeType.update({
      where: { typeCode: id },
      data: { enabled: false }
    });
    return ok({ id });
  });
}
