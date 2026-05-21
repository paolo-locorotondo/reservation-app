import { z } from "zod";
import { SpotTypeSchema } from "./enums.js";

export const SpotSchema = z.object({
  id: z.string(),
  code: z.string(),
  type: SpotTypeSchema,
  floorId: z.string(),
  zoneId: z.string().nullable(),
  active: z.boolean(),
});
export type Spot = z.infer<typeof SpotSchema>;

export const SpotWithAvailabilitySchema = SpotSchema.extend({
  available: z.boolean(),
});
export type SpotWithAvailability = z.infer<typeof SpotWithAvailabilitySchema>;

export const SpotsQuerySchema = z.object({
  siteId: z.string().optional(),
  floorId: z.string().optional(),
  type: SpotTypeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});
export type SpotsQuery = z.infer<typeof SpotsQuerySchema>;
