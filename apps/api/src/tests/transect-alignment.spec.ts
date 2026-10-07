import { describe, expect, it } from "vitest";
import {
  type AlignmentEntry,
  type ConflictResolution,
  M_EPS,
  TIME_EPS_MS,
  apportionInteger,
  buildTimeline,
  detectOverlaps,
  summarizeTimeline,
  validateRange,
} from "../modules/transects/alignment";

let seq = 0;
function makeEntry(overrides: Partial<AlignmentEntry> & { speciesName: string }): AlignmentEntry {
  seq += 1;
  const now = Date.parse("2026-10-07T08:00:00.000Z") + seq * 1000;
  return {
    id: `e${seq}`,
    speciesId: null,
    category: null,
    startAt: now,
    endAt: now,
    startM: 0,
    endM: 100,
    count: 1,
    source: "MANUAL",
    observer: null,
    notes: null,
    segmentId: null,
    observedAt: now,
    recordedAt: now,
    createdAt: now,
    ...overrides,
  };
}

describe("最大余数法分摊", () => {
  it("分摊之和恒等于总数", () => {
    for (const total of [0, 1, 3, 7, 10, 100]) {
      const weights = [1, 2, 3, 0];
      const parts = apportionInteger(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("按权重比例分配整数（10 只按 1:1:3 长度切分）", () => {
    const parts = apportionInteger(10, [10, 10, 30]);
    expect(parts).toEqual([2, 2, 6]);
  });

  it("权重全零时均匀分摊", () => {
    const parts = apportionInteger(7, [0, 0]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(7);
    expect(Math.abs(parts[0] - parts[1])).toBeLessThanOrEqual(1);
  });
});

describe("基础切分与时间线", () => {
  it("同一时段沿里程记录两个不重叠物种 → 各得一片段，数量守恒", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const slices = buildTimeline([
      makeEntry({ speciesName: "麻雀", startM: 0, endM: 50, count: 3, startAt: t, endAt: t }),
      makeEntry({ speciesName: "白头鹎", startM: 50, endM: 100, count: 2, startAt: t, endAt: t }),
    ]);
    expect(slices).toHaveLength(2);
    expect(slices.map((s) => s.totalResolved).sort()).toEqual([2, 3]);
  });

  it("同物种里程不重叠的两段录入保持两个片段，不产生冲突", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const slices = buildTimeline([
      makeEntry({ speciesName: "麻雀", startM: 0, endM: 50, count: 3, startAt: t, endAt: t }),
      makeEntry({ speciesName: "麻雀", startM: 50, endM: 100, count: 2, startAt: t, endAt: t }),
    ]);
    expect(slices).toHaveLength(2);
    expect(slices.every((s) => !s.pending)).toBe(true);
  });

  it("分段边界被纳入切分，片段中点可映射回唯一段", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const entry = makeEntry({ speciesName: "麻雀", startM: 0, endM: 100, count: 10, startAt: t, endAt: t });
    const slices = buildTimeline(
      [entry],
      [],
      [
        { id: "s0", orderIndex: 0, startM: 0, endM: 40 },
        { id: "s1", orderIndex: 1, startM: 40, endM: 100 },
      ],
    );
    expect(slices).toHaveLength(2);
    expect(slices.find((s) => s.segmentId === "s0")?.totalResolved).toBe(4);
    expect(slices.find((s) => s.segmentId === "s1")?.totalResolved).toBe(6);
    expect(slices.reduce((sum, s) => sum + s.totalResolved, 0)).toBe(10);
  });

  it("时间维度也参与切分：同里程不同时段形成先后两个片段", () => {
    const slices = buildTimeline([
      makeEntry({
        speciesName: "麻雀",
        startM: 0,
        endM: 100,
        count: 4,
        startAt: Date.parse("2026-10-07T08:00:00Z"),
        endAt: Date.parse("2026-10-07T08:10:00Z"),
      }),
      makeEntry({
        speciesName: "麻雀",
        startM: 0,
        endM: 100,
        count: 6,
        startAt: Date.parse("2026-10-07T09:00:00Z"),
        endAt: Date.parse("2026-10-07T09:10:00Z"),
      }),
    ]);
    expect(slices).toHaveLength(2);
    expect(slices[0].startAt).toBe(Date.parse("2026-10-07T08:00:00Z"));
  });

  it("瞬时记录坍缩为时间点，不产生时间跨度", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const slices = buildTimeline([makeEntry({ speciesName: "雉鸡", startM: 10, endM: 10, count: 1, startAt: t, endAt: t })]);
    expect(slices[0].startAt).toBe(t);
    expect(slices[0].endAt).toBe(t);
    expect(slices[0].startM).toBe(10);
    expect(slices[0].endM).toBe(10);
  });
});

describe("重叠检测与冲突", () => {
  it("同物种「里程 × 时间」相交 → PENDING 片段，原始合计保留", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const a = makeEntry({ id: "a", speciesName: "麻雀", startM: 0, endM: 60, count: 5, startAt: t, endAt: t, recordedAt: t });
    const b = makeEntry({ id: "b", speciesName: "麻雀", startM: 40, endM: 100, count: 7, startAt: t, endAt: t, recordedAt: t + 1000 });
    const overlaps = detectOverlaps([a, b]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ entryAId: "a", entryBId: "b", startM: 40, endM: 60 });

    const slices = buildTimeline([a, b]);
    const overlapSlice = slices.find((s) => s.startM === 40 && s.endM === 60);
    expect(overlapSlice?.pending).toBe(true);
    // 未复核前合计为两者分摊之和，总量守恒，由复核决定口径
    expect(slices.reduce((sum, s) => sum + s.totalRaw, 0)).toBe(12);
  });

  it("不同物种同区域不冲突", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const slices = buildTimeline([
      makeEntry({ speciesName: "麻雀", startM: 0, endM: 100, count: 5, startAt: t, endAt: t }),
      makeEntry({ speciesName: "燕子", startM: 0, endM: 100, count: 2, startAt: t, endAt: t }),
    ]);
    expect(slices.every((s) => !s.pending)).toBe(true);
  });

  it("时点相遇（同里程同时刻）也被识别为重叠", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const overlaps = detectOverlaps([
      makeEntry({ id: "x", speciesName: "麻雀", startM: 30, endM: 30, count: 1, startAt: t, endAt: t }),
      makeEntry({ id: "y", speciesName: "麻雀", startM: 30, endM: 30, count: 1, startAt: t, endAt: t, recordedAt: t + 500 }),
    ]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].endM - overlaps[0].startM).toBeLessThanOrEqual(M_EPS * 1.5);
    expect(overlaps[0].endAt - overlaps[0].startAt).toBeLessThanOrEqual(TIME_EPS_MS * 1.5);
  });
});

describe("复核决定影响时间线口径", () => {
  function setup() {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const a = makeEntry({ id: "a", speciesName: "麻雀", startM: 0, endM: 80, count: 8, startAt: t, endAt: t, recordedAt: t });
    const b = makeEntry({ id: "b", speciesName: "麻雀", startM: 20, endM: 100, count: 8, startAt: t, endAt: t, recordedAt: t + 1000 });
    return { t, a, b };
  }

  function overlapTotal(slices: ReturnType<typeof buildTimeline>) {
    return slices.find((s) => s.startM === 20 && s.endM === 80)!;
  }

  it("SUM：重叠区合计 = A + B 的分摊", () => {
    const { a, b } = setup();
    const slices = buildTimeline([a, b], [{ id: "c1", entryAId: "a", entryBId: "b", resolution: "SUM" }]);
    const slice = overlapTotal(slices);
    expect(slice.pending).toBe(false);
    expect(slice.totalResolved).toBe(slice.totalRaw);
  });

  it("KEEP_A：重叠区只保留 A 的分摊", () => {
    const { a, b } = setup();
    const slices = buildTimeline([a, b], [{ id: "c1", entryAId: "a", entryBId: "b", resolution: "KEEP_A" }]);
    const slice = overlapTotal(slices);
    const shareA = slice.shares.find((s) => s.entryId === "a")!.count;
    expect(slice.totalResolved).toBe(shareA);
  });

  it("KEEP_B：重叠区只保留 B 的分摊", () => {
    const { a, b } = setup();
    const slices = buildTimeline([a, b], [{ id: "c1", entryAId: "a", entryBId: "b", resolution: "KEEP_B" }]);
    const slice = overlapTotal(slices);
    const shareB = slice.shares.find((s) => s.entryId === "b")!.count;
    expect(slice.totalResolved).toBe(shareB);
  });

  it("DUPLICATE：数量相等时保留先录入者", () => {
    const { a, b } = setup();
    const slices = buildTimeline([a, b], [{ id: "c1", entryAId: "a", entryBId: "b", resolution: "DUPLICATE" }]);
    const slice = overlapTotal(slices);
    const shareA = slice.shares.find((s) => s.entryId === "a")!.count;
    expect(slice.totalResolved).toBe(shareA);
  });

  it("全局守恒：任意决定下，按决定口径把片段数量相加等于各录入在保留区域的分摊", () => {
    const { a, b } = setup();
    for (const resolution of ["KEEP_A", "KEEP_B", "SUM", "DUPLICATE", "PENDING"] as ConflictResolution[]) {
      const slices = buildTimeline(
        [a, b],
        resolution === "PENDING" ? [] : [{ id: "c1", entryAId: "a", entryBId: "b", resolution }],
      );
      const sum = slices.reduce((x, s) => x + s.totalResolved, 0);
      expect(Number.isFinite(sum)).toBe(true);
      if (resolution === "SUM" || resolution === "PENDING") {
        expect(sum).toBe(16);
      } else if (resolution === "KEEP_A") {
        // A 覆盖 [0,80) 的 8 只全部保留；B 独占 [80,100) 的 2 只仍然计数
        expect(sum).toBe(10);
      } else if (resolution === "KEEP_B") {
        // B 覆盖 [20,100) 的 8 只全部保留；A 独占 [0,20) 的 2 只仍然计数
        expect(sum).toBe(10);
      } else if (resolution === "DUPLICATE") {
        // 重叠区保留较大分摊，独占区各自保留 → 总数介于单条与合计之间
        expect(sum).toBeGreaterThanOrEqual(8);
        expect(sum).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe("事后补录与既有结果对齐", () => {
  it("补录（BACKFILL）按观测时间落入既有时间线位置，并被标记为补录", () => {
    const t0 = Date.parse("2026-10-07T08:00:00Z");
    const t1 = Date.parse("2026-10-07T08:30:00Z");
    // 现场先录了 8:00 的一条；当晚补录 8:30 实际看到的另一只（同一路段）
    const slices = buildTimeline([
      makeEntry({ id: "live", speciesName: "黄鼬", startM: 0, endM: 100, count: 1, startAt: t0, endAt: t0, recordedAt: t0 }),
      makeEntry({
        id: "back",
        speciesName: "黄鼬",
        startM: 0,
        endM: 100,
        count: 1,
        startAt: t1,
        endAt: t1,
        recordedAt: Date.parse("2026-10-07T20:00:00Z"),
        source: "BACKFILL",
      }),
    ]);
    expect(slices).toHaveLength(2);
    expect(slices[0].startAt).toBe(t0);
    expect(slices[1].startAt).toBe(t1);
    expect(slices[1].source).toBe("BACKFILL");
  });

  it("补录与既有录入在同一「里程 × 时间」盒内相交时产生冲突", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const overlaps = detectOverlaps([
      makeEntry({ id: "live", speciesName: "野兔", startM: 0, endM: 100, count: 2, startAt: t, endAt: t, recordedAt: t }),
      makeEntry({
        id: "back",
        speciesName: "野兔",
        startM: 20,
        endM: 80,
        count: 2,
        startAt: t,
        endAt: t,
        recordedAt: Date.parse("2026-10-07T21:00:00Z"),
        source: "BACKFILL",
      }),
    ]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ entryAId: "live", entryBId: "back", startM: 20, endM: 80 });
  });
});

describe("汇总与校验", () => {
  it("summarizeTimeline 按物种/分段汇总", () => {
    const t = Date.parse("2026-10-07T08:00:00Z");
    const segmentRanges = [
      { id: "s0", orderIndex: 0, startM: 0, endM: 40 },
      { id: "s1", orderIndex: 1, startM: 40, endM: 100 },
    ];
    const slices = buildTimeline(
      [
        makeEntry({ speciesName: "麻雀", startM: 0, endM: 40, count: 2, startAt: t, endAt: t }),
        makeEntry({ speciesName: "燕子", startM: 40, endM: 100, count: 5, startAt: t, endAt: t }),
      ],
      [],
      segmentRanges,
    );
    const summary = summarizeTimeline(slices);
    expect(summary.totalResolved).toBe(7);
    expect(summary.bySegment).toHaveLength(2);
    expect(summary.bySpecies.find((s) => s.speciesName === "燕子")?.totalResolved).toBe(5);
  });

  it("validateRange 拒绝越界与反向区间", () => {
    expect(() => validateRange(10, 5, 100)).toThrow(/上界/);
    expect(() => validateRange(-1, 10, 100)).toThrow(/负/);
    expect(() => validateRange(0, 101, 100)).toThrow(/超出/);
    expect(() => validateRange(0, 100, 100)).not.toThrow();
  });
});
