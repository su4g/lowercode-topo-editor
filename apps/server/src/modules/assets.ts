import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { fail, ok } from "../common/http";
import { prisma } from "../prisma/client";

const uploadDir = resolve(process.cwd(), "uploads");

const imageTypes: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg"
};

const extensionTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

function sanitizeName(value: string) {
  const ext = extname(value);
  const base = value.slice(0, value.length - ext.length);
  return base.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48) || "asset";
}

function resolveContentType(fileName?: string, contentType?: string) {
  if (contentType && imageTypes[contentType]) return contentType;
  const ext = extname(fileName ?? "").toLowerCase();
  return extensionTypes[ext] ?? "";
}

function validateSvg(buffer: Buffer) {
  const text = buffer.toString("utf8");
  const lower = text.toLowerCase();
  return lower.includes("<svg") && !lower.includes("<script") && !/\son[a-z]+\s*=/.test(lower);
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/topology/assets", async (request, reply) => {
    try {
      const body = request.body as {
        fileName?: string;
        contentType?: string;
        dataUrl?: string;
        businessType?: string;
      };

      const contentType = resolveContentType(body.fileName, body.contentType);
      const ext = imageTypes[contentType];
      if (!ext) {
        return reply.status(400).send({ code: 400, message: "仅支持 png、jpg、webp、gif、svg 图片" });
      }

      const match = body.dataUrl?.match(/^data:[^;]+;base64,(.+)$/);
      if (!match) {
        return reply.status(400).send({ code: 400, message: "图片数据格式不正确" });
      }

      const buffer = Buffer.from(match[1], "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        return reply.status(400).send({ code: 400, message: "图片不能超过 5MB" });
      }

      if (contentType === "image/svg+xml" && !validateSvg(buffer)) {
        return reply.status(400).send({ code: 400, message: "SVG 内容不合法或包含脚本" });
      }

      await mkdir(uploadDir, { recursive: true });

      const safeName = sanitizeName(body.fileName ?? "asset");
      const fileName = `${Date.now()}-${safeName}${ext}`;
      const filePath = join(uploadDir, fileName);
      await writeFile(filePath, buffer);
      const fileRecord = await prisma.topologyFile.create({
        data: {
          fileName,
          originalName: body.fileName ?? fileName,
          contentType,
          fileSize: buffer.length,
          businessType: body.businessType?.trim() || "topology-asset",
          storagePath: filePath
        }
      });

      return ok({
        id: fileRecord.id,
        fileName,
        contentType,
        url: `/uploads/${fileName}`
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/uploads/:fileName", async (request, reply) => {
    const { fileName } = request.params as { fileName: string };
    const safeFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "");
    const filePath = join(uploadDir, safeFileName);
    const ext = extname(safeFileName).toLowerCase();
    const contentType = extensionTypes[ext] ?? "application/octet-stream";

    return reply.type(contentType).send(createReadStream(filePath));
  });
}
