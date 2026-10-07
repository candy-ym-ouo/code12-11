import { beforeEach, describe, expect, it } from "vitest";
import { app, auth, createSite, createSpeciesWithPhase, makeJpeg, registerUser, resetDatabase } from "./helpers/db";

async function createObservation(user: Awaited<ReturnType<typeof registerUser>>) {
  const site = await createSite(user.id, "照片测试点");
  const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);
  const response = await user.agent.post("/api/v1/observations").set(auth(user.accessToken)).send({
    siteId: site.id,
    speciesId,
    phenophaseId,
    kind: "PLANT_PHENOLOGY",
    observationDate: "2025-03-12",
  });
  return response.body.data.id as string;
}

describe("照片上传", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("上传两张合法图片后可以访问缩略图", async () => {
    const user = await registerUser();
    const observationId = await createObservation(user);
    const jpeg = await makeJpeg();

    const response = await user.agent
      .post(`/api/v1/observations/${observationId}/photos`)
      .set(auth(user.accessToken))
      .attach("files", jpeg, "bud-1.jpg")
      .attach("files", jpeg, "bud-2.jpg");

    expect(response.status).toBe(201);
    expect(response.body.data.succeeded).toHaveLength(2);
    expect(response.body.data.failed).toHaveLength(0);

    const thumbUrl = response.body.data.succeeded[0].thumbUrl as string;
    const image = await import("supertest").then(({ default: request }) => request(app).get(thumbUrl));
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toContain("image/webp");
    expect(Number(image.headers["content-length"])).toBeGreaterThan(0);
  });

  it("非图片类型返回 415", async () => {
    const user = await registerUser();
    const observationId = await createObservation(user);

    const response = await user.agent
      .post(`/api/v1/observations/${observationId}/photos`)
      .set(auth(user.accessToken))
      .attach("files", Buffer.from("这不是图片"), { filename: "fake.jpg", contentType: "text/plain" });

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("无法解码的图片进入 failed 列表且不阻断其他文件", async () => {
    const user = await registerUser();
    const observationId = await createObservation(user);
    const jpeg = await makeJpeg(320, 240);

    const response = await user.agent
      .post(`/api/v1/observations/${observationId}/photos`)
      .set(auth(user.accessToken))
      .attach("files", jpeg, "good.jpg")
      .attach("files", Buffer.from("broken-content"), { filename: "broken.jpg", contentType: "image/jpeg" });

    expect(response.status).toBe(201);
    expect(response.body.data.succeeded).toHaveLength(1);
    expect(response.body.data.failed).toHaveLength(1);
    expect(response.body.data.failed[0].originalName).toBe("broken.jpg");
  });

  it("超过大小限制返回 413", async () => {
    const user = await registerUser();
    const observationId = await createObservation(user);
    const big = Buffer.alloc(11 * 1024 * 1024, 1);

    const response = await user.agent
      .post(`/api/v1/observations/${observationId}/photos`)
      .set(auth(user.accessToken))
      .attach("files", big, { filename: "big.jpg", contentType: "image/jpeg" });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("删除照片后文件不可访问", async () => {
    const user = await registerUser();
    const observationId = await createObservation(user);
    const jpeg = await makeJpeg(400, 300);

    const upload = await user.agent
      .post(`/api/v1/observations/${observationId}/photos`)
      .set(auth(user.accessToken))
      .attach("files", jpeg, "to-delete.jpg");

    const photoId = upload.body.data.succeeded[0].id as string;
    const thumbUrl = upload.body.data.succeeded[0].thumbUrl as string;

    await user.agent.delete(`/api/v1/photos/${photoId}`).set(auth(user.accessToken)).expect(200);

    const { default: request } = await import("supertest");
    const afterDelete = await request(app).get(thumbUrl);
    expect(afterDelete.status).toBe(404);
  });
});
