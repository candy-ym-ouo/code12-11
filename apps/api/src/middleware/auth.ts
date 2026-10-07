import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "../lib/http";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(new ApiError(401, "UNAUTHENTICATED", "请先登录"));
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    }) as jwt.JwtPayload;
    if (!payload.sub) throw new Error("missing sub");
    req.user = {
      id: String(payload.sub),
      email: String(payload.email ?? ""),
      role: String(payload.role ?? "USER"),
    };
    next();
  } catch {
    next(new ApiError(401, "UNAUTHENTICATED", "登录状态已过期，请重新登录"));
  }
}

export function currentUser(req: Request): Express.AuthUser {
  if (!req.user) throw new ApiError(401, "UNAUTHENTICATED", "请先登录");
  return req.user;
}
