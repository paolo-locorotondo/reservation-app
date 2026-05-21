import { z } from "zod";

export const SiteSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});
export type Site = z.infer<typeof SiteSchema>;

export const FloorSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  name: z.string(),
});
export type Floor = z.infer<typeof FloorSchema>;

export const ZoneSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  name: z.string(),
});
export type Zone = z.infer<typeof ZoneSchema>;
