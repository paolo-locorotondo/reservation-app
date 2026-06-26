import type {
  Site,
  Floor,
  SpotType,
  SpotWithAvailability,
  SpotsAvailabilityDay,
  AdminBulkCreateReservationsDto,
  AdminBulkCreateReservationsResponse,
  AdminCreateReservationDto,
  CreateReservationDto,
  Reservation,
  ReservationStatus,
  Closure,
  AdminCreateClosureDto,
  SpotGroupsResponse,
  SpotGroupDetail,
  AdminCreateSpotGroupDto,
} from "@reservation/shared";

// Mia prenotazione, come restituita da GET /reservations/me — include lo spot
// con floor+site+zone per visualizzazione.
export interface MyReservation extends Reservation {
  spot: {
    id: string;
    code: string;
    type: SpotType;
    floor: { id: string; name: string; site: { id: string; name: string; code: string } };
    zone: { id: string; name: string } | null;
  };
}

// Prenotazione vista dall'admin: lo spot+floor+site+zone come `MyReservation`,
// più l'utente proprietario espanso (richiesto dalla colonna "Utente" della
// tabella admin).
export interface AdminReservation extends MyReservation {
  user: { id: string; email: string; displayName: string };
  // Anche updatedAt è incluso (ereditato dalla riga DB) — utile per la colonna
  // "Cancellata il" quando status=CANCELLED.
  updatedAt: string;
  // spotType è denormalizzato nel DB (vedi schema.prisma), backend lo include
  // nel payload — qui lo dichiariamo per type-safety, anche se è ridondante
  // con `spot.type`.
  spotType: SpotType;
  // Audit (C5): chi ha creato / cancellato. `null` per record legacy o azioni
  // non tracciate → la UI mostra "—".
  createdBy: { id: string; displayName: string; email: string } | null;
  cancelledBy: { id: string; displayName: string; email: string } | null;
}

export interface AdminReservationsResponse {
  items: AdminReservation[];
  truncated: boolean;
  limit: number;
}

// Shape simmetrica a `AdminReservationsResponse` per l'endpoint /reservations/me:
// items + flag di troncatura + limite. Lato UI il banner "Risultati troncati"
// usa la stessa logica della pagina admin (vedi MyReservationsList).
export interface MyReservationsResponse {
  items: MyReservation[];
  truncated: boolean;
  limit: number;
}

export interface AdminReservationsQuery {
  siteId?: string;
  floorId?: string;
  zoneName?: string;
  type?: SpotType;
  status?: ReservationStatus;
  from?: string;
  to?: string;
  userIds?: string[];
}

// Item ritornato dall'endpoint /admin/users (lista per il MultiSelect filtro
// "Utenti" della pagina admin). Senza paginazione: per MVP la lista è piccola.
export interface AdminUserItem {
  id: string;
  email: string;
  displayName: string;
  // Gruppo di riserva di appartenenza (C7.1), null se nessuno. Popolato da
  // /admin/users; usato dall'editor gruppi per avvisare dello spostamento
  // (un utente sta in al più un gruppo). Opzionale: /manager/users non lo
  // valorizza (non serve lì).
  reservedGroupName?: string | null;
}

// Risposta di GET /me: identità dell'utente loggato + gruppo di riserva (C7.1,
// letto fresco da DB, non dal JWT).
export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  role: "USER" | "ADMIN" | "MANAGER";
  reservedGroupName: string | null;
}

// Response wrapper di GET /spots e /admin/spots: il vecchio shape era
// `SpotWithAvailability[]`. Quando il giorno è bloccato (Closure attiva per
// la sede selezionata), `items` è vuoto e `closed=true`: la UI mostra un
// banner "Giorno bloccato: {reason}" invece della lista.
export interface SpotsListResponse {
  items: SpotWithAvailability[];
  closed: boolean;
  closedReason: string | null;
}

// Helper per chiamate al BFF (`/api/proxy/...`).
// Tutte le route del backend sono dietro il proxy: il browser non parla mai
// direttamente con NestJS, e il cookie httpOnly di NextAuth è incluso automaticamente
// perché siamo sullo stesso origin.

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Estraiamo il `message` dal body Nest standard
    // ({"message":"...","error":"...","statusCode":...}) così gli errori
    // mostrati all'utente non sono JSON grezzo. Il body completo resta
    // accessibile via `ApiError.rawBody` per debug / log.
    throw new ApiError(res.status, friendlyMessage(text) || res.statusText, text);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public rawBody?: string,
  ) {
    super(message);
  }
}

// Estrae il `message` dal body di errore Nest (formato standard
// `{message, error, statusCode}` oppure `{message: string[]}` per ValidationPipe).
// Se il body non è JSON, ritorna la stringa così com'è (potrebbe essere già
// human-readable, es. messaggi di errore fetch). Stringa vuota → "".
function friendlyMessage(raw: string): string {
  if (!raw) return "";
  try {
    const j = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(j.message)) return j.message.join("; ");
    if (typeof j.message === "string") return j.message;
  } catch {
    // non-JSON, fall through
  }
  return raw;
}

export const api = {
  listSites: () => call<Site[]>("/sites"),
  listFloors: (siteId: string) => call<Floor[]>(`/sites/${siteId}/floors`),
  listSpots: (params: { type: SpotType; date: string; siteId?: string; floorId?: string }) => {
    const qs = new URLSearchParams({ type: params.type, date: params.date });
    if (params.siteId) qs.set("siteId", params.siteId);
    if (params.floorId) qs.set("floorId", params.floorId);
    return call<SpotsListResponse>(`/spots?${qs.toString()}`);
  },
  listAvailability: (params: {
    type: SpotType;
    from: string;
    to: string;
    siteId?: string;
    floorId?: string;
    zoneName?: string;
  }) => {
    const qs = new URLSearchParams({
      type: params.type,
      from: params.from,
      to: params.to,
    });
    if (params.siteId) qs.set("siteId", params.siteId);
    if (params.floorId) qs.set("floorId", params.floorId);
    if (params.zoneName) qs.set("zoneName", params.zoneName);
    return call<SpotsAvailabilityDay[]>(`/spots/availability?${qs.toString()}`);
  },
  getMe: () => call<MeResponse>("/me"),
  createReservation: (dto: CreateReservationDto) =>
    call<Reservation>("/reservations", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  cancelReservation: (id: string) =>
    call<{ id: string; status: "ACTIVE" | "CANCELLED" }>(`/reservations/${id}`, {
      method: "DELETE",
    }),
  listMyReservations: (params?: { from?: string; to?: string; type?: SpotType }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.type) qs.set("type", params.type);
    const q = qs.toString();
    return call<MyReservationsResponse>(`/reservations/me${q ? `?${q}` : ""}`);
  },
  listAdminReservations: (params: AdminReservationsQuery) => {
    const qs = new URLSearchParams();
    if (params.siteId) qs.set("siteId", params.siteId);
    if (params.floorId) qs.set("floorId", params.floorId);
    if (params.zoneName) qs.set("zoneName", params.zoneName);
    if (params.type) qs.set("type", params.type);
    if (params.status) qs.set("status", params.status);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    // userIds è array → `?userIds=a&userIds=b`. Backend lo riceve via Zod
    // union(string, array) + transform → sempre array.
    for (const id of params.userIds ?? []) qs.append("userIds", id);
    const q = qs.toString();
    return call<AdminReservationsResponse>(`/admin/reservations${q ? `?${q}` : ""}`);
  },
  listAdminUsers: () => call<AdminUserItem[]>("/admin/users"),
  // Variante admin di `listSpots`: stesso shape, ma il backend bypassa i
  // vincoli temporali (ammesse date passate e oltre MAX_DAYS_AHEAD) e il
  // check Closure (l'admin vede tutti gli spot anche su giorni bloccati,
  // così può decidere di pre-caricare prenotazioni storiche se serve).
  listAdminSpots: (params: {
    type: SpotType;
    date: string;
    siteId?: string;
    floorId?: string;
    // Utente TARGET: se passato, il backend calcola l'eligibilità per lui
    // (`available=false`/`lockedForMe` sugli spot che NON può prenotare), così
    // il dialog "Prenota per utente" mostra solo i posti prenotabili da lui.
    userId?: string;
  }) => {
    const qs = new URLSearchParams({ type: params.type, date: params.date });
    if (params.siteId) qs.set("siteId", params.siteId);
    if (params.floorId) qs.set("floorId", params.floorId);
    if (params.userId) qs.set("userId", params.userId);
    return call<SpotsListResponse>(`/admin/spots?${qs.toString()}`);
  },
  // Admin: prenota per conto di un altro utente. Stessi vincoli di
  // create utente normale (regole business) + ruolo ADMIN richiesto.
  adminCreateReservation: (dto: AdminCreateReservationDto) =>
    call<Reservation>("/admin/reservations", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  // Admin: caricamento massivo (pre-carico HR per N utenti × M giorni).
  // Response `{created, skipped: [{userId, date, reason}]}` — skip & report,
  // non transazionale. Cap server-side a 5000 inserimenti per call.
  adminBulkCreateReservations: (dto: AdminBulkCreateReservationsDto) =>
    call<AdminBulkCreateReservationsResponse>("/admin/reservations/bulk", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  // Admin: trasferisce una prenotazione attiva a un altro utente (cambio
  // intestatario). Cambia solo `userId`: data/spot/tipo restano invariati.
  // 409 se il nuovo utente ha già una prenotazione per stesso giorno+tipo.
  adminUpdateReservation: (id: string, userId: string) =>
    call<Reservation>(`/admin/reservations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ userId }),
    }),
  // Admin: cancella prenotazione di qualsiasi utente.
  adminCancelReservation: (id: string) =>
    call<{ id: string; status: "ACTIVE" | "CANCELLED" }>(`/admin/reservations/${id}`, {
      method: "DELETE",
    }),
  // Admin: cancellazione massiva. Solo le ACTIVE tra gli `ids` vengono
  // cancellate; ritorna `cancelled` (count effettivo, può essere < ids.length
  // se alcune erano già cancellate o rimosse nel frattempo).
  adminBulkCancelReservations: (ids: string[]) =>
    call<{ cancelled: number }>("/admin/reservations/bulk-cancel", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  // --- MANAGER: speculari agli admin ma scoped ai riporti diretti + sé
  // stesso (vedi backend ManagerScopeService). Stessi tipi di payload degli
  // admin; cambia solo il path /manager/* (RolesGuard MANAGER + scope). Per
  // l'overlay chiusure nel calendar il manager riusa `listClosures`
  // (user-level), non esiste /manager/closures. ---
  listManagerReservations: (params: AdminReservationsQuery) => {
    const qs = new URLSearchParams();
    if (params.siteId) qs.set("siteId", params.siteId);
    if (params.floorId) qs.set("floorId", params.floorId);
    if (params.zoneName) qs.set("zoneName", params.zoneName);
    if (params.type) qs.set("type", params.type);
    if (params.status) qs.set("status", params.status);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    for (const id of params.userIds ?? []) qs.append("userIds", id);
    const q = qs.toString();
    return call<AdminReservationsResponse>(`/manager/reservations${q ? `?${q}` : ""}`);
  },
  listManagerUsers: () => call<AdminUserItem[]>("/manager/users"),
  listManagerSpots: (params: { type: SpotType; date: string; siteId?: string; floorId?: string }) => {
    const qs = new URLSearchParams({ type: params.type, date: params.date });
    if (params.siteId) qs.set("siteId", params.siteId);
    if (params.floorId) qs.set("floorId", params.floorId);
    return call<SpotsListResponse>(`/manager/spots?${qs.toString()}`);
  },
  managerCreateReservation: (dto: AdminCreateReservationDto) =>
    call<Reservation>("/manager/reservations", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  managerBulkCreateReservations: (dto: AdminBulkCreateReservationsDto) =>
    call<AdminBulkCreateReservationsResponse>("/manager/reservations/bulk", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  managerUpdateReservation: (id: string, userId: string) =>
    call<Reservation>(`/manager/reservations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ userId }),
    }),
  managerCancelReservation: (id: string) =>
    call<{ id: string; status: "ACTIVE" | "CANCELLED" }>(`/manager/reservations/${id}`, {
      method: "DELETE",
    }),
  managerBulkCancelReservations: (ids: string[]) =>
    call<{ cancelled: number }>("/manager/reservations/bulk-cancel", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  // --- Closures (giorni bloccati: festività, manutenzioni, ecc.) ---
  // Lista user-level (no admin guard): ritorna `{ date, reason }[]` per
  // popolare l'overlay calendar in /my-reservations. Niente siteId nei
  // filtri: l'utente non ha una sede fissa, vede tutte le chiusure rilevanti
  // del periodo (globali + per qualsiasi sede). Filtro `type` opzionale.
  listClosures: (params?: { from?: string; to?: string; type?: SpotType }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.type) qs.set("type", params.type);
    const q = qs.toString();
    return call<Array<{ date: string; reason: string }>>(
      `/closures${q ? `?${q}` : ""}`,
    );
  },
  listAdminClosures: (params?: { from?: string; to?: string; siteId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.siteId) qs.set("siteId", params.siteId);
    const q = qs.toString();
    return call<Closure[]>(`/admin/closures${q ? `?${q}` : ""}`);
  },
  // Bulk-friendly: `dto.dates` accetta più date in una call (es. festività
  // multiple Pasqua/Pasquetta o range generato dal client). Singola POST
  // → N closure inserite atomicamente.
  adminCreateClosures: (dto: AdminCreateClosureDto) =>
    call<Closure[]>("/admin/closures", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  adminDeleteClosure: (id: string) =>
    call<{ id: string }>(`/admin/closures/${id}`, { method: "DELETE" }),
  // Bulk-delete: il body contiene gli `ids` selezionati. Ritorna `deleted`
  // (numero effettivamente cancellato — può essere < ids.length se nel
  // frattempo un altro admin ne aveva già rimossi alcuni).
  adminBulkDeleteClosures: (ids: string[]) =>
    call<{ deleted: number }>("/admin/closures/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  // --- Spot groups (postazioni riservate, C7) — solo ADMIN ---
  // Lista gruppi (nome + conteggi) + riepilogo capienza per tipo.
  listSpotGroups: () => call<SpotGroupsResponse>("/admin/spot-groups"),
  // Dettaglio: membri espansi + id postazioni assegnate.
  getSpotGroup: (id: string) => call<SpotGroupDetail>(`/admin/spot-groups/${id}`),
  createSpotGroup: (dto: AdminCreateSpotGroupDto) =>
    call<{ id: string; name: string }>("/admin/spot-groups", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  deleteSpotGroup: (id: string) =>
    call<{ id: string }>(`/admin/spot-groups/${id}`, { method: "DELETE" }),
  // Replace membri/postazioni (il client manda l'elenco completo).
  setSpotGroupMembers: (id: string, userIds: string[]) =>
    call<{ count: number }>(`/admin/spot-groups/${id}/members`, {
      method: "PUT",
      body: JSON.stringify({ userIds }),
    }),
  setSpotGroupSpots: (id: string, spotIds: string[]) =>
    call<{ count: number }>(`/admin/spot-groups/${id}/spots`, {
      method: "PUT",
      body: JSON.stringify({ spotIds }),
    }),
};
