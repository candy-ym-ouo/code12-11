import { z } from "zod";

// ---------- 路线 ----------

export const createTransectSchema = z.object({
  name: z.string().trim().min(1, "请填写路线名称").max(60, "路线名称过长"),
  code: z.string().trim().max(30).nullish(),
  siteId: z.string().min(1).nullish(),
  description: z.string().trim().max(2000).nullish(),
});

export const updateTransectSchema = createTransectSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  "至少需要提供一个待更新字段",
);

export const listTransectsQuerySchema = z.object({
  includeArchived: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
});

// ---------- 分段 ----------

export const segmentInputSchema = z.object({
  id: z.string().min(1).optional(),
  orderIndex: z.number().int().min(0).max(999),
  startM: z.number().min(0).max(1_000_000),
  endM: z.number().min(0).max(1_000_000),
  name: z.string().trim().min(1, "请填写分段名称").max(60),
  habitat: z.string().trim().max(60).nullish(),
  geometry: z
    .array(z.array(z.number()).min(2).max(3))
    .max(10_000)
    .nullish(),
});

export const replaceSegmentsSchema = z.object({
  segments: z.array(segmentInputSchema).min(1, "至少需要一个分段").max(200, "分段数量过多"),
});

// ---------- 录入 ----------

const isoDateTime = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "时间格式无效");

export const createEntrySchema = z
  .object({
    speciesId: z.string().min(1).nullish(),
    speciesName: z.string().trim().min(1, "请填写物种名称").max(80),
    category: z.string().trim().max(30).nullish(),
    segmentId: z.string().min(1).nullish(),
    startM: z.number().min(0).max(1_000_000),
    endM: z.number().min(0).max(1_000_000),
    count: z.number().int().min(0, "数量不能为负").max(1_000_000),
    startAt: isoDateTime,
    endAt: isoDateTime.optional(),
    observedAt: isoDateTime.optional(),
    observer: z.string().trim().max(60).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    source: z.enum(["MANUAL", "BACKFILL"]).default("MANUAL"),
  })
  .refine((data) => data.endM >= data.startM, "里程上界不能小于下界");

export const updateEntrySchema = z
  .object({
    speciesName: z.string().trim().min(1).max(80),
    category: z.string().trim().max(30).nullish(),
    segmentId: z.string().min(1).nullish(),
    startM: z.number().min(0).max(1_000_000),
    endM: z.number().min(0).max(1_000_000),
    count: z.number().int().min(0).max(1_000_000),
    startAt: isoDateTime,
    endAt: isoDateTime,
    observedAt: isoDateTime.optional(),
    observer: z.string().trim().max(60).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    source: z.enum(["MANUAL", "BACKFILL"]),
  })
  .refine((data) => data.endM >= data.startM, "里程上界不能小于下界");

export const listEntriesQuerySchema = z.object({
  speciesName: z.string().trim().min(1).optional(),
  segmentId: z.string().min(1).optional(),
  source: z.enum(["MANUAL", "BACKFILL"]).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
});

export const timelineQuerySchema = z.object({
  speciesName: z.string().trim().min(1).optional(),
  segmentId: z.string().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  includeResolved: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true"),
});

// ---------- 冲突复核 ----------

export const resolveConflictSchema = z.object({
  resolution: z.enum(["KEEP_A", "KEEP_B", "SUM", "DUPLICATE"], {
    errorMap: () => ({ message: "无效的复核决定" }),
  }),
  note: z.string().trim().max(500).nullish(),
});

// ---------- 导出 ----------

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "geojson"]).default("csv"),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  speciesName: z.string().trim().min(1).optional(),
});

export type CreateTransectInput = z.infer<typeof createTransectSchema>;
export type UpdateTransectInput = z.infer<typeof updateTransectSchema>;
export type SegmentInput = z.infer<typeof segmentInputSchema>;
export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
