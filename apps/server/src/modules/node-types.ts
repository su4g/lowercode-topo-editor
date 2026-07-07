import type { FastifyInstance } from "fastify";
import type { NodeTypeDefinition } from "@topo-editor/topology-shared";
import { toPrismaJson } from "../common/json";
import { prisma } from "../prisma/client";
import { fail, ok } from "../common/http";

function cleanPorts(value: unknown): NodeTypeDefinition["ports"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((port): port is Record<string, unknown> => !!port && typeof port === "object" && !Array.isArray(port))
    .map((port) => ({
      id: String(port.id ?? ""),
      label: String(port.label ?? ""),
      direction: port.direction === "in" || port.direction === "out" || port.direction === "both" ? port.direction : "both",
      maxLinks: typeof port.maxLinks === "number" ? port.maxLinks : undefined,
      linkTypes: Array.isArray(port.linkTypes) ? port.linkTypes.map(String).filter(Boolean) : undefined
    }));
}

function toDefinition(row: Awaited<ReturnType<typeof prisma.topologyNodeType.findFirst>>): NodeTypeDefinition | null {
  if (!row) return null;
  const {
    bindableFields: _bindableFields,
    connectionCapabilities: _connectionCapabilities,
    actions: _actions,
    ports,
    ...config
  } = row.configJson as Record<string, unknown>;
  void _bindableFields;
  void _connectionCapabilities;
  void _actions;

  return {
    ...config,
    id: row.typeCode,
    name: row.typeName,
    category: row.category as NodeTypeDefinition["category"],
    template: row.templateCode,
    icon: row.icon ?? undefined,
    ports: cleanPorts(ports)
  } as NodeTypeDefinition;
}

function toConfigJson(body: NodeTypeDefinition) {
  const {
    id: _id,
    name: _name,
    category: _category,
    template: _template,
    icon: _icon,
    bindableFields: _bindableFields,
    connectionCapabilities: _connectionCapabilities,
    actions: _actions,
    ...config
  } = body;
  void _id;
  void _name;
  void _category;
  void _template;
  void _icon;
  void _bindableFields;
  void _connectionCapabilities;
  void _actions;

  return toPrismaJson({
    ...config,
    defaultSize: body.defaultSize,
    statusImages: body.statusImages,
    ports: cleanPorts(body.ports),
    formSchema: body.formSchema ?? []
  });
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
          configJson: toConfigJson(body)
        },
        create: {
          typeCode: body.id,
          typeName: body.name,
          category: body.category,
          templateCode: body.template,
          icon: body.icon,
          configJson: toConfigJson(body)
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
