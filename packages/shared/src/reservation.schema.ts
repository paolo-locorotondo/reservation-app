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

// Admin: aggiorna l'intestatario di una prenotazione esistente (transfer).
// Solo `userId` è modificabile: data/spot/tipo restano invariati. Il vincolo
// unique partial `(userId, date, spotType) WHERE active` protegge dal caso
// "il nuovo utente ha già una prenotazione per quel giorno e tipo" —
// P2002 → 409 Conflict con messaggio italiano.
export const AdminUpdateReservationSchema = z.object({
  userId: z.string().min(1),
});
export type AdminUpdateReservationDto = z.infer<typeof AdminUpdateReservationSchema>;

// Admin: caricamento massivo prenotazioni (pre-carico HR per stagisti/nuovi
// assunti). Genera N×M inserimenti dove N=utenti, M=giorni del range che
// matchano i weekdays. Skip & report: ogni create fallita (Closure attiva,
// vincolo unique, spot non disponibile) viene saltata e ritornata in
// `skipped[]` con motivo. Riusa `ReservationsService.create()` per ciascuna
// combinazione, con `unrestrictedDate: true` (HR può caricare passato/futuro).
//
// Cap: 5000 inserimenti totali per call (10 utenti × 365 giorni). Sopra →
// 400 "operazione troppo grande". `weekdays` segue il formato di
// `Date.getDay()`: 0=Dom, 1=Lun, 2=Mar, 3=Mer, 4=Gio, 5=Ven, 6=Sab. Vuoto =
// tutti i giorni (raro ma valido per copertura totale).
//
// Mapping spot:
//  - mode="explicit": `spotMapping` Record<userId, spotId> (default UI;
//    HR sa "Mario→P-15, Luigi→P-16")
//  - mode="pool": `spotPool` {siteId, spotType}, backend assegna il primo
//    libero per ogni (utente, data) — non deterministico ma rapido
export const BULK_RESERVATIONS_MAX_INSERTS = 5000;

const WeekdaySchema = z.number().int().min(0).max(6);

export const AdminBulkCreateReservationsSchema = z
  .object({
    userIds: z.array(z.string().min(1)).min(1, "almeno un utente"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
    // Default UI: lun-ven [1,2,3,4,5]. Array vuoto = tutti i giorni.
    weekdays: z.array(WeekdaySchema).max(7),
    mode: z.enum(["explicit", "pool"]),
    // Quando mode="explicit": deve esistere una entry per OGNI userId.
    // Validazione cross-field nel `.superRefine` sotto.
    spotMapping: z.record(z.string().min(1)).optional(),
    // Quando mode="pool": siteId+spotType obbligatori.
    spotPool: z
      .object({
        siteId: z.string().min(1),
        spotType: SpotTypeSchema,
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "explicit") {
      if (!data.spotMapping) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "spotMapping richiesto per mode=explicit",
          path: ["spotMapping"],
        });
        return;
      }
      for (const uid of data.userIds) {
        if (!data.spotMapping[uid]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `mapping mancante per l'utente ${uid}`,
            path: ["spotMapping", uid],
          });
        }
      }
    } else if (data.mode === "pool") {
      if (!data.spotPool) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "spotPool richiesto per mode=pool",
          path: ["spotPool"],
        });
      }
    }
  });
export type AdminBulkCreateReservationsDto = z.infer<
  typeof AdminBulkCreateReservationsSchema
>;

// Response del bulk-create: count effettivamente creato + lista delle
// combinazioni saltate. `skipped` è ordered per (userId, date) per coerenza
// di lettura nel report HR.
export const BulkSkippedItemSchema = z.object({
  userId: z.string(),
  date: z.string(),
  reason: z.string(),
});
export type BulkSkippedItem = z.infer<typeof BulkSkippedItemSchema>;

export const AdminBulkCreateReservationsResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.array(BulkSkippedItemSchema),
});
export type AdminBulkCreateReservationsResponse = z.infer<
  typeof AdminBulkCreateReservationsResponseSchema
>;

// Query string di /reservations/me. Tutti i parametri opzionali; quando
// presenti restringono il dataset (e quindi anche il `truncated` flag della
// response). `type` permette di chiedere solo PARKING o solo DESK — usato
// dalla UI per fetchare per-tab indipendentemente, così il limite
// MY_RESERVATIONS_LIST_LIMIT vale per-tipo e non sull'aggregato.
export const ReservationsRangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: SpotTypeSchema.optional(),
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

// Limiti di default per le list view (admin + utente). Se il dataset filtrato
// supera il limite, `truncated=true` nella response e il client mostra un
// banner che invita a restringere i filtri. Niente UI di paginazione per ora.
//
// Sono *default*: il backend può sovrascriverli via env var
// (`ADMIN_RESERVATIONS_LIST_LIMIT`, `MY_RESERVATIONS_LIST_LIMIT`) — vedi
// `reservations.service.ts`. Lato client questi valori non sono direttamente
// usati: il `limit` mostrato nel banner arriva sempre dalla response del
// backend (response.limit), così il client riflette sempre il valore reale
// usato dal server.
export const ADMIN_RESERVATIONS_LIST_LIMIT = 500;
export const MY_RESERVATIONS_LIST_LIMIT = 100;
