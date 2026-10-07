import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, registerUser, resetDatabase } from "./helpers/db";

describe("认证接口", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("注册成功返回令牌，重复邮箱返回 409", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "observer@example.com", password: "Nature#2025", displayName: "观察者" });

    expect(response.status).toBe(201);
    expect(response.body.data.accessToken).toBeTypeOf("string");
    expect(response.body.data.user.email).toBe("observer@example.com");
    expect(response.body.data.user.passwordHash).toBeUndefined();

    const duplicate = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "observer@example.com", password: "Nature#2025", displayName: "观察者" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("密码过弱时返回 400 与字段级错误", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "weak@example.com", password: "12345678", displayName: "弱密码" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details.some((item: { path: string }) => item.path === "password")).toBe(true);
  });

  it("登录失败不区分邮箱是否存在", async () => {
    await registerUser({ email: "known@example.com" });

    const wrongPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "known@example.com", password: "WrongPass#2025" });
    const unknownEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "unknown@example.com", password: "WrongPass#2025" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknownEmail.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("刷新令牌轮换后旧令牌失效", async () => {
    const user = await registerUser();

    const me = await user.agent.get("/api/v1/auth/me").set("Authorization", `Bearer ${user.accessToken}`);
    expect(me.status).toBe(200);

    const refreshed = await user.agent.post("/api/v1/auth/refresh").send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTypeOf("string");

    const second = await user.agent.post("/api/v1/auth/refresh").send({});
    expect(second.status).toBe(200);

    const logout = await user.agent.post("/api/v1/auth/logout").send({});
    expect(logout.status).toBe(200);

    const afterLogout = await user.agent.post("/api/v1/auth/refresh").send({});
    expect(afterLogout.status).toBe(401);
  });

  it("未携带令牌访问受保护接口返回 401", async () => {
    const response = await request(app).get("/api/v1/sites");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});
