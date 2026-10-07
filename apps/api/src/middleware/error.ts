import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { env } from "../config/env";
import { ApiError } from "../lib/http";
import { logger } from "../lib/logger";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, "NOT_FOUND", `接口不存在：${req.method} ${req.path}`));
}

type ErrorBody = {
  error: { code: string; message: string; details?: unknown; traceId?: string };
};

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const traceId = req.traceId;

  const respond = (status: number, code: string, message: string, details?: unknown) => {
    const body: ErrorBody = { error: { code, message } };
    if (details !== undefined) body.error.details = details;
    if (traceId) body.error.traceId = traceId;
    res.status(status).json(body);
  };

  if (error instanceof ApiError) {
    respond(error.status, error.code, error.message, error.details);
    return;
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    respond(400, "VALIDATION_ERROR", "请求参数不合法", details);
    return;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      respond(413, "FILE_TOO_LARGE", `单张图片不能超过 ${env.MAX_FILE_SIZE_MB}MB`);
      return;
    }
    if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
      respond(400, "VALIDATION_ERROR", `单条观测最多上传 ${env.MAX_PHOTOS_PER_OBSERVATION} 张图片`);
      return;
    }
    respond(400, "VALIDATION_ERROR", `上传失败：${error.message}`);
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? (error.meta?.target as string[]).join(",") : "唯一字段";
      respond(409, "DUPLICATE_RECORD", `数据重复：${target}`);
      return;
    }
    if (error.code === "P2003" || error.code === "P2014") {
      respond(409, "RESOURCE_IN_USE", "存在关联数据，无法完成该操作");
      return;
    }
    if (error.code === "P2025") {
      respond(404, "NOT_FOUND", "资源不存在");
      return;
    }
  }

  if (typeof error === "object" && error !== null && (error as { type?: string }).type === "entity.too.large") {
    respond(413, "PAYLOAD_TOO_LARGE", "请求体过大");
    return;
  }

  logger.error({ err: error, traceId }, "未处理的服务端错误");
  respond(500, "INTERNAL_ERROR", "服务器内部错误，请稍后重试");
}
