import { z } from "zod";

export const createSiteSchema = z.object({
  name: z.string().trim().min(1, "请填写地点名称").max(60, "地点名称过长"),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  elevationM: z.number().int().min(-500).max(9000).nullish(),
  habitat: z.string().trim().max(60).nullish(),
  description: z.string().trim().max(2000).nullish(),
});

export const updateSiteSchema = createSiteSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  "至少需要提供一个待更新字段",
);

export const listSitesQuerySchema = z.object({
  includeArchived: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export const createShareSchema = z.object({
  scope: z.enum(["TIMELINE", "TIMELINE_AND_COMPARE"]).default("TIMELINE"),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});

export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
export type CreateShareInput = z.infer<typeof createShareSchema>;
