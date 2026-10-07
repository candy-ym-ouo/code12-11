import { beforeEach, describe, expect, it } from "vitest";
import { createSite, createSpeciesWithPhase, registerUser, resetDatabase } from "./helpers/db";

describe("数据导出", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seedOneObservation() {
    const user = await registerUser();
    const site = await createSite(user.id, "导出测试点");
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id, { commonName: "玉兰", phaseName: "始花" });

    await user.agent.post("/api/v1/observations").set("Authorization", `Bearer ${user.accessToken}`).send({
      siteId: site.id,
      speciesId,
      phenophaseId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
      notes: "含逗号, 与换行\n的描述",
    });
    return user;
  }

  it("CSV 导出带 BOM 且正确转义", async () => {
    const user = await seedOneObservation();
    const response = await user.agent
      .get("/api/v1/export/observations?format=csv")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment");

    const text = (response.body as Buffer).toString("utf8");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("observationDate");
    expect(text).toContain("2025-03-12");
    expect(text).toContain("玉兰");
    expect(text).toContain('"含逗号, 与换行\n的描述"');
  });

  it("JSON 导出包含结构化字段", async () => {
    const user = await seedOneObservation();
    const response = await user.agent
      .get("/api/v1/export/observations?format=json")
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1);
    expect(response.body.data[0].site).toBe("导出测试点");
    expect(response.body.data[0].phenophase).toBe("始花");
  });
});
