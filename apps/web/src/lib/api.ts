import type { Site, Floor, SpotType, SpotWithAvailability } from "@reservation/shared";

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
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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
};
