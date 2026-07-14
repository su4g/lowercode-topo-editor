import { unlink } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { fail, ok } from "../common/http";
import { prisma } from "../prisma/client";

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/topology/files", async (request) => {
    const query = request.query as {
      keyword?: string;
      businessType?: string;
      page?: string;
      pageSize?: string;
    };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const where = {
      ...(query.businessType ? { businessType: query.businessType } : {}),
      ...(query.keyword
        ? {
            OR: [
              { originalName: { contains: query.keyword, mode: "insensitive" as const } },
              { fileName: { contains: query.keyword, mode: "insensitive" as const } }
            ]
          }
        : {})
    };
    const [rows, total] = await Promise.all([
      prisma.topologyFile.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.topologyFile.count({ where })
    ]);
    return ok({
      rows: rows.map((row) => ({
        id: row.id,
        fileName: row.originalName,
        contentType: row.contentType,
        fileSize: row.fileSize,
        businessType: row.businessType,
        url: `/uploads/${row.fileName}`,
        createdAt: row.createdAt
      })),
      total
    });
  });

  app.get("/api/topology/files/types", async () => ok([
    { value: "topology-asset", label: "拓扑素材" },
    { value: "node-type-image", label: "节点类型图片" }
  ]));

  app.delete("/api/topology/files/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const row = await prisma.topologyFile.findUnique({ where: { id } });
      if (!row) return reply.status(404).send({ code: 404, message: "文件不存在" });
      await unlink(row.storagePath).catch(() => undefined);
      await prisma.topologyFile.delete({ where: { id } });
      return ok({ id });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
