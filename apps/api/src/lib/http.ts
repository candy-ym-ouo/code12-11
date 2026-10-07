import type { NextFunction, Request, RequestHandler, Response } from "express";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function sendData(res: Response, data: unknown, meta?: Record<string, unknown>, status = 200): void {
  res.status(status).json(meta ? { data, meta } : { data });
}

/** 时间线游标：base64url(JSON{ d: observationDate, i: id })，避免 offset 分页漂移。 */
export function encodeCursor(payload: { observationDate: string; id: string }): string {
  return Buffer.from(JSON.stringify({ d: payload.observationDate, i: payload.id }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { observationDate: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { d?: string; i?: string };
    if (!parsed.d || !parsed.i) return null;
    return { observationDate: parsed.d, id: parsed.i };
  } catch {
    return null;
  }
}
