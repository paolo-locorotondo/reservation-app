import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_DAYS_AHEAD } from "../common/business-rules";
import type { CreateReservationDto, ReservationsRangeQuery } from "@reservation/shared";

@Injectable()
export class ReservationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Regole applicative:
   *  - spot deve esistere ed essere `active`
   *  - data ∈ [oggi, oggi+30 giorni] in UTC
   *  - utente non può avere altra ACTIVE con stesso (date, spot.type)
   * La race su doppia ACTIVE per lo stesso spot/giorno è gestita dall'unique
   * @@unique([spotId, date, status]) → P2002 → 409.
   */
  async create(userId: string, dto: CreateReservationDto) {
    const date = parseDateUtc(dto.date);

    const spot = await this.prisma.spot.findUnique({
      where: { id: dto.spotId },
      select: { id: true, type: true, active: true },
    });
    if (!spot) throw new NotFoundException("posto non trovato");
    if (!spot.active) throw new ConflictException("posto non attivo");

    const existing = await this.prisma.reservation.findFirst({
      where: {
        userId,
        date,
        status: "ACTIVE",
        spot: { type: spot.type },
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
        data: { userId, spotId: spot.id, date, status: "ACTIVE" },
        include: { spot: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
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
