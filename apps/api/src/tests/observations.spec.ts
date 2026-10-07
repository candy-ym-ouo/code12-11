import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { createSite, createSpeciesWithPhase, registerUser, resetDatabase } from "./helpers/db";

describe("观测记录接口", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("天气异常缺少类型时返回 400 并指向 anomalyType", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);

    const response = await user.agent
      .post("/api/v1/observations")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ siteId: site.id, kind: "WEATHER_ANOMALY", observationDate: "2025-04-09" });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].path).toBe("anomalyType");
  });

  it("物种类别与观测类型不匹配时返回 400", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const bird = await createSpeciesWithPhase(user.id, { category: "BIRD", commonName: "乌鸫", phaseName: "首次鸣唱" });

    const response = await user.agent
      .post("/api/v1/observations")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({
        siteId: site.id,
        speciesId: bird.speciesId,
        phenophaseId: bird.phenophaseId,
        kind: "PLANT_PHENOLOGY",
        observationDate: "2025-03-12",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].path).toBe("speciesId");
  });

  it("重复观测返回 409，允许重复时可以创建", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);
    const payload = {
      siteId: site.id,
      speciesId,
      phenophaseId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
      notes: "首次记录",
    };

    await user.agent.post("/api/v1/observations").set("Authorization", `Bearer ${user.accessToken}`).send(payload).expect(201);

    const duplicate = await user.agent
      .post("/api/v1/observations")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send(payload);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_OBSERVATION");
    expect(duplicate.body.error.details.existingObservationId).toBeTypeOf("string");

    const forced = await user.agent
      .post("/api/v1/observations")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ ...payload, allowDuplicate: true });
    expect(forced.status).toBe(201);
  });

  it("读取他人观测返回 404", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const site = await createSite(alice.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(alice.id);
    const created = await alice.agent.post("/api/v1/observations").set("Authorization", `Bearer ${alice.accessToken}`).send({
      siteId: site.id,
      speciesId,
      phenophaseId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
    });

    const response = await bob.agent
      .get(`/api/v1/observations/${created.body.data.id}`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    expect(response.status).toBe(404);
  });

  it("游标分页不重复不丢项", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);

    await prisma.observation.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        ownerId: user.id,
        siteId: site.id,
        speciesId,
        phenophaseId,
        kind: "PLANT_PHENOLOGY",
        observationDate: `2025-03-${String(index + 1).padStart(2, "0")}`,
        notes: `第 ${index + 1} 条`,
      })),
    });

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query: string = cursor ? `?limit=10&cursor=${encodeURIComponent(cursor)}` : "?limit=10";
      const response = await user.agent.get(`/api/v1/observations${query}`).set("Authorization", `Bearer ${user.accessToken}`);
      expect(response.status).toBe(200);
      for (const item of response.body.data) seen.add(item.id);
      cursor = response.body.meta.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen.size).toBe(25);
    expect(pages).toBe(3);
  });

  it("草稿不出现在默认列表，发布后出现", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);

    const draft = await user.agent
      .post("/api/v1/observations")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({
        siteId: site.id,
        speciesId,
        phenophaseId,
        kind: "PLANT_PHENOLOGY",
        observationDate: "2025-03-12",
        status: "DRAFT",
      });
    expect(draft.status).toBe(201);

    const publishedList = await user.agent.get("/api/v1/observations").set("Authorization", `Bearer ${user.accessToken}`);
    expect(publishedList.body.data).toHaveLength(0);
    expect(publishedList.body.meta.emptyReason).toBe("NO_DATA");

    const draftList = await user.agent
      .get("/api/v1/observations?status=DRAFT")
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(draftList.body.data).toHaveLength(1);

    await user.agent
      .post(`/api/v1/observations/${draft.body.data.id}/publish`)
      .set("Authorization", `Bearer ${user.accessToken}`)
      .expect(200);

    const afterPublish = await user.agent.get("/api/v1/observations").set("Authorization", `Bearer ${user.accessToken}`);
    expect(afterPublish.body.data).toHaveLength(1);
  });

  it("按地点、类型与年份区间筛选", async () => {
    const user = await registerUser();
    const siteA = await createSite(user.id, "地点 A");
    const siteB = await createSite(user.id, "地点 B");
    const plant = await createSpeciesWithPhase(user.id, { category: "PLANT", commonName: "银杏", phaseName: "发芽" });
    const bird = await createSpeciesWithPhase(user.id, { category: "BIRD", commonName: "乌鸫", phaseName: "首次鸣唱" });

    await prisma.observation.createMany({
      data: [
        {
          ownerId: user.id,
          siteId: siteA.id,
          speciesId: plant.speciesId,
          phenophaseId: plant.phenophaseId,
          kind: "PLANT_PHENOLOGY",
          observationDate: "2024-03-18",
        },
        {
          ownerId: user.id,
          siteId: siteA.id,
          speciesId: plant.speciesId,
          phenophaseId: plant.phenophaseId,
          kind: "PLANT_PHENOLOGY",
          observationDate: "2025-03-12",
        },
        {
          ownerId: user.id,
          siteId: siteB.id,
          speciesId: bird.speciesId,
          phenophaseId: bird.phenophaseId,
          kind: "BIRD_SOUND",
          observationDate: "2025-03-01",
        },
      ],
    });

    const response = await user.agent
      .get(`/api/v1/observations?siteId=${siteA.id}&kind=PLANT_PHENOLOGY&from=2025-01-01&to=2025-12-31`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].observationDate).toBe("2025-03-12");
    expect(response.body.data[0].site.name).toBe("地点 A");
  });
});
