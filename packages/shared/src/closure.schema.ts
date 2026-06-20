import { z } from "zod";
import { SpotTypeSchema } from "./enums.js";

// Singolo blocco come ritornato dall'endpoint admin GET /admin/closures.
// `siteId === null` → blocco globale (tutte le sedi); `spotType === null` →
// blocco per entrambi i tipi (parking + desk).
export const ClosureSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  siteId: z.string().nullable(),
  spotType: SpotTypeSchema.nullable(),
  reason: z.string(),
  createdAt: z.string(),
  createdByUserId: z.string(),
  // Espansi per la UI: nome sede (se siteId non null) e displayName del
  // creatore. Il backend li include nella response.
  site: z
    .object({ id: z.string(), name: z.string() })
    .nullable(),
  createdBy: z
    .object({ id: z.string(), displayName: z.string(), email: z.string() }),
});
export type Closure = z.infer<typeof ClosureSchema>;

// Query per la lista admin. Tutti i parametri opzionali.
export const AdminClosuresQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
  siteId: z.string().optional(),
});
export type AdminClosuresQuery = z.infer<typeof AdminClosuresQuerySchema>;

// Query per la lista user-level (GET /closures): permette al client di
// disegnare l'overlay "barre grigie" nel calendar senza dover passare per
// listAvailability. `type` opzionale per filtrare per tipo (parking/desk).
// Niente siteId qui: in /my-reservations l'utente non ha un siteId fisso e
// vuole vedere tutte le chiusure rilevanti (globali + per qualsiasi sede).
export const ClosuresQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
  type: SpotTypeSchema.optional(),
});
export type ClosuresQuery = z.infer<typeof ClosuresQuerySchema>;

// Item compatto ritornato da GET /closures (no audit, no espansione site:
// questa view serve solo a popolare l'overlay calendar). Le sovrapposizioni
// sono collassate lato server per data — il backend ritorna max 1 riga per
// (date, spotType, siteId).
export const ClosureItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string(),
});
export type ClosureItem = z.infer<typeof ClosureItemSchema>;

// Body POST /admin/closures: bulk-friendly. `dates` è un array — utile per
// creare in una call sia "Pasqua e Pasquetta" sia un range generato dal
// client. Per blocchi non urgenti (1-2 date) il client invia un array di 1.
//
// `siteId === undefined`/null → tutte le sedi; idem per spotType.
export const AdminCreateClosureSchema = z.object({
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"))
    .min(1, "almeno una data"),
  siteId: z.string().min(1).optional(),
  spotType: SpotTypeSchema.optional(),
  reason: z.string().min(1, "motivo obbligatorio").max(500, "motivo troppo lungo"),
});
export type AdminCreateClosureDto = z.infer<typeof AdminCreateClosureSchema>;

// Bulk-delete: il client manda gli `ids` selezionati nella tabella
// (multi-select). Idempotente: ids inesistenti vengono ignorati. Usiamo
// POST con body invece di DELETE perché HTTP DELETE col body non è
// universalmente ben supportato.
export const AdminBulkDeleteClosuresSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "almeno un id"),
});
export type AdminBulkDeleteClosuresDto = z.infer<typeof AdminBulkDeleteClosuresSchema>;
