import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_DAYS_AHEAD } from "../common/business-rules";
import { ClosuresService } from "../closures/closures.service";
import type {
  SpotsQuery,
  SpotsAvailabilityQuery,
  SpotsAvailabilityDay,
} from "@reservation/shared";

@Injectable()
export class SpotsService {
  constructor(
    private prisma: PrismaService,
    private closures: ClosuresService,
  ) {}

  /**
   * Lista spot del tipo richiesto con flag `available` per la data.
   * Una sola query per gli spot, una per le prenotazioni ACTIVE del giorno → join in memoria.
   * La data è interpretata come giorno civile UTC (colonna @db.Date).
   *
   * `opts.unrestrictedDate=true`: bypassa il check `>= today` e `<= today + N`
   * (usato dall'endpoint admin per popolare il dialog "Prenota per utente"
   * anche su date storiche).
   *
   * Response wrapper `{ items, closed, closedReason }`:
   *  - `closed=true` quando l'utente ha selezionato una sede precisa e quel
   *    giorno è bloccato per quella sede (o globalmente). `items` è vuoto:
   *    inutile mostrare la lista degli spot — l'utente non può prenotare.
   *  - `closed=false` altrimenti (caso normale, oppure quando siteId non è
   *    specificato e il check Closure sarebbe ambiguo: per ora skipped).
   */
  async list(
    q: SpotsQuery,
    opts: { unrestrictedDate?: boolean } = {},
  ): Promise<SpotsListResponse> {
    const date = opts.unrestrictedDate
      ? parseDateOnly(q.date)
      : parseDateUtc(q.date);

    // Check Closure solo quando l'utente ha scelto una sede precisa. Senza
    // siteId la lista mostra spot di tutte le sedi: alcune potrebbero essere
    // bloccate, altre no — un banner globale sarebbe ingannevole. L'admin
    // bypassa via `unrestrictedDate=true` (vede tutto a prescindere).
    if (q.siteId && !opts.unrestrictedDate) {
      const closure = await this.closures.findActive({
        date,
        siteId: q.siteId,
        spotType: q.type,
      });
      if (closure) {
        return { items: [], closed: true, closedReason: closure.reason };
      }
    }

    const where: Prisma.SpotWhereInput = {
      type: q.type,
      active: true,
      ...(q.floorId ? { floorId: q.floorId } : {}),
      ...(q.siteId ? { floor: { siteId: q.siteId } } : {}),
    };

    const spots = await this.prisma.spot.findMany({
      where,
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        type: true,
        floorId: true,
        zoneId: true,
        active: true,
        zone: { select: { name: true } },
      },
    });
    if (spots.length === 0) {
      return { items: [], closed: false, closedReason: null };
    }

    const reservations = await this.prisma.reservation.findMany({
      where: {
        spotId: { in: spots.map((s) => s.id) },
        date,
        status: "ACTIVE",
      },
      select: { spotId: true },
    });
    const taken = new Set(reservations.map((r) => r.spotId));

    return {
      items: spots.map(({ zone, ...s }) => ({
        ...s,
        zoneName: zone?.name ?? null,
        available: !taken.has(s.id),
      })),
      closed: false,
      closedReason: null,
    };
  }

  /**
   * Conteggio disponibilità per ogni giorno in [from, to]. Usata dal calendario
   * mensile su /parking e /desks. Due query soltanto: gli spot che matchano il
   * filtro tipo+sede+piano e tutte le reservation ACTIVE nel range. Il conteggio
   * per-giorno è poi fatto in memoria.
   */
  async availability(q: SpotsAvailabilityQuery): Promise<SpotsAvailabilityDay[]> {
    const from = parseDateUtc(q.from);
    const to = parseDateUtc(q.to);
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException("la data 'a' deve essere uguale o successiva a 'da'");
    }
    const rangeDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (rangeDays > MAX_DAYS_AHEAD + 1) {
      throw new BadRequestException(`intervallo oltre i ${MAX_DAYS_AHEAD + 1} giorni consentiti`);
    }

    const where: Prisma.SpotWhereInput = {
      type: q.type,
      active: true,
      ...(q.floorId ? { floorId: q.floorId } : {}),
      ...(q.siteId ? { floor: { siteId: q.siteId } } : {}),
      // Filtro zona "fuzzy": replica il behavior del client (text search libera
      // sul nome zona) così il numero in calendario coincide con la lista.
      // Mode: 'insensitive' = ILIKE in Postgres.
      ...(q.zoneName
        ? { zone: { name: { contains: q.zoneName, mode: "insensitive" } } }
        : {}),
    };

    const spots = await this.prisma.spot.findMany({
      where,
      select: { id: true },
    });
    const total = spots.length;

    // Range vuoto di spot → comunque emettiamo la riga per ogni giorno con
    // available=0/total=0, così il client può disegnare celle "disabled".
    const reservations =
      total === 0
        ? []
        : await this.prisma.reservation.findMany({
            where: {
              spotId: { in: spots.map((s) => s.id) },
              date: { gte: from, lte: to },
              status: "ACTIVE",
            },
            select: { spotId: true, date: true },
          });

    // Map<isoDate, Set<spotId>> per evitare il double-count se mai dovessimo
    // avere duplicati in transito. Il partial unique index lato DB garantisce
    // ATTUALMENTE che non ce ne siano, ma costa zero essere difensivi.
    const taken = new Map<string, Set<string>>();
    for (const r of reservations) {
      const iso = isoFromUtc(r.date);
      let s = taken.get(iso);
      if (!s) {
        s = new Set();
        taken.set(iso, s);
      }
      s.add(r.spotId);
    }

    // Closure check: una sola query per tutto il range. Map iso → reason
    // per il join in memoria con i giorni dell'output.
    const closures = await this.closures.findActiveInRange({
      from,
      to,
      siteId: q.siteId,
      spotType: q.type,
    });
    const closureByDate = new Map<string, string>();
    for (const c of closures) {
      // `c.date` è DATE Postgres → arriva come Date UTC al midnight: stessa
      // forma usata da `isoFromUtc` per le altre date del range.
      closureByDate.set(isoFromUtc(c.date), c.reason);
    }

    const out: SpotsAvailabilityDay[] = [];
    for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
      const iso = isoFromUtc(new Date(t));
      const usedCount = taken.get(iso)?.size ?? 0;
      const closedReason = closureByDate.get(iso) ?? null;
      out.push({
        date: iso,
        available: total - usedCount,
        total,
        closed: closedReason !== null,
        closedReason,
      });
    }
    return out;
  }
}

// Response wrapper di `list()`: il vecchio shape era `SpotWithAvailability[]`,
// ora `{ items, closed, closedReason }`. La transizione è gestita nel client
// (vedi web/src/lib/api.ts e SpotsBrowser).
export interface SpotsListResponse {
  items: Array<{
    id: string;
    code: string;
    type: import("@prisma/client").SpotType;
    floorId: string;
    zoneId: string | null;
    active: boolean;
    zoneName: string | null;
    available: boolean;
  }>;
  closed: boolean;
  closedReason: string | null;
}

function isoFromUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateUtc(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("data non valida");
  }
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diffDays = Math.floor((date.getTime() - todayUtc.getTime()) / 86_400_000);
  if (diffDays < 0) throw new BadRequestException("data nel passato");
  if (diffDays > MAX_DAYS_AHEAD) throw new BadRequestException(`data oltre i ${MAX_DAYS_AHEAD} giorni consentiti`);
  return date;
}

// Variante senza vincoli temporali (usata dagli endpoint admin per ricerca
// storica). Solo parsing del formato YYYY-MM-DD. Stessa shape di
// `reservations.service.ts` — duplicato per ora, candidato a refactor in
// `common/dates.ts` quando uno dei due cresce.
function parseDateOnly(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("data non valida");
  }
  return date;
}
