import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type SpotType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  AdminClosuresQuery,
  AdminCreateClosureDto,
} from "@reservation/shared";

// Servizio centralizzato per i giorni bloccati. Esposto sia via
// `AdminClosuresController` (CRUD admin) sia consumato da
// `ReservationsService.create` (check pre-create) e da `SpotsService`
// (flag `closed` su listAvailability + filtro su listSpots).
@Injectable()
export class ClosuresService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lista admin filtrabile per range temporale e sede. Default ordinamento
   * per data desc (più recenti in alto), coerente con altre liste admin.
   */
  async listAdmin(q: AdminClosuresQuery): Promise<ClosureItem[]> {
    const where: Prisma.ClosureWhereInput = {};
    if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as Prisma.DateTimeFilter).gte = parseDateOnly(q.from);
      if (q.to) (where.date as Prisma.DateTimeFilter).lte = parseDateOnly(q.to);
    }
    if (q.siteId) where.siteId = q.siteId;
    return this.prisma.closure.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        site: { select: { id: true, name: true } },
        createdBy: { select: { id: true, displayName: true, email: true } },
      },
    });
  }

  /**
   * Bulk create: una closure per ogni `dates[i]` con stesso siteId/spotType/reason.
   * Tutto in una transazione. Niente unique check: lo schema permette closure
   * sovrapposte (es. globale "Natale" + locale "Lavori a Bari"), il match a
   * runtime trova la prima.
   *
   * Errori:
   *  - 400 se dates contiene un duplicato (errore client probabile, meglio
   *    fail-fast piuttosto che inserire 2 closure identiche)
   *  - 404 se siteId non esiste (FK Prisma → P2003)
   */
  async create(adminUserId: string, dto: AdminCreateClosureDto): Promise<ClosureItem[]> {
    const datesSet = new Set(dto.dates);
    if (datesSet.size !== dto.dates.length) {
      throw new BadRequestException("date duplicate nell'elenco");
    }
    try {
      const created = await this.prisma.$transaction(
        dto.dates.map((d) =>
          this.prisma.closure.create({
            data: {
              date: parseDateOnly(d),
              siteId: dto.siteId ?? null,
              spotType: dto.spotType ?? null,
              reason: dto.reason,
              createdByUserId: adminUserId,
            },
            include: {
              site: { select: { id: true, name: true } },
              createdBy: { select: { id: true, displayName: true, email: true } },
            },
          }),
        ),
      );
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new NotFoundException("sede non trovata");
      }
      throw e;
    }
  }

  async delete(id: string): Promise<{ id: string }> {
    try {
      await this.prisma.closure.delete({ where: { id } });
      return { id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        throw new NotFoundException("chiusura non trovata");
      }
      throw e;
    }
  }

  /**
   * Bulk delete: rimuove più closure in un colpo. Idempotente (id inesistenti
   * vengono ignorati senza errore — il client non si blocca se nel frattempo
   * un altro admin ne ha cancellata una). Ritorna il count effettivo
   * cancellato così il client può mostrare "N rimosse" dal report.
   */
  async deleteMany(ids: string[]): Promise<{ deleted: number }> {
    if (ids.length === 0) return { deleted: 0 };
    const res = await this.prisma.closure.deleteMany({
      where: { id: { in: ids } },
    });
    return { deleted: res.count };
  }

  /**
   * Cerca una Closure che matcha i parametri. Ritorna la prima trovata o null.
   * Usato da `ReservationsService.create` per rifiutare la prenotazione e da
   * `SpotsService.listSpots` per il banner "giorno bloccato".
   *
   * Match logic:
   *   C.date = date
   *   AND (C.siteId IS NULL OR C.siteId = siteId)
   *   AND (C.spotType IS NULL OR C.spotType = spotType)
   */
  async findActive(args: {
    date: Date;
    siteId: string;
    spotType: SpotType;
  }): Promise<ClosureItem | null> {
    return this.prisma.closure.findFirst({
      where: {
        date: args.date,
        OR: [{ siteId: null }, { siteId: args.siteId }],
        AND: { OR: [{ spotType: null }, { spotType: args.spotType }] },
      },
      include: {
        site: { select: { id: true, name: true } },
        createdBy: { select: { id: true, displayName: true, email: true } },
      },
    });
  }

  /**
   * Lista user-level per overlay calendar (GET /closures). Niente filtro
   * siteId: l'utente vede TUTTE le chiusure del periodo che potrebbero
   * affettare le sue prenotazioni — utile in /my-reservations dove non
   * conosciamo a priori le sue sedi. Filtro `type` opzionale.
   *
   * Output collassato per (date, reason) — se più closure coprono lo
   * stesso giorno (es. globale + locale) ritorna la prima per data.
   * Sufficiente per l'overlay grigio nel calendar.
   */
  async listForUser(args: {
    from?: Date;
    to?: Date;
    spotType?: SpotType;
  }): Promise<Array<{ date: string; reason: string }>> {
    const where: Prisma.ClosureWhereInput = {};
    if (args.from || args.to) {
      where.date = {};
      if (args.from) (where.date as Prisma.DateTimeFilter).gte = args.from;
      if (args.to) (where.date as Prisma.DateTimeFilter).lte = args.to;
    }
    if (args.spotType) {
      // Una closure si applica al `type` se ha spotType=null (entrambi)
      // OPPURE coincide. Filtriamo entrambi i casi.
      where.OR = [{ spotType: null }, { spotType: args.spotType }];
    }
    const closures = await this.prisma.closure.findMany({
      where,
      select: { date: true, reason: true },
      orderBy: { date: "asc" },
    });
    // Collasso per data: prima trovata vince. ISO YYYY-MM-DD = primi 10 char
    // del toISOString (le date sono @db.Date, midnight UTC).
    const seen = new Map<string, string>();
    for (const c of closures) {
      const iso = c.date.toISOString().slice(0, 10);
      if (!seen.has(iso)) seen.set(iso, c.reason);
    }
    return Array.from(seen, ([date, reason]) => ({ date, reason }));
  }

  /**
   * Pre-fetch grezzo di TUTTE le closure nel range, senza filtri per
   * (siteId, spotType): il chiamante fa il match in-memory. Usato dal
   * bulk-create (ReservationsService.bulkCreate) per evitare N round-trip
   * a Closure su 5000 candidate. Schema simmetrico al model — niente
   * espansioni di sede/createdBy (qui non servono).
   */
  async findAllInRange(args: {
    from: Date;
    to: Date;
  }): Promise<
    Array<{
      date: Date;
      siteId: string | null;
      spotType: SpotType | null;
      reason: string;
    }>
  > {
    return this.prisma.closure.findMany({
      where: { date: { gte: args.from, lte: args.to } },
      select: { date: true, siteId: true, spotType: true, reason: true },
      orderBy: { date: "asc" },
    });
  }

  /**
   * Variante range-based per popolare il flag `closed` nella response di
   * `listAvailability` (calendar /parking, /desks). Ritorna le closure che
   * coprono uno qualsiasi dei giorni in [from, to] con match per
   * (siteId, spotType). Una sola query, il client aggrega per data.
   */
  async findActiveInRange(args: {
    from: Date;
    to: Date;
    siteId?: string;
    spotType: SpotType;
  }): Promise<Array<{ date: Date; reason: string }>> {
    const closures = await this.prisma.closure.findMany({
      where: {
        date: { gte: args.from, lte: args.to },
        // Match siteId: globale (null) sempre incluso, specifica solo se
        // siteId è fornito dal chiamante.
        OR: args.siteId
          ? [{ siteId: null }, { siteId: args.siteId }]
          : [{ siteId: null }],
        AND: { OR: [{ spotType: null }, { spotType: args.spotType }] },
      },
      select: { date: true, reason: true },
      orderBy: { date: "asc" },
    });
    return closures;
  }

  /**
   * Throw helper: usato in `ReservationsService.create` come pre-check.
   * Se il giorno è bloccato per quel posto, lancia 409 con il reason.
   * Niente effetto se non c'è blocco.
   */
  async assertNotBlocked(args: {
    date: Date;
    siteId: string;
    spotType: SpotType;
  }): Promise<void> {
    const c = await this.findActive(args);
    if (c) {
      throw new ConflictException(`giorno bloccato: ${c.reason}`);
    }
  }
}

// Payload dell'item closure ritornato dal service (con relazioni espanse).
// Tipizzato via Prisma.ClosureGetPayload — TS evolve da solo se l'include
// cambia.
export type ClosureItem = Prisma.ClosureGetPayload<{
  include: {
    site: { select: { id: true; name: true } };
    createdBy: { select: { id: true; displayName: true; email: true } };
  };
}>;

function parseDateOnly(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("data non valida");
  }
  return date;
}
