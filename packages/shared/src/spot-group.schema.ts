import { z } from "zod";
import { SpotTypeSchema } from "./enums.js";

// Riga della lista gruppi (GET /admin/spot-groups): nome + conteggi, senza
// espandere membri/spot (caricati on-demand nel dettaglio).
export const SpotGroupListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
  spotCount: z.number().int().nonnegative(),
});
export type SpotGroupListItem = z.infer<typeof SpotGroupListItemSchema>;

// Riepilogo capienza per tipo ("riservate 11/62, libere 51"): total = spot
// attivi, reserved = assegnati a un gruppo, free = total - reserved.
export const SpotCapacitySchema = z.object({
  total: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  free: z.number().int().nonnegative(),
});
export type SpotCapacity = z.infer<typeof SpotCapacitySchema>;

// Capienza spezzata PER SEDE (l'aggregato globale nascondeva la distribuzione
// reale: una sede può avere tutte le riserve e un'altra nessuna).
export const SiteCapacitySchema = z.object({
  siteId: z.string(),
  siteName: z.string(),
  PARKING: SpotCapacitySchema,
  DESK: SpotCapacitySchema,
});
export type SiteCapacity = z.infer<typeof SiteCapacitySchema>;

export const SpotGroupsResponseSchema = z.object({
  groups: z.array(SpotGroupListItemSchema),
  // Una riga per sede (ordinate per nome). Vuoto se non ci sono sedi/spot.
  capacity: z.array(SiteCapacitySchema),
});
export type SpotGroupsResponse = z.infer<typeof SpotGroupsResponseSchema>;

// Postazione assegnata, con nomi sede/piano/zona — per mostrare nell'editor
// l'elenco completo delle riservate del gruppo (chip rimovibili) SENZA dover
// filtrare sede per sede.
export const AssignedSpotSchema = z.object({
  id: z.string(),
  code: z.string(),
  type: SpotTypeSchema,
  zoneName: z.string().nullable(),
  siteName: z.string(),
  floorName: z.string(),
});
export type AssignedSpot = z.infer<typeof AssignedSpotSchema>;

// Dettaglio di un gruppo (GET /admin/spot-groups/:id): membri espansi +
// postazioni assegnate con nomi (per l'elenco/chip nell'editor).
export const SpotGroupDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(
    z.object({ id: z.string(), displayName: z.string(), email: z.string() }),
  ),
  spots: z.array(AssignedSpotSchema),
});
export type SpotGroupDetail = z.infer<typeof SpotGroupDetailSchema>;

export const AdminCreateSpotGroupSchema = z.object({
  name: z.string().min(1, "nome obbligatorio").max(100, "nome troppo lungo"),
});
export type AdminCreateSpotGroupDto = z.infer<typeof AdminCreateSpotGroupSchema>;

// Set (replace) dei membri di un gruppo. Il client manda l'elenco completo.
export const AdminSetSpotGroupMembersSchema = z.object({
  userIds: z.array(z.string().min(1)),
});
export type AdminSetSpotGroupMembersDto = z.infer<
  typeof AdminSetSpotGroupMembersSchema
>;

// Set (replace) delle postazioni riservate al gruppo. Idempotente: gli spot
// non più presenti tornano "aperti a tutti" (reservedGroupId = null).
export const AdminSetSpotGroupSpotsSchema = z.object({
  spotIds: z.array(z.string().min(1)),
});
export type AdminSetSpotGroupSpotsDto = z.infer<
  typeof AdminSetSpotGroupSpotsSchema
>;

// Query opzionale per filtrare gli spot mostrati nell'editor di assegnazione.
export const AdminSpotGroupSpotsQuerySchema = z.object({
  type: SpotTypeSchema.optional(),
  siteId: z.string().optional(),
  floorId: z.string().optional(),
});
export type AdminSpotGroupSpotsQuery = z.infer<
  typeof AdminSpotGroupSpotsQuerySchema
>;
