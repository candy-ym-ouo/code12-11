import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { app, auth, createSite, createSpeciesWithPhase, registerUser, resetDatabase } from "./helpers/db";

describe("地点与分享接口", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("创建地点成功，同名地点返回 409", async () => {
    const user = await registerUser();
    const created = await user.agent
      .post("/api/v1/sites")
      .set(auth(user.accessToken))
      .send({ name: "校园银杏道", latitude: 39.98, longitude: 116.31 });
    expect(created.status).toBe(201);
    expect(created.body.data.observationCount).toBe(0);

    const duplicate = await user.agent
      .post("/api/v1/sites")
      .set(auth(user.accessToken))
      .send({ name: "校园银杏道" });
    expect(duplicate.status).toBe(409);
  });

  it("不同用户可以使用相同地点名称", async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    for (const user of [alice, bob]) {
      const response = await user.agent.post("/api/v1/sites").set(auth(user.accessToken)).send({ name: "湿地栈道" });
      expect(response.status).toBe(201);
    }
  });

  it("删除含观测的地点返回 409 与引用数量", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);

    await user.agent.post("/api/v1/observations").set(auth(user.accessToken)).send({
      siteId: site.id,
      speciesId,
      phenophaseId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
    });

    const response = await user.agent.delete(`/api/v1/sites/${site.id}`).set(auth(user.accessToken));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("RESOURCE_IN_USE");
    expect(response.body.error.details.count).toBe(1);
  });

  it("访问他人地点返回 404", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const site = await createSite(alice.id, "别人的地点");

    const response = await bob.agent.get(`/api/v1/sites/${site.id}`).set(auth(bob.accessToken));
    expect(response.status).toBe(404);
  });

  it("归档后默认列表不返回，取消归档后恢复", async () => {
    const user = await registerUser();
    const site = await createSite(user.id, "待归档地点");

    await user.agent.post(`/api/v1/sites/${site.id}/archive`).set(auth(user.accessToken)).expect(200);
    const afterArchive = await user.agent.get("/api/v1/sites").set(auth(user.accessToken));
    expect(afterArchive.body.data).toHaveLength(0);

    const withArchived = await user.agent.get("/api/v1/sites?includeArchived=true").set(auth(user.accessToken));
    expect(withArchived.body.data).toHaveLength(1);

    await user.agent.post(`/api/v1/sites/${site.id}/unarchive`).set(auth(user.accessToken)).expect(200);
    const restored = await user.agent.get("/api/v1/sites").set(auth(user.accessToken));
    expect(restored.body.data).toHaveLength(1);
  });

  it("分享链接可匿名访问，撤销后失效", async () => {
    const user = await registerUser();
    const site = await createSite(user.id, "分享地点");
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);

    await user.agent.post("/api/v1/observations").set(auth(user.accessToken)).send({
      siteId: site.id,
      speciesId,
      phenophaseId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
      notes: "芽鳞裂开",
    });

    const created = await user.agent
      .post(`/api/v1/sites/${site.id}/share`)
      .set(auth(user.accessToken))
      .send({ scope: "TIMELINE_AND_COMPARE", expiresInDays: 7 });
    expect(created.status).toBe(201);

    const token = created.body.data.token as string;
    const anonymous = await request(app).get(`/api/v1/share/${token}`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data.observations).toHaveLength(1);
    expect(anonymous.body.data.owner.displayName).toBe("测试观察者");

    const links = await user.agent.get(`/api/v1/sites/${site.id}/share-links`).set(auth(user.accessToken));
    expect(links.body.data[0].viewCount).toBe(1);

    await user.agent.delete(`/api/v1/share-links/${created.body.data.id}`).set(auth(user.accessToken)).expect(200);
    const revoked = await request(app).get(`/api/v1/share/${token}`);
    expect(revoked.status).toBe(404);
  });
});
