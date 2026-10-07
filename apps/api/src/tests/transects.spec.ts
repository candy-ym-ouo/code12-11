import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { app, auth, registerUser, resetDatabase } from "./helpers/db";

/**
 * 样线调查端到端流程：
 * 建路线 → 定分段 → 分段录入 → 重叠产生冲突 → 复核 → 事后补录替代 → 时间线与导出。
 */
describe("样线调查接口", () => {
  beforeEach(async () => {
    await prisma.transectConflict.deleteMany();
    await prisma.transectEntry.deleteMany();
    await prisma.transectSegment.deleteMany();
    await prisma.transect.deleteMany();
    await resetDatabase();
  });

  async function createTransect(token: string, name = "环湖步道样线") {
    const res = await request(app).post("/api/v1/transects").set(auth(token)).send({ name, code: "T01" });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; name: string; lengthM: number };
  }

  async function defineSegments(token: string, transectId: string) {
    const res = await request(app)
      .put(`/api/v1/transects/${transectId}/segments`)
      .set(auth(token))
      .send({
        segments: [
          { orderIndex: 0, startM: 0, endM: 300, name: "林缘段", habitat: "阔叶林" },
          { orderIndex: 1, startM: 300, endM: 700, name: "滩涂段", habitat: "湿地" },
          { orderIndex: 2, startM: 700, endM: 1000, name: "灌丛段", habitat: "灌丛" },
        ],
      });
    expect(res.status).toBe(200);
    return res.body.data as { id: string; name: string }[];
  }

  it("完整流程：建路线、定分段、分段录入并在时间线上按段汇总", async () => {
    const user = await registerUser();
    const transect = await createTransect(user.accessToken);
    const segments = await defineSegments(user.accessToken, transect.id);
    expect(segments).toHaveLength(3);

    // 在林缘段与滩涂段各录一条
    const e1 = await request(app)
      .post(`/api/v1/transects/${transect.id}/entries`)
      .set(auth(user.accessToken))
      .send({
        speciesName: "白头鹎",
        startM: 0,
        endM: 300,
        count: 5,
        startAt: "2026-10-07T08:00:00+08:00",
      });
    expect(e1.status).toBe(201);
    expect(e1.body.data.segmentName).toBe("林缘段");

    const e2 = await request(app)
      .post(`/api/v1/transects/${transect.id}/entries`)
      .set(auth(user.accessToken))
      .send({
        speciesName: "白头鹎",
        startM: 300,
        endM: 700,
        count: 3,
        startAt: "2026-10-07T08:20:00+08:00",
      });
    expect(e2.status).toBe(201);
    expect(e2.body.data.segmentName).toBe("滩涂段");

    const timeline = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline`)
      .set(auth(user.accessToken));
    expect(timeline.status).toBe(200);
    expect(timeline.body.data.slices).toHaveLength(2);
    expect(timeline.body.data.summary.totalResolved).toBe(8);
    expect(timeline.body.data.summary.pendingSlices).toBe(0);
    expect(timeline.body.data.transect.lengthM).toBe(1000);
  });

  it("分段重叠录入产生 PENDING 冲突；复核 KEEP_A 后时间线口径更新", async () => {
    const user = await registerUser();
    const transect = await createTransect(user.accessToken);
    await defineSegments(user.accessToken, transect.id);

    // 两位观察者在同一时间窗（8:00–8:10）内记录了里程上重叠的两群麻雀
    await request(app)
      .post(`/api/v1/transects/${transect.id}/entries`)
      .set(auth(user.accessToken))
      .send({
        speciesName: "麻雀",
        startM: 0,
        endM: 400,
        count: 8,
        startAt: "2026-10-07T08:00:00+08:00",
        endAt: "2026-10-07T08:10:00+08:00",
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/transects/${transect.id}/entries`)
      .set(auth(user.accessToken))
      .send({
        speciesName: "麻雀",
        startM: 200,
        endM: 600,
        count: 8,
        startAt: "2026-10-07T08:00:00+08:00",
        endAt: "2026-10-07T08:10:00+08:00",
      })
      .expect(201);

    const conflicts = await request(app)
      .get("/api/v1/transect-conflicts?status=PENDING")
      .set(auth(user.accessToken));
    expect(conflicts.status).toBe(200);
    expect(conflicts.body.data).toHaveLength(1);
    const conflict = conflicts.body.data[0];
    expect(conflict.speciesName).toBe("麻雀");
    expect(conflict.startM).toBe(200);
    expect(conflict.endM).toBe(400);
    expect(conflict.entryA).toBeTruthy();
    expect(conflict.entryB).toBeTruthy();

    // 时间线重叠片段标记 pending；原始合计守恒
    const before = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline`)
      .set(auth(user.accessToken));
    const pendingSlices = before.body.data.slices.filter((s: { pending: boolean }) => s.pending);
    expect(pendingSlices.length).toBeGreaterThan(0);

    // 复核：确认是两批不同的鸟 → 求和（默认合计），pending 解除
    await request(app)
      .patch(`/api/v1/transect-conflicts/${conflict.id}`)
      .set(auth(user.accessToken))
      .send({ resolution: "SUM", note: "不同鸟群" })
      .expect(200);

    const after = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline`)
      .set(auth(user.accessToken));
    expect(after.body.data.slices.every((s: { pending: boolean }) => !s.pending)).toBe(true);
    expect(after.body.data.summary.totalResolved).toBe(16);
  });

  it("DUPLICATE 复核：同一批鸟被两人重复记录时不重复计数", async () => {
    const user = await registerUser();
    const transect = await createTransect(user.accessToken);
    await defineSegments(user.accessToken, transect.id);

    const t = "2026-10-07T08:00:00+08:00";
    await request(app).post(`/api/v1/transects/${transect.id}/entries`).set(auth(user.accessToken))
      .send({ speciesName: "雉鸡", startM: 100, endM: 500, count: 4, startAt: t }).expect(201);
    await request(app).post(`/api/v1/transects/${transect.id}/entries`).set(auth(user.accessToken))
      .send({ speciesName: "雉鸡", startM: 100, endM: 500, count: 4, startAt: t }).expect(201);

    const conflicts = await request(app).get("/api/v1/transect-conflicts").set(auth(user.accessToken));
    expect(conflicts.body.data).toHaveLength(1);

    await request(app)
      .patch(`/api/v1/transect-conflicts/${conflicts.body.data[0].id}`)
      .set(auth(user.accessToken))
      .send({ resolution: "DUPLICATE", note: "同一群" })
      .expect(200);

    const timeline = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline`)
      .set(auth(user.accessToken));
    expect(timeline.body.data.summary.totalResolved).toBe(4);
    expect(timeline.body.data.summary.totalRaw).toBe(8);
  });

  it("事后补录替代既有录入：新记录按观测时刻对齐，旧记录移除，冲突重算", async () => {
    const user = await registerUser();
    const transect = await createTransect(user.accessToken);
    await defineSegments(user.accessToken, transect.id);

    const original = await request(app)
      .post(`/api/v1/transects/${transect.id}/entries`)
      .set(auth(user.accessToken))
      .send({ speciesName: "黄鼬", startM: 0, endM: 300, count: 1, startAt: "2026-10-07T08:00:00+08:00" })
      .expect(201);

    // 晚上发现当时把数量记少了，补录修正（标记 BACKFILL 并替代旧录入）
    const replaced = await request(app)
      .post(`/api/v1/transects/${transect.id}/entries/${original.body.data.id}/replace`)
      .set(auth(user.accessToken))
      .send({
        speciesName: "黄鼬",
        startM: 0,
        endM: 300,
        count: 2,
        startAt: "2026-10-07T08:00:00+08:00",
        notes: "复核照片实为两只",
      })
      .expect(201);
    expect(replaced.body.data.source).toBe("BACKFILL");
    expect(replaced.body.data.supersedesEntryId).toBe(original.body.data.id);

    const entries = await request(app)
      .get(`/api/v1/transects/${transect.id}/entries`)
      .set(auth(user.accessToken));
    expect(entries.body.data).toHaveLength(1);
    expect(entries.body.data[0].count).toBe(2);

    const timeline = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline`)
      .set(auth(user.accessToken));
    expect(timeline.body.data.summary.totalResolved).toBe(2);
    expect(timeline.body.data.slices[0].source).toBe("BACKFILL");

    const pending = await request(app).get("/api/v1/transect-conflicts").set(auth(user.accessToken));
    expect(pending.body.data).toHaveLength(0);
  });

  it("分段校验：序号不连续、里程不衔接、录入越界缩短均被拒绝", async () => {
    const user = await registerUser();
    const transect = await createTransect(user.accessToken);

    const badIndex = await request(app)
      .put(`/api/v1/transects/${transect.id}/segments`)
      .set(auth(user.accessToken))
      .send({ segments: [{ orderIndex: 1, startM: 0, endM: 100, name: "段" }] });
    expect(badIndex.status).toBe(400);

    const gap = await request(app)
      .put(`/api/v1/transects/${transect.id}/segments`)
      .set(auth(user.accessToken))
      .send({
        segments: [
          { orderIndex: 0, startM: 0, endM: 100, name: "A" },
          { orderIndex: 1, startM: 150, endM: 200, name: "B" },
        ],
      });
    expect(gap.status).toBe(400);

    await request(app)
      .put(`/api/v1/transects/${transect.id}/segments`)
      .set(auth(user.accessToken))
      .send({
        segments: [
          { orderIndex: 0, startM: 0, endM: 300, name: "A" },
          { orderIndex: 1, startM: 300, endM: 500, name: "B" },
        ],
      })
      .expect(200);

    await request(app)
      .post(`/api/v1/transects/${transect.id}/entries`)
      .set(auth(user.accessToken))
      .send({ speciesName: "鹿", startM: 0, endM: 500, count: 1, startAt: "2026-10-07T08:00:00+08:00" })
      .expect(201);

    // 缩短到 400m 会让既有录入越界 → 409
    const shorten = await request(app)
      .put(`/api/v1/transects/${transect.id}/segments`)
      .set(auth(user.accessToken))
      .send({ segments: [{ orderIndex: 0, startM: 0, endM: 400, name: "A" }] });
    expect(shorten.status).toBe(409);
    expect(shorten.body.error.details.count).toBe(1);
  });

  it("时间线与原始录入可分别查询，支持按物种/分段过滤", async () => {
    const user = await registerUser();
    const transect = await createTransect(user.accessToken);
    const segments = await defineSegments(user.accessToken, transect.id);

    for (const [species, segIdx, count] of [
      ["麻雀", 0, 3],
      ["燕子", 1, 2],
      ["麻雀", 2, 4],
    ] as const) {
      const seg = segments[segIdx];
      await request(app)
        .post(`/api/v1/transects/${transect.id}/entries`)
        .set(auth(user.accessToken))
        .send({
          speciesName: species,
          segmentId: seg.id,
          startM: segIdx === 0 ? 0 : segIdx === 1 ? 300 : 700,
          endM: segIdx === 0 ? 300 : segIdx === 1 ? 700 : 1000,
          count,
          startAt: "2026-10-07T08:00:00+08:00",
        })
        .expect(201);
    }

    const bySpecies = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline?speciesName=${encodeURIComponent("麻雀")}`)
      .set(auth(user.accessToken));
    expect(bySpecies.body.data.slices).toHaveLength(2);
    expect(bySpecies.body.data.summary.totalResolved).toBe(7);

    const bySegment = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline?segmentId=${segments[1].id}`)
      .set(auth(user.accessToken));
    expect(bySegment.body.data.slices).toHaveLength(1);
    expect(bySegment.body.data.slices[0].speciesName).toBe("燕子");
  });

  it("导出 CSV 与 GeoJSON，且访问他人样线返回 404", async () => {
    const alice = await registerUser();
    const transect = await createTransect(alice.accessToken);
    await request(app)
      .put(`/api/v1/transects/${transect.id}/segments`)
      .set(auth(alice.accessToken))
      .send({
        segments: [
          {
            orderIndex: 0,
            startM: 0,
            endM: 200,
            name: "样线段",
            geometry: [
              [116.3, 39.9],
              [116.302, 39.901],
            ],
          },
        ],
      })
      .expect(200);
    await request(app)
      .post(`/api/v1/transects/${transect.id}/entries`)
      .set(auth(alice.accessToken))
      .send({ speciesName: "白鹭", startM: 0, endM: 200, count: 6, startAt: "2026-10-07T08:00:00+08:00" })
      .expect(201);

    const csv = await request(app)
      .get(`/api/v1/transects/${transect.id}/export?format=csv`)
      .set(auth(alice.accessToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("白鹭");
    expect(csv.text).toContain("样线段");

    const geo = await request(app)
      .get(`/api/v1/transects/${transect.id}/export?format=geojson`)
      .set(auth(alice.accessToken));
    expect(geo.status).toBe(200);
    expect(geo.headers["content-type"]).toContain("geo+json");
    const payload = JSON.parse(geo.text);
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features.some((f: { properties: { kind: string } }) => f.properties.kind === "segment")).toBe(true);
    expect(payload.features.some((f: { properties: { kind: string } }) => f.properties.kind === "sighting")).toBe(true);

    const bob = await registerUser();
    const forbidden = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline`)
      .set(auth(bob.accessToken));
    expect(forbidden.status).toBe(404);
  });

  it("删除录入后关联冲突自动消失；修改录入后重叠关系重算", async () => {
    const user = await registerUser();
    const transect = await createTransect(user.accessToken);
    await defineSegments(user.accessToken, transect.id);

    const t = "2026-10-07T08:00:00+08:00";
    const a = await request(app).post(`/api/v1/transects/${transect.id}/entries`).set(auth(user.accessToken))
      .send({ speciesName: "野兔", startM: 0, endM: 400, count: 2, startAt: t });
    const b = await request(app).post(`/api/v1/transects/${transect.id}/entries`).set(auth(user.accessToken))
      .send({ speciesName: "野兔", startM: 100, endM: 500, count: 2, startAt: t });
    expect((await request(app).get("/api/v1/transect-conflicts").set(auth(user.accessToken))).body.data).toHaveLength(1);

    // 把 b 改到不重叠的里程 → 冲突自动消失
    await request(app)
      .patch(`/api/v1/transects/${transect.id}/entries/${b.body.data.id}`)
      .set(auth(user.accessToken))
      .send({
        speciesName: "野兔",
        startM: 700,
        endM: 900,
        count: 2,
        startAt: t,
        endAt: t,
        source: "MANUAL",
      })
      .expect(200);
    expect((await request(app).get("/api/v1/transect-conflicts").set(auth(user.accessToken))).body.data).toHaveLength(0);

    // 删除 a
    await request(app)
      .delete(`/api/v1/transects/${transect.id}/entries/${a.body.data.id}`)
      .set(auth(user.accessToken))
      .expect(200);
    const timeline = await request(app)
      .get(`/api/v1/transects/${transect.id}/timeline`)
      .set(auth(user.accessToken));
    expect(timeline.body.data.summary.totalResolved).toBe(2);
  });
});
