import crypto from "node:crypto";
import type { User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../../config/env";
import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { signAccessToken } from "../../middleware/auth";
import type { LoginInput, RegisterInput, UpdateMeInput } from "./schema";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  timezone: string;
  createdAt: Date;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    timezone: user.timezone,
    createdAt: user.createdAt,
  };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

async function issueRefreshToken(userId: string, userAgent?: string): Promise<string> {
  const token = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent?.slice(0, 200) ?? null },
  });
  return token;
}

export async function createSession(user: User, userAgent?: string): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refreshToken = await issueRefreshToken(user.id, userAgent);
  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput, userAgent?: string) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ApiError(409, "EMAIL_TAKEN", "该邮箱已注册");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, displayName: input.displayName },
  });
  const session = await createSession(user, userAgent);
  return { user: toPublicUser(user), ...session };
}

export async function login(input: LoginInput, userAgent?: string) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码错误");

  const matches = await bcrypt.compare(input.password, user.passwordHash);
  if (!matches) throw new ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码错误");

  const session = await createSession(user, userAgent);
  return { user: toPublicUser(user), ...session };
}

export async function rotateRefreshToken(rawToken: string | undefined, userAgent?: string) {
  if (!rawToken) throw new ApiError(401, "UNAUTHENTICATED", "缺少刷新令牌");

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(401, "UNAUTHENTICATED", "刷新令牌无效，请重新登录");
  }

  const token = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return newRefreshToken();
  });

  await prisma.refreshToken.create({
    data: {
      userId: record.userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      userAgent: userAgent?.slice(0, 200) ?? record.userAgent,
    },
  });

  const accessToken = signAccessToken({
    sub: record.user.id,
    email: record.user.email,
    role: record.user.role,
  });
  return { accessToken, refreshToken: token, user: toPublicUser(record.user) };
}

export async function revokeRefreshToken(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "NOT_FOUND", "用户不存在");
  return toPublicUser(user);
}

export async function updateMe(userId: string, input: UpdateMeInput): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "NOT_FOUND", "用户不存在");

  const data: Partial<User> = {};
  if (input.displayName) data.displayName = input.displayName;
  if (input.timezone) data.timezone = input.timezone;

  if (input.newPassword) {
    const matches = await bcrypt.compare(input.currentPassword ?? "", user.passwordHash);
    if (!matches) throw new ApiError(401, "INVALID_CREDENTIALS", "当前密码不正确");
    data.passwordHash = await bcrypt.hash(input.newPassword, 12);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({ where: { id: userId }, data });
    if (input.newPassword) {
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return result;
  });

  return toPublicUser(updated);
}
