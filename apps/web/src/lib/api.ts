import type {
  Site,
  Floor,
  SpotType,
  SpotWithAvailability,
  SpotsAvailabilityDay,
  CreateReservationDto,
  Reservation,
  ReservationStatus,
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
}

export interface AdminReservationsResponse {
  items: AdminReservation[];
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
    return call<SpotWithAvailability[]>(`/spots?${qs.toString()}`);
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
  createReservation: (dto: CreateReservationDto) =>
    call<Reservation>("/reservations", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  cancelReservation: (id: string) =>
    call<{ id: string; status: "ACTIVE" | "CANCELLED" }>(`/reservations/${id}`, {
      method: "DELETE",
    }),
  listMyReservations: (params?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const q = qs.toString();
    return call<MyReservation[]>(`/reservations/me${q ? `?${q}` : ""}`);
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
};
