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
  zoneName: z.string().nullable(),
  // Riserva (C7), calcolata per l'utente richiedente (o il target, per
  // admin/manager "prenota per"):
  //  - reservedGroupName: nome del gruppo a cui lo spot è riservato (null = aperto)
  //  - lockedForMe: true se riservato a un gruppo di cui l'utente NON è membro
  //    → non prenotabile (UI lo mostra lucchettato)
  reservedGroupName: z.string().nullable(),
  lockedForMe: z.boolean(),
});
export type SpotWithAvailability = z.infer<typeof SpotWithAvailabilitySchema>;

export const SpotsQuerySchema = z.object({
  siteId: z.string().optional(),
  floorId: z.string().optional(),
  type: SpotTypeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});
export type SpotsQuery = z.infer<typeof SpotsQuerySchema>;

// Disponibilità mensile: il calendario su /parking e /desks chiede un range di
// giorni e riceve un conteggio per giorno. Range max 30 giorni (allineato a
// MAX_DAYS_AHEAD applicato nel service).
// `zoneName` è una text search case-insensitive (ILIKE %X%) per coerenza col
// filtro Zona della vista Lista, che è anch'esso testuale.
export const SpotsAvailabilityQuerySchema = z.object({
  siteId: z.string().optional(),
  floorId: z.string().optional(),
  zoneName: z.string().optional(),
  type: SpotTypeSchema,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});
export type SpotsAvailabilityQuery = z.infer<typeof SpotsAvailabilityQuerySchema>;

export const SpotsAvailabilityDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  available: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  // Se true, il giorno è bloccato (Closure attiva per il filtro corrente):
  // il calendar mostra cella grigia "lucchetto", click disabilitato. Il
  // motivo è in `closedReason` (testo libero scritto dall'admin).
  closed: z.boolean(),
  closedReason: z.string().nullable(),
});
export type SpotsAvailabilityDay = z.infer<typeof SpotsAvailabilityDaySchema>;
