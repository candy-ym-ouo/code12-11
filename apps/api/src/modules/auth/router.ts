import { Router } from "express";
import { env } from "../../config/env";
import { asyncHandler, sendData } from "../../lib/http";
import { currentUser, requireAuth } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimit";
import { validate, validatedBody } from "../../middleware/validate";
import { loginSchema, registerSchema, updateMeSchema } from "./schema";
import * as service from "./service";

export const authRouter = Router();

function setRefreshCookie(res: import("express").Response, token: string): void {
  res.cookie(env.refreshCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: env.refreshCookiePath,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: import("express").Response): void {
  res.clearCookie(env.refreshCookieName, { path: env.refreshCookiePath });
}

authRouter.post(
  "/register",
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<import("./schema").RegisterInput>(req);
    const result = await service.register(input, req.headers["user-agent"]);
    setRefreshCookie(res, result.refreshToken);
    sendData(
      res,
      { accessToken: result.accessToken, user: result.user },
      undefined,
      201,
    );
  }),
);

authRouter.post(
  "/login",
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<import("./schema").LoginInput>(req);
    const result = await service.login(input, req.headers["user-agent"]);
    setRefreshCookie(res, result.refreshToken);
    sendData(res, { accessToken: result.accessToken, user: result.user });
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const result = await service.rotateRefreshToken(
      req.cookies?.[env.refreshCookieName],
      req.headers["user-agent"],
    );
    setRefreshCookie(res, result.refreshToken);
    sendData(res, { accessToken: result.accessToken, user: result.user });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await service.revokeRefreshToken(req.cookies?.[env.refreshCookieName]);
    clearRefreshCookie(res);
    sendData(res, { ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await service.getMe(currentUser(req).id);
    sendData(res, user);
  }),
);

authRouter.patch(
  "/me",
  requireAuth,
  validate({ body: updateMeSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<import("./schema").UpdateMeInput>(req);
    const user = await service.updateMe(currentUser(req).id, input);
    sendData(res, user);
  }),
);
