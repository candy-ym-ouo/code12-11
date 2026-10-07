import { z } from "zod";
import { isValidDateString } from "../../lib/date";

export const observationKindSchema = z.enum([
  "PLANT_PHENOLOGY",
  "INSECT_SIGHTING",
  "BIRD_SOUND",
  "WEATHER_ANOMALY",
]);

export const observationStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);

export const anomalyTypeSchema = z.enum([
  "COLD_WAVE",
  "HEAT_WAVE",
  "DROUGHT",
  "FLOOD",
  "LATE_FROST",
  "UNSEASONAL_RAIN",
  "OTHER",
]);

export const anomalySeveritySchema = z.enum(["MILD", "MODERATE", "SEVERE"]);

const dateStringSchema = z.string().refine(isValidDateString, "日期格式应为 YYYY-MM-DD");

const observationFields = {
  siteId: z.string().min(1, "请选择观察地点"),
  speciesId: z.string().min(1).nullish(),
  phenophaseId: z.string().min(1).nullish(),
  kind: observationKindSchema,
  status: observationStatusSchema.default("PUBLISHED"),
  observationDate: dateStringSchema,
  observedAt: z.coerce.date().nullish(),
  title: z.string().trim().max(120, "标题过长").nullish(),
  notes: z.string().trim().max(5000, "描述过长").nullish(),
  temperatureC: z.number().min(-60).max(60).nullish(),
  precipitationMm: z.number().min(0).max(2000).nullish(),
  windLevel: z.number().int().min(0).max(17).nullish(),
  humidityPct: z.number().int().min(0).max(100).nullish(),
  anomalyType: anomalyTypeSchema.nullish(),
  anomalySeverity: anomalySeveritySchema.nullish(),
  impactNotes: z.string().trim().max(1000).nullish(),
  tagIds: z.array(z.string().min(1)).max(20).optional(),
  allowDuplicate: z.boolean().optional(),
};

export const createObservationSchema = z.object(observationFields);

export const updateObservationSchema = z
  .object({
    siteId: z.string().min(1).optional(),
    speciesId: z.string().min(1).nullish(),
    phenophaseId: z.string().min(1).nullish(),
    kind: observationKindSchema.optional(),
    status: observationStatusSchema.optional(),
    observationDate: dateStringSchema.optional(),
    observedAt: z.coerce.date().nullish(),
    title: z.string().trim().max(120).nullish(),
    notes: z.string().trim().max(5000).nullish(),
    temperatureC: z.number().min(-60).max(60).nullish(),
    precipitationMm: z.number().min(0).max(2000).nullish(),
    windLevel: z.number().int().min(0).max(17).nullish(),
    humidityPct: z.number().int().min(0).max(100).nullish(),
    anomalyType: anomalyTypeSchema.nullish(),
    anomalySeverity: anomalySeveritySchema.nullish(),
    impactNotes: z.string().trim().max(1000).nullish(),
    tagIds: z.array(z.string().min(1)).max(20).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "至少需要提供一个待更新字段");

const booleanish = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .optional()
  .transform((value) => value === true || value === "true");

export const listObservationsQuerySchema = z.object({
  siteId: z.string().min(1).optional(),
  speciesId: z.string().min(1).optional(),
  phenophaseId: z.string().min(1).optional(),
  kind: observationKindSchema.optional(),
  status: z.union([observationStatusSchema, z.literal("ALL")]).default("PUBLISHED"),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  keyword: z.string().trim().max(60).optional(),
  hasPhotos: booleanish,
  tagIds: z.string().optional(),
  sort: z.enum(["date_desc", "date_asc"]).default("date_desc"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export const bulkObservationSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["delete", "addTags", "removeTags"]),
  tagIds: z.array(z.string().min(1)).max(20).optional(),
});

export const reorderPhotosSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1).max(20),
});

export type CreateObservationInput = z.infer<typeof createObservationSchema>;
export type UpdateObservationInput = z.infer<typeof updateObservationSchema>;
export type ListObservationsQuery = z.infer<typeof listObservationsQuerySchema>;
export type BulkObservationInput = z.infer<typeof bulkObservationSchema>;
