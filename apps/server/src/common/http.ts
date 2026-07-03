import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

export type ApiResponse<T> = {
  code: number;
  data?: T;
  message?: string;
};

export function ok<T>(data: T): ApiResponse<T> {
  return { code: 0, data };
}

export function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      code: 400,
      message: "请求参数校验失败",
      data: error.flatten()
    });
  }

  const message = error instanceof Error ? error.message : "服务器内部错误";
  return reply.status(500).send({ code: 500, message });
}
