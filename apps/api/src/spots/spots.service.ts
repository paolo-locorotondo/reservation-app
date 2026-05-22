import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { SpotsQuery } from "@reservation/shared";

const MAX_DAYS_AHEAD = 30;

@Injectable()
export class SpotsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lista spot del tipo richiesto con flag `available` per la data.
   * Una sola query per gli spot, una per le prenotazioni ACTIVE del giorno → join in memoria.
   * La data è interpretata come giorno civile UTC (colonna @db.Date).
   */
  async list(q: SpotsQuery) {
    const date = parseDateUtc(q.date);

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
    if (spots.length === 0) return [];

    const reservations = await this.prisma.reservation.findMany({
      where: {
        spotId: { in: spots.map((s) => s.id) },
        date,
        status: "ACTIVE",
      },
      select: { spotId: true },
    });
    const taken = new Set(reservations.map((r) => r.spotId));

    return spots.map(({ zone, ...s }) => ({
      ...s,
      zoneName: zone?.name ?? null,
      available: !taken.has(s.id),
    }));
  }
}

function parseDateUtc(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("invalid date");
  }
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diffDays = Math.floor((date.getTime() - todayUtc.getTime()) / 86_400_000);
  if (diffDays < 0) throw new BadRequestException("date in the past");
  if (diffDays > MAX_DAYS_AHEAD) throw new BadRequestException(`date beyond ${MAX_DAYS_AHEAD} days`);
  return date;
}
