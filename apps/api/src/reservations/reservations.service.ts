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
  ADMIN_RESERVATIONS_LIMIT,
  type AdminReservationsQuery,
  type CreateReservationDto,
  type ReservationsRangeQuery,
} from "@reservation/shared";

@Injectable()
export class ReservationsService {
  constructor(private prisma: PrismaService) {}

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
  async create(userId: string, dto: CreateReservationDto) {
    const date = parseDateUtc(dto.date);

    const spot = await this.prisma.spot.findUnique({
      where: { id: dto.spotId },
      select: { id: true, type: true, active: true },
    });
    if (!spot) throw new NotFoundException("posto non trovato");
    if (!spot.active) throw new ConflictException("posto non attivo");

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

  async cancel(userId: string, reservationId: string) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, userId: true, status: true },
    });
    if (!r || r.userId !== userId) throw new NotFoundException("prenotazione non trovata");
    if (r.status === "CANCELLED") return { id: r.id, status: r.status };

    return this.prisma.reservation.update({
      where: { id: r.id },
      data: { status: "CANCELLED" },
      select: { id: true, status: true },
    });
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
    const truncated = items.length > ADMIN_RESERVATIONS_LIMIT;
    return {
      items: truncated ? items.slice(0, ADMIN_RESERVATIONS_LIMIT) : items,
      truncated,
      limit: ADMIN_RESERVATIONS_LIMIT,
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
      orderBy: { date: "asc" },
      take: ADMIN_RESERVATIONS_LIMIT + 1, // +1 per scoprire la troncatura
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
    if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as Prisma.DateTimeFilter).gte = parseDateUtc(q.from);
      if (q.to) (where.date as Prisma.DateTimeFilter).lte = parseDateUtc(q.to);
    }
    return this.prisma.reservation.findMany({
      where,
      orderBy: { date: "asc" },
      include: {
        spot: {
          include: {
            floor: { include: { site: true } },
            zone: true,
          },
        },
      },
    });
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
