import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_DAYS_AHEAD } from "../common/business-rules";
import {
  ADMIN_RESERVATIONS_LIST_LIMIT,
  MY_RESERVATIONS_LIST_LIMIT,
  type AdminReservationsQuery,
  type CreateReservationDto,
  type ReservationsRangeQuery,
} from "@reservation/shared";
import { ClosuresService } from "../closures/closures.service";

// Lookup env-based con fallback alla costante shared. Pattern simmetrico a
// `MAX_DAYS_AHEAD` in `common/business-rules.ts`: il valore numerico dalla
// env (se presente, intero, > 0); altrimenti il default del package shared.
// Letto al boot del modulo Nest, no live-reload — un cambio env richiede
// restart del server (accettabile: questi limiti cambiano di rado).
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const ADMIN_LIST_LIMIT = envInt(
  "ADMIN_RESERVATIONS_LIST_LIMIT",
  ADMIN_RESERVATIONS_LIST_LIMIT,
);
const MY_LIST_LIMIT = envInt(
  "MY_RESERVATIONS_LIST_LIMIT",
  MY_RESERVATIONS_LIST_LIMIT,
);

@Injectable()
export class ReservationsService {
  constructor(
    private prisma: PrismaService,
    private closures: ClosuresService,
  ) {}

  /**
   * Regole applicative:
   *  - spot deve esistere ed essere `active`
   *  - data ∈ [oggi, oggi+MAX_DAYS_AHEAD] in UTC
   *  - utente non può avere altra ACTIVE con stesso (date, spotType)
   *
   * Race-safety:
   *  - Doppia ACTIVE su (spotId, date): partial unique index
   *    `Reservation_spotId_date_active_key` → P2002 → 409.
   *  - Doppia ACTIVE su (userId, date, spotType) — ovvero "stesso utente,
   *    doppio submit ravvicinato dello stesso tipo": partial unique index
   *    `Reservation_userId_date_spotType_active_key` → P2002 → 409.
   * Il `findFirst` qui sotto resta come check "soft": evita di lanciare una
   * INSERT destinata a fallire quando l'utente ha già la prenotazione (caso
   * normale, non race), e dà un messaggio italiano più specifico del 409 generico.
   */
  async create(
    userId: string,
    dto: CreateReservationDto,
    opts: { unrestrictedDate?: boolean } = {},
  ) {
    // `unrestrictedDate=true` usato dall'admin per inserire prenotazioni nel
    // passato (es. inserimento storico HR) o oltre `MAX_DAYS_AHEAD`. Le altre
    // regole business (spot active, vincolo unique user/day/type) restano.
    const date = opts.unrestrictedDate
      ? parseDateOnly(dto.date)
      : parseDateUtc(dto.date);

    const spot = await this.prisma.spot.findUnique({
      where: { id: dto.spotId },
      select: {
        id: true,
        type: true,
        active: true,
        floor: { select: { siteId: true } },
      },
    });
    if (!spot) throw new NotFoundException("posto non trovato");
    if (!spot.active) throw new ConflictException("posto non attivo");

    // Check Closure: se il giorno è bloccato per questo (siteId, spotType),
    // rifiutiamo con 409 + reason. Vale anche per l'admin: se HR ha
    // dichiarato il giorno chiuso, anche le prenotazioni "per conto di"
    // vanno rifiutate (a meno che HR non rimuova prima il blocco).
    await this.closures.assertNotBlocked({
      date,
      siteId: spot.floor.siteId,
      spotType: spot.type,
    });

    // Usa `spotType` direttamente (denormalizzato): niente join verso Spot.
    const existing = await this.prisma.reservation.findFirst({
      where: {
        userId,
        date,
        status: "ACTIVE",
        spotType: spot.type,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        spot.type === "PARKING"
          ? "hai già un posto auto prenotato per questa data"
          : "hai già una scrivania prenotata per questa data",
      );
    }

    try {
      return await this.prisma.reservation.create({
        data: {
          userId,
          spotId: spot.id,
          // Denormalizzazione: serve al partial unique index
          // (userId, date, spotType) WHERE status='ACTIVE' di garantire la
          // regola "max 1 ACTIVE per utente/giorno/tipo" anche su race.
          spotType: spot.type,
          date,
          status: "ACTIVE",
        },
        include: { spot: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // Due possibili index in collisione: spot già preso oppure utente che
        // sta facendo un doppio submit. `e.meta?.target` può essere un array
        // di campi o il nome dell'index (dipende dal driver). Distinguiamo
        // best-effort per dare il messaggio più appropriato.
        const target = (e.meta as { target?: string | string[] } | undefined)?.target;
        const t = Array.isArray(target) ? target.join(",") : (target ?? "");
        if (t.includes("userId")) {
          throw new ConflictException(
            spot.type === "PARKING"
              ? "hai già un posto auto prenotato per questa data"
              : "hai già una scrivania prenotata per questa data",
          );
        }
        throw new ConflictException("posto già prenotato per questa data");
      }
      throw e;
    }
  }

  /**
   * Cancella una prenotazione (status → CANCELLED, idempotente).
   *
   * - User normale: solo le sue (`userId === r.userId`); altrimenti 404
   *   (NotFound deliberato per non leakare l'esistenza di reservation altrui).
   * - Admin (`opts.isAdmin = true`): qualsiasi reservation. Il `userId`
   *   passato è quello dell'admin chiamante, usato solo per audit/debug
   *   (non per il check di permesso).
   */
  async cancel(
    userId: string,
    reservationId: string,
    opts: { isAdmin?: boolean } = {},
  ) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, userId: true, status: true },
    });
    if (!r) throw new NotFoundException("prenotazione non trovata");
    if (!opts.isAdmin && r.userId !== userId) {
      // 404 anche qui (non 403): non vogliamo che un user sappia se un ID
      // esiste, sia perché non è suo, sia perché non esiste.
      throw new NotFoundException("prenotazione non trovata");
    }
    if (r.status === "CANCELLED") return { id: r.id, status: r.status };

    return this.prisma.reservation.update({
      where: { id: r.id },
      data: { status: "CANCELLED" },
      select: { id: true, status: true },
    });
  }

  /**
   * Admin: trasferisce una prenotazione attiva a un altro utente. Cambia solo
   * `userId` (data/spot/tipo restano invariati). Atomico: una sola UPDATE,
   * niente cancel+create. Errori:
   *  - 404 se la reservation non esiste
   *  - 409 se non è ACTIVE (CANCELLED non si può aggiornare)
   *  - 409 se il nuovo utente ha già un'altra ACTIVE per stesso (date, spotType):
   *    intercetta P2002 sul partial unique index
   *    `Reservation_userId_date_spotType_active_key`.
   *  - 404 se il nuovo `userId` non esiste (FK Prisma → P2003).
   */
  async adminUpdate(reservationId: string, newUserId: string) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, userId: true, status: true, spotType: true },
    });
    if (!r) throw new NotFoundException("prenotazione non trovata");
    if (r.status !== "ACTIVE") {
      throw new ConflictException("prenotazione non attiva, impossibile aggiornarla");
    }
    if (r.userId === newUserId) {
      // No-op: l'admin ha cliccato Aggiorna senza aver cambiato utente.
      // Ritorniamo il record corrente, niente errore.
      return this.prisma.reservation.findUnique({
        where: { id: r.id },
        include: { spot: true },
      });
    }

    try {
      return await this.prisma.reservation.update({
        where: { id: r.id },
        data: { userId: newUserId },
        include: { spot: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === "P2002") {
          throw new ConflictException(
            r.spotType === "PARKING"
              ? "il nuovo utente ha già un posto auto prenotato per questa data"
              : "il nuovo utente ha già una scrivania prenotata per questa data",
          );
        }
        if (e.code === "P2003") {
          throw new NotFoundException("utente non trovato");
        }
      }
      throw e;
    }
  }

  /**
   * Lista globale prenotazioni — usata dalla pagina admin (read-only, accesso
   * limitato dal RolesGuard nel controller). Filtri tutti opzionali. NON
   * applichiamo un default su `status`: il client decide cosa mostrare.
   *
   * Ritorna fino a ADMIN_RESERVATIONS_LIMIT righe; se il dataset filtrato
   * supera la soglia, `truncated=true` per permettere al client di mostrare
   * un banner che inviti a restringere i filtri.
   */
  async listAdmin(q: AdminReservationsQuery): Promise<{
    items: AdminReservationItem[];
    truncated: boolean;
    limit: number;
  }> {
    const items = await this.findAdminItems(q);
    const truncated = items.length > ADMIN_LIST_LIMIT;
    return {
      items: truncated ? items.slice(0, ADMIN_LIST_LIMIT) : items,
      truncated,
      limit: ADMIN_LIST_LIMIT,
    };
  }

  // Estratto per mantenere l'include dichiarato in un solo posto. Il payload
  // restituito è tipizzato via `AdminReservationItem` (sotto la classe).
  private async findAdminItems(q: AdminReservationsQuery): Promise<AdminReservationItem[]> {
    const where: Prisma.ReservationWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.type) where.spotType = q.type;
    if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as Prisma.DateTimeFilter).gte = parseDateOnly(q.from);
      if (q.to) (where.date as Prisma.DateTimeFilter).lte = parseDateOnly(q.to);
    }
    // Costruzione progressiva di where.spot: floorId vince su siteId (più
    // specifico); zoneName si aggiunge ortogonale. Senza la coalescenza qui
    // sotto avremmo dovuto duplicare tre branch (siteId-only, floorId-only,
    // zoneName-only e tutte le combinazioni).
    const spotWhere: Prisma.SpotWhereInput = {};
    if (q.floorId) spotWhere.floorId = q.floorId;
    else if (q.siteId) spotWhere.floor = { siteId: q.siteId };
    if (q.zoneName && q.zoneName.trim()) {
      spotWhere.zone = {
        name: { contains: q.zoneName.trim(), mode: "insensitive" },
      };
    }
    if (Object.keys(spotWhere).length > 0) where.spot = spotWhere;

    if (q.userIds && q.userIds.length > 0) {
      where.userId = { in: q.userIds };
    }

    return this.prisma.reservation.findMany({
      where,
      // Default DESC: l'admin vede prima le prenotazioni più recenti (per data
      // del posto, non createdAt). In combinazione col troncamento a 500
      // questo è anche più utile dell'ASC: se i risultati superano il limite,
      // si vedono i 500 più recenti — quelli "che servono ora" — anziché i
      // 500 più vecchi. Il sort UI client-side sovrascrive quando l'admin
      // clicca un'intestazione di colonna.
      orderBy: { date: "desc" },
      take: ADMIN_LIST_LIMIT + 1, // +1 per scoprire la troncatura
      include: {
        spot: {
          include: {
            floor: { include: { site: true } },
            zone: true,
          },
        },
        user: { select: { id: true, email: true, displayName: true } },
      },
    });
  }

  async listMine(userId: string, q: ReservationsRangeQuery) {
    const where: Prisma.ReservationWhereInput = {
      userId,
      status: "ACTIVE",
    };
    // Filtro per tipo: la UI chiama l'endpoint una volta per tab (PARKING e
    // DESK separatamente), così il limite MY_LIST_LIMIT e il flag truncated
    // sono per-tipo (simmetrico al pattern admin), non sull'aggregato dei
    // tipi.
    if (q.type) where.spotType = q.type;
    // Lettura senza vincoli temporali: l'utente può visualizzare TUTTE le sue
    // prenotazioni (anche quelle del passato — ACTIVE non automaticamente
    // archiviate — e oltre MAX_DAYS_AHEAD se in qualche modo esistono).
    // `parseDateOnly` valida solo il formato, niente range check.
    // MAX_DAYS_AHEAD applica solo alle AZIONI (create/cancel?), non alla
    // lettura: vedi `parseDateUtc` in create() e i vincoli del client.
    if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as Prisma.DateTimeFilter).gte = parseDateOnly(q.from);
      if (q.to) (where.date as Prisma.DateTimeFilter).lte = parseDateOnly(q.to);
    }
    // Stessa strategia dell'endpoint admin: chiediamo +1 per scoprire la
    // troncatura senza un `count()` separato. Se ne arrivano LIMIT+1, sappiamo
    // che ce n'erano almeno LIMIT+1 e tagliamo a LIMIT con `truncated: true`.
    const rows = await this.prisma.reservation.findMany({
      where,
      // Default DESC: l'utente vede prima la prenotazione più lontana nel
      // futuro. Il sort UI client-side sovrascrive quando si clicca una
      // colonna nella vista Lista.
      orderBy: { date: "desc" },
      take: MY_LIST_LIMIT + 1,
      include: {
        spot: {
          include: {
            floor: { include: { site: true } },
            zone: true,
          },
        },
      },
    });
    const truncated = rows.length > MY_LIST_LIMIT;
    return {
      items: truncated ? rows.slice(0, MY_LIST_LIMIT) : rows,
      truncated,
      limit: MY_LIST_LIMIT,
    };
  }
}

// Payload del singolo item ritornato dall'endpoint admin. Tipizzato via
// `Prisma.ReservationGetPayload` sull'include usato in `findAdminItems`,
// così TS evolve da solo se aggiungiamo/rimuoviamo relazioni.
type AdminReservationItem = Prisma.ReservationGetPayload<{
  include: {
    spot: {
      include: {
        floor: { include: { site: true } };
        zone: true;
      };
    };
    user: { select: { id: true; email: true; displayName: true } };
  };
}>;

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

// Variante senza vincoli temporali: l'admin può filtrare per date passate o
// oltre MAX_DAYS_AHEAD (es. ricerca storica). Solo parsing del formato.
function parseDateOnly(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("data non valida");
  }
  return date;
}
