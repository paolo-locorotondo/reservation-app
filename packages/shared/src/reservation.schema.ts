import { z } from "zod";
import { ReservationStatusSchema, SpotTypeSchema } from "./enums.js";
import { SpotSchema } from "./spot.schema.js";

export const ReservationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  spotId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: ReservationStatusSchema,
  createdAt: z.string(),
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const ReservationWithSpotSchema = ReservationSchema.extend({
  spot: SpotSchema,
});
export type ReservationWithSpot = z.infer<typeof ReservationWithSpotSchema>;

export const CreateReservationSchema = z.object({
  spotId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});
export type CreateReservationDto = z.infer<typeof CreateReservationSchema>;

// Admin: prenota per conto di un altro utente. Stessi campi di create user
// + `userId` target esplicito. Validato in `AdminReservationsController`,
// protetto da RolesGuard ADMIN. Riusa `ReservationsService.create()` con
// un secondo argomento opzionale `actingFor`.
export const AdminCreateReservationSchema = z.object({
  userId: z.string().min(1),
  spotId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});
export type AdminCreateReservationDto = z.infer<typeof AdminCreateReservationSchema>;

export const ReservationsRangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type ReservationsRangeQuery = z.infer<typeof ReservationsRangeQuerySchema>;

// --- Admin: lista globale prenotazioni (read-only) ----------------------
// Tutti i campi sono opzionali. Se `status` è omesso lato client, il service
// NON applica un default — il client decide cosa mostrare ("ACTIVE" al primo
// render, omette il param se l'utente seleziona "Tutti"). `userIds` accetta
// `?userIds=a&userIds=b` (multipli) e `?userIds=a` (singolo): il transform
// normalizza sempre ad array (o undefined se omesso).
export const AdminReservationsQuerySchema = z.object({
  siteId: z.string().optional(),
  floorId: z.string().optional(),
  zoneName: z.string().optional(), // text search ILIKE su Zone.name (come SpotsAvailability)
  type: SpotTypeSchema.optional(),
  status: ReservationStatusSchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
  userIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
});
export type AdminReservationsQuery = z.infer<typeof AdminReservationsQuerySchema>;

// Limite hardcoded di righe ritornate dall'endpoint admin. Se il dataset
// filtrato lo supera, `truncated=true` e il client mostra un banner che invita
// a restringere i filtri. Niente UI di paginazione per ora (vedi DEPLOY/plan).
export const ADMIN_RESERVATIONS_LIMIT = 500;
