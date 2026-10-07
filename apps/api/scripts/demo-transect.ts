/**
 * 样线调查演示脚本（开发环境）：
 *   tsx scripts/demo-transect.ts
 *
 * 走完整业务流：建路线 → 定分段 → 分段录入 → 制造重叠冲突 → 复核 → 事后补录 → 打印时间线。
 * 复用 src/modules/transects/service，与 API 行为完全一致。
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import * as service from "../src/modules/transects/service";

async function main() {
  // 1. 确保演示用户存在
  const passwordHash = await bcrypt.hash("Nature#2025", 10);
  const user = await prisma.user.upsert({
    where: { email: "demo@nature.local" },
    update: {},
    create: { email: "demo@nature.local", passwordHash, displayName: "演示观察者" },
  });

  // 2. 建路线（重复执行时复用）
  let transect = await prisma.transect.findFirst({ where: { ownerId: user.id, name: "环湖步道样线（演示）" } });
  if (transect) {
    await prisma.transectConflict.deleteMany({ where: { transectId: transect.id } });
    await prisma.transectEntry.deleteMany({ where: { transectId: transect.id } });
    await prisma.transectSegment.deleteMany({ where: { transectId: transect.id } });
    await prisma.transect.delete({ where: { id: transect.id } });
  }
  transect = await service.createTransect(user.id, { name: "环湖步道样线（演示）", code: "DEMO-T1" });

  // 3. 定分段：林缘 0–300m、滩涂 300–700m、灌丛 700–1000m
  const segments = await service.replaceSegments(user.id, transect.id, [
    { orderIndex: 0, startM: 0, endM: 300, name: "林缘段", habitat: "阔叶林" },
    { orderIndex: 1, startM: 300, endM: 700, name: "滩涂段", habitat: "滩涂湿地" },
    { orderIndex: 2, startM: 700, endM: 1000, name: "灌丛段", habitat: "山地灌丛" },
  ]);
  console.log(`✔ 分段已定义：${segments.map((s) => `${s.name}(${s.startM}-${s.endM}m)`).join("、")}`);

  // 4. 分段录入
  const day = new Date().toISOString().slice(0, 11);
  await service.createEntry(user.id, transect.id, {
    speciesName: "白头鹎", startM: 0, endM: 300, count: 5,
    startAt: `${day}00:00:00.000Z`, observer: "甲", source: "MANUAL",
  });
  await service.createEntry(user.id, transect.id, {
    speciesName: "白头鹎", startM: 300, endM: 700, count: 3,
    startAt: `${day}00:20:00.000Z`, observer: "甲", source: "MANUAL",
  });
  console.log("✔ 林缘段 5 只、滩涂段 3 只白头鹎已分段录入");

  // 5. 两位观察者在同一时间窗、里程重叠 → 产生 PENDING 冲突
  await service.createEntry(user.id, transect.id, {
    speciesName: "麻雀", startM: 0, endM: 400, count: 8,
    startAt: `${day}01:00:00.000Z`, endAt: `${day}01:10:00.000Z`,
    observer: "甲", source: "MANUAL",
  });
  await service.createEntry(user.id, transect.id, {
    speciesName: "麻雀", startM: 200, endM: 600, count: 8,
    startAt: `${day}01:00:00.000Z`, endAt: `${day}01:10:00.000Z`,
    observer: "乙", source: "MANUAL",
  });
  let pending = await service.listConflicts(user.id, transect.id, "PENDING");
  console.log(`✔ 制造了 ${pending.length} 条重叠冲突：${pending[0].speciesName} ${pending[0].startM}-${pending[0].endM}m`);

  // 6. 复核：两批不同鸟群 → SUM
  await service.resolveConflict(user.id, pending[0].id, { resolution: "SUM", note: "不同鸟群，数量相加" });
  console.log("✔ 冲突已复核为 SUM（求和）");

  // 7. 事后补录修正：黄鼬 1 只 → 实为 2 只
  const entries = await service.listEntries(user.id, transect.id, { speciesName: "白头鹎" });
  console.log("✔ 白头鹎原始录入：", entries.map((e) => `${e.segmentName}=${e.count}`).join("，"));

  const weaselFirst = await service.createEntry(user.id, transect.id, {
    speciesName: "黄鼬", startM: 0, endM: 300, count: 1,
    startAt: `${day}02:00:00.000Z`, observer: "甲", source: "MANUAL",
  });
  await service.backfillEntry(user.id, transect.id, weaselFirst.id, {
    speciesName: "黄鼬", startM: 0, endM: 300, count: 2,
    startAt: `${day}02:00:00.000Z`, observer: "甲", notes: "复核照片实为两只", source: "BACKFILL",
  });
  console.log("✔ 当晚补录：黄鼬 1 只修正为 2 只，旧录入已替代");

  // 8. 输出对齐后的统一时间线
  const timeline = await service.getTimeline(user.id, transect.id, {});
  console.log("\n========== 统一时间线（对齐结果）==========");
  for (const slice of timeline.slices) {
    const flag = slice.pending ? " [待复核]" : "";
    const backfill = slice.source === "BACKFILL" ? " [补录]" : "";
    console.log(
      `${slice.startAt.slice(11, 19)} ${slice.segmentName?.padEnd(4)} ${String(slice.startM).padStart(4)}-${String(slice.endM).padStart(4)}m ` +
        `${slice.speciesName} × ${slice.totalResolved}（原始 ${slice.totalRaw}）${flag}${backfill}`,
    );
  }
  console.log("==========================================");
  console.log(
    `片段 ${timeline.slices.length} 个 · 原始合计 ${timeline.summary.totalRaw} · 复核后合计 ${timeline.summary.totalResolved} · 待复核片段 ${timeline.summary.pendingSlices}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
