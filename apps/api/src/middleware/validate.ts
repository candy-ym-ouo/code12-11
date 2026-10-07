import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny } from "zod";

type Schemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

/**
 * 校验中间件：解析结果写入 req.validated，避免直接改写 Express 的只读 getter。
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const validated: Request["validated"] = {};
      if (schemas.params) validated.params = schemas.params.parse(req.params);
      if (schemas.query) validated.query = schemas.query.parse(req.query);
      if (schemas.body) validated.body = schemas.body.parse(req.body);
      req.validated = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validatedBody<T>(req: Request): T {
  return req.validated.body as T;
}

export function validatedQuery<T>(req: Request): T {
  return (req.validated.query ?? {}) as T;
}

export function validatedParams<T>(req: Request): T {
  return (req.validated.params ?? req.params) as T;
}
