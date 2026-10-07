import { z } from "zod";

const yearSchema = z.coerce.number().int().min(1900).max(2200);

export const compareQuerySchema = z.object({
  siteId: z.string().min(1, "请选择观察地点"),
  speciesId: z.string().min(1, "请选择物种"),
  phenophaseId: z.string().min(1).optional(),
  years: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? [...new Set(value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item)))]
            .filter((item) => item >= 1900 && item <= 2200)
            .sort((a, b) => a - b)
        : [],
    ),
});

export const phenologyQuerySchema = z.object({
  siteId: z.string().min(1),
  speciesId: z.string().min(1),
  phenophaseId: z.string().min(1).optional(),
  fromYear: yearSchema.optional(),
  toYear: yearSchema.optional(),
});

export const weatherQuerySchema = z.object({
  siteId: z.string().min(1),
  monthDay: z.string().regex(/^\d{2}-\d{2}$/, "日期格式应为 MM-DD"),
  windowDays: z.coerce.number().int().min(0).max(31).default(7),
  year: yearSchema.optional(),
});

export const overviewQuerySchema = z.object({
  siteId: z.string().min(1).optional(),
});

export type CompareQuery = z.infer<typeof compareQuerySchema>;
export type PhenologyQuery = z.infer<typeof phenologyQuerySchema>;
export type WeatherQuery = z.infer<typeof weatherQuerySchema>;
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
