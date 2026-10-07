import { z } from "zod";

export const speciesCategorySchema = z.enum(["PLANT", "INSECT", "BIRD", "WEATHER"]);

const phenophaseInputSchema = z.object({
  name: z.string().trim().min(1).max(30),
  code: z.string().trim().max(30).nullish(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "颜色需为 #RRGGBB 格式")
    .default("#3F6F52"),
  isDefault: z.boolean().default(false),
});

export const createSpeciesSchema = z.object({
  category: speciesCategorySchema,
  commonName: z.string().trim().min(1, "请填写物种名称").max(60),
  scientificName: z.string().trim().max(120).nullish(),
  family: z.string().trim().max(60).nullish(),
  description: z.string().trim().max(1000).nullish(),
  phenophases: z.array(phenophaseInputSchema).max(20).optional(),
});

export const updateSpeciesSchema = z
  .object({
    category: speciesCategorySchema.optional(),
    commonName: z.string().trim().min(1).max(60).optional(),
    scientificName: z.string().trim().max(120).nullish(),
    family: z.string().trim().max(60).nullish(),
    description: z.string().trim().max(1000).nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, "至少需要提供一个待更新字段");

export const listSpeciesQuerySchema = z.object({
  category: speciesCategorySchema.optional(),
  q: z.string().trim().max(60).optional(),
  includePreset: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((value) => value === undefined || value === true || value === "true"),
});

export const createPhenophaseSchema = phenophaseInputSchema.extend({
  orderIndex: z.number().int().min(0).max(100).optional(),
});

export const updatePhenophaseSchema = z
  .object({
    name: z.string().trim().min(1).max(30).optional(),
    code: z.string().trim().max(30).nullish(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    isDefault: z.boolean().optional(),
    orderIndex: z.number().int().min(0).max(100).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "至少需要提供一个待更新字段");

export const importPresetSchema = z.object({ presetId: z.string().min(1) });

export type CreateSpeciesInput = z.infer<typeof createSpeciesSchema>;
export type UpdateSpeciesInput = z.infer<typeof updateSpeciesSchema>;
export type CreatePhenophaseInput = z.infer<typeof createPhenophaseSchema>;
export type UpdatePhenophaseInput = z.infer<typeof updatePhenophaseSchema>;
