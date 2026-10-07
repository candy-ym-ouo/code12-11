import { z } from "zod";
import { isValidDateString } from "../../lib/date";
import { observationKindSchema, observationStatusSchema } from "../observations/schema";

const dateStringSchema = z.string().refine(isValidDateString, "日期格式应为 YYYY-MM-DD");

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  siteId: z.string().min(1).optional(),
  speciesId: z.string().min(1).optional(),
  kind: observationKindSchema.optional(),
  status: observationStatusSchema.default("PUBLISHED"),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;
