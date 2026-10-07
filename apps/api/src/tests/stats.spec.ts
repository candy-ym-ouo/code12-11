import { beforeEach, describe, expect, it } from "vitest";
import { createSite, createSpeciesWithPhase, registerUser, resetDatabase } from "./helpers/db";

describe("对比与统计接口", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function createCrossYearData() {
    const user = await registerUser();
    const site = await createSite(user.id, "校园银杏道");
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id, { commonName: "银杏", phaseName: "发芽" });

    for (const date of ["2023-03-20", "2024-03-18", "2025-03-12"]) {
      await user.agent.post("/api/v1/observations").set("Authorization", `Bearer ${user.accessToken}`).send({
        siteId: site.id,
        speciesId,
        phenophaseId,
        kind: "PLANT_PHENOLOGY",
        observationDate: date,
        notes: `${date} 发芽记录`,
      });
    }

    return { user, site, speciesId, phenophaseId };
  }

  it("对比接口输出逐年首现日与偏移", async () => {
    const { user, site, speciesId, phenophaseId } = await createCrossYearData();

    const response = await user.agent
      .get(`/api/v1/stats/compare?siteId=${site.id}&speciesId=${speciesId}&phenophaseId=${phenophaseId}&years=2024,2025`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    const [y2024, y2025] = response.body.data.years;
    expect(y2024.onsetDate).toBe("2024-03-18");
    expect(y2024.dayOfYear).toBe(77);
    expect(y2025.onsetDate).toBe("2025-03-12");
    expect(y2025.dayOfYear).toBe(71);
    expect(y2025.offsetVsPrevYear).toBe(-6);
    expect(y2025.offsetText).toBe("提前 6 天");
  });

  it("缺少年份时在 missingYears 中返回", async () => {
    const { user, site, speciesId, phenophaseId } = await createCrossYearData();

    const response = await user.agent
      .get(`/api/v1/stats/compare?siteId=${site.id}&speciesId=${speciesId}&phenophaseId=${phenophaseId}&years=2022,2024,2025`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.body.data.missingYears).toEqual([2022]);
    expect(response.body.data.years[0].onsetDate).toBeNull();
    expect(response.body.data.years[0].dayOfYear).toBeNull();
  });

  it("只有一年数据时不计算基准", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);

    await user.agent.post("/api/v1/observations").set("Authorization", `Bearer ${user.accessToken}`).send({
      siteId: site.id,
      speciesId,
      phenophaseId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
    });

    const response = await user.agent
      .get(`/api/v1/stats/phenology?siteId=${site.id}&speciesId=${speciesId}`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.baseline).toBeNull();
    expect(response.body.data.reason).toBe("INSUFFICIENT_HISTORY");
  });

  it("统计概览返回总量与类型分布", async () => {
    const { user, site } = await createCrossYearData();
    const response = await user.agent
      .get(`/api/v1/stats/overview?siteId=${site.id}`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.published).toBe(3);
    expect(response.body.data.firstObservationDate).toBe("2023-03-20");
    expect(response.body.data.lastObservationDate).toBe("2025-03-12");
  });

  it("天气历史样本不足时标记 insufficientBaseline", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);

    await user.agent.post("/api/v1/observations").set("Authorization", `Bearer ${user.accessToken}`).send({
      siteId: site.id,
      kind: "WEATHER_ANOMALY",
      observationDate: "2025-04-09",
      temperatureC: 1.2,
      anomalyType: "LATE_FROST",
      anomalySeverity: "MODERATE",
    });

    const response = await user.agent
      .get(`/api/v1/stats/weather?siteId=${site.id}&monthDay=04-09&windowDays=7`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.baseline.insufficientBaseline).toBe(true);
    expect(response.body.data.current).toHaveLength(1);
    expect(response.body.data.current[0].temperatureC).toBe(1.2);
  });
});
