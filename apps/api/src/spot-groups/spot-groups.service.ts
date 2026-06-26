import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, SpotType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  AdminCreateSpotGroupDto,
  SpotGroupDetail,
  SpotGroupsResponse,
} from "@reservation/shared";

// Eligibilità di un utente verso le postazioni riservate (C7.1). Un utente sta
// in al più un gruppo (`groupId`); `coveredTypes` = i tipi degli spot riservati
// a quel gruppo. Vedi `isSpotBookable`.
export interface SpotEligibility {
  groupId: string | null;
  coveredTypes: Set<SpotType>;
}

// Predicato puro di prenotabilità (regola C7.1, in un solo posto). Riusato da
// SpotsService (list/availability) e ReservationsService (create/bulk):
//  - spot riservato → prenotabile SOLO se è del gruppo dell'utente;
//  - spot aperto → prenotabile, TRANNE per i tipi coperti dal suo gruppo
//    (vincolo inverso: per quei tipi il membro usa solo le sue riservate).
export function isSpotBookable(
  spot: { reservedGroupId: string | null; type: SpotType },
  e: SpotEligibility,
): boolean {
  if (spot.reservedGroupId !== null) {
    return e.groupId !== null && spot.reservedGroupId === e.groupId;
  }
  if (e.groupId !== null && e.coveredTypes.has(spot.type)) {
    return false;
  }
  return true;
}

// Gestione gruppi di riserva postazioni (C7). CRUD + membri + assegnazione
// spot, esposto solo all'ADMIN via AdminSpotGroupsController. La logica di
// eligibilità (chi può prenotare cosa) è esposta a SpotsService /
// ReservationsService via `getUserEligibility`/`getUsersEligibility` +
// il predicato puro `isSpotBookable` (C7.1).
@Injectable()
export class SpotGroupsService {
  constructor(private prisma: PrismaService) {}

  /** Lista gruppi con conteggi + riepilogo capienza per tipo. */
  async list(): Promise<SpotGroupsResponse> {
    const groups = await this.prisma.spotGroup.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: { select: { members: true, spots: true } },
      },
    });

    // Capienza PER SEDE: aggregazione in memoria (gli spot sono poche decine,
    // e groupBy Prisma non raggruppa per campo di relazione `floor.siteId`).
    const spots = await this.prisma.spot.findMany({
      where: { active: true },
      select: {
        type: true,
        reservedGroupId: true,
        floor: { select: { siteId: true, site: { select: { name: true } } } },
      },
    });
    // siteId → { siteName, per-tipo {total, reserved} }
    const bySite = new Map<
      string,
      {
        siteName: string;
        PARKING: { total: number; reserved: number };
        DESK: { total: number; reserved: number };
      }
    >();
    for (const s of spots) {
      const siteId = s.floor.siteId;
      let row = bySite.get(siteId);
      if (!row) {
        row = {
          siteName: s.floor.site.name,
          PARKING: { total: 0, reserved: 0 },
          DESK: { total: 0, reserved: 0 },
        };
        bySite.set(siteId, row);
      }
      const bucket = row[s.type];
      bucket.total += 1;
      if (s.reservedGroupId !== null) bucket.reserved += 1;
    }
    const capacity = Array.from(bySite, ([siteId, r]) => ({
      siteId,
      siteName: r.siteName,
      PARKING: {
        total: r.PARKING.total,
        reserved: r.PARKING.reserved,
        free: r.PARKING.total - r.PARKING.reserved,
      },
      DESK: {
        total: r.DESK.total,
        reserved: r.DESK.reserved,
        free: r.DESK.total - r.DESK.reserved,
      },
    })).sort((a, b) => a.siteName.localeCompare(b.siteName));

    return {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g._count.members,
        spotCount: g._count.spots,
      })),
      capacity,
    };
  }

  async create(dto: AdminCreateSpotGroupDto): Promise<{ id: string; name: string }> {
    try {
      const g = await this.prisma.spotGroup.create({
        data: { name: dto.name.trim() },
        select: { id: true, name: true },
      });
      return g;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("esiste già un gruppo con questo nome");
      }
      throw e;
    }
  }

  async delete(id: string): Promise<{ id: string }> {
    try {
      // onDelete: SetNull su Spot.reservedGroupId → cancellare il gruppo libera
      // le sue postazioni (tornano aperte a tutti), non le cancella.
      await this.prisma.spotGroup.delete({ where: { id } });
      return { id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        throw new NotFoundException("gruppo non trovato");
      }
      throw e;
    }
  }

  async detail(id: string): Promise<SpotGroupDetail> {
    const g = await this.prisma.spotGroup.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        members: {
          orderBy: { displayName: "asc" },
          select: { id: true, displayName: true, email: true },
        },
        spots: {
          orderBy: [{ floor: { site: { name: "asc" } } }, { code: "asc" }],
          select: {
            id: true,
            code: true,
            type: true,
            zone: { select: { name: true } },
            floor: {
              select: { name: true, site: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!g) throw new NotFoundException("gruppo non trovato");
    return {
      id: g.id,
      name: g.name,
      members: g.members,
      spots: g.spots.map((s) => ({
        id: s.id,
        code: s.code,
        type: s.type,
        zoneName: s.zone?.name ?? null,
        siteName: s.floor.site.name,
        floorName: s.floor.name,
      })),
    };
  }

  /**
   * Replace dei membri (il client manda l'elenco completo). Appartenenza
   * esclusiva (C7.1): l'assegnazione avviene via FK `User.reservedGroupId`.
   * In transazione:
   *  1) sgancia gli utenti prima in questo gruppo ma non più nell'elenco;
   *  2) assegna a questo gruppo gli utenti dell'elenco — sovrascrivendo un
   *     eventuale altro gruppo (un utente sta in al più un gruppo): l'utente
   *     viene SPOSTATO. L'UI avvisa l'admin prima del salvataggio.
   */
  async setMembers(id: string, userIds: string[]): Promise<{ count: number }> {
    await this.assertExists(id);
    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { reservedGroupId: id, id: { notIn: userIds } },
        data: { reservedGroupId: null },
      }),
      this.prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: { reservedGroupId: id },
      }),
    ]);
    return { count: userIds.length };
  }

  /**
   * Replace delle postazioni riservate al gruppo. In transazione:
   *  1) libera gli spot prima riservati a questo gruppo ma non più nell'elenco
   *     (reservedGroupId → null);
   *  2) assegna a questo gruppo gli spot dell'elenco (sovrascrive un'eventuale
   *     riserva ad altro gruppo: 0/1 gruppo per spot).
   */
  async setSpots(id: string, spotIds: string[]): Promise<{ count: number }> {
    await this.assertExists(id);
    await this.prisma.$transaction([
      this.prisma.spot.updateMany({
        where: { reservedGroupId: id, id: { notIn: spotIds } },
        data: { reservedGroupId: null },
      }),
      this.prisma.spot.updateMany({
        where: { id: { in: spotIds } },
        data: { reservedGroupId: id },
      }),
    ]);
    return { count: spotIds.length };
  }

  /**
   * Eligibilità di un singolo utente (C7.1). Usato da SpotsService.list/
   * availability e ReservationsService.create. Restituisce il gruppo (unico)
   * dell'utente e i tipi coperti da quel gruppo (tipi degli spot attivi a esso
   * riservati). Vedi `isSpotBookable`.
   */
  async getUserEligibility(userId: string): Promise<SpotEligibility> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { reservedGroupId: true },
    });
    const groupId = u?.reservedGroupId ?? null;
    if (!groupId) return { groupId: null, coveredTypes: new Set() };
    return { groupId, coveredTypes: await this.coveredTypesOf([groupId]) };
  }

  /**
   * Versione batch per il caricamento massivo (ReservationsService.bulkCreate):
   * eligibilità per molti utenti in poche query. Map userId → eligibilità.
   */
  async getUsersEligibility(
    userIds: string[],
  ): Promise<Map<string, SpotEligibility>> {
    const out = new Map<string, SpotEligibility>();
    if (userIds.length === 0) return out;
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, reservedGroupId: true },
    });
    const groupIds = [
      ...new Set(
        users
          .map((u) => u.reservedGroupId)
          .filter((g): g is string => g !== null),
      ),
    ];
    // Tipi coperti per ciascun gruppo coinvolto, in una sola query.
    const coveredByGroup = await this.coveredTypesByGroup(groupIds);
    for (const u of users) {
      const groupId = u.reservedGroupId;
      out.set(u.id, {
        groupId,
        coveredTypes: groupId
          ? (coveredByGroup.get(groupId) ?? new Set())
          : new Set(),
      });
    }
    return out;
  }

  /** Tipi (distinti) degli spot attivi riservati a uno dei gruppi dati. */
  private async coveredTypesOf(groupIds: string[]): Promise<Set<SpotType>> {
    if (groupIds.length === 0) return new Set();
    const rows = await this.prisma.spot.findMany({
      where: { active: true, reservedGroupId: { in: groupIds } },
      select: { type: true },
      distinct: ["type"],
    });
    return new Set(rows.map((r) => r.type));
  }

  /** Come sopra ma raggruppato per gruppo (per il batch). */
  private async coveredTypesByGroup(
    groupIds: string[],
  ): Promise<Map<string, Set<SpotType>>> {
    const map = new Map<string, Set<SpotType>>();
    if (groupIds.length === 0) return map;
    const rows = await this.prisma.spot.findMany({
      where: { active: true, reservedGroupId: { in: groupIds } },
      select: { type: true, reservedGroupId: true },
      distinct: ["type", "reservedGroupId"],
    });
    for (const r of rows) {
      if (r.reservedGroupId === null) continue;
      let set = map.get(r.reservedGroupId);
      if (!set) {
        set = new Set();
        map.set(r.reservedGroupId, set);
      }
      set.add(r.type);
    }
    return map;
  }

  private async assertExists(id: string): Promise<void> {
    const g = await this.prisma.spotGroup.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!g) throw new NotFoundException("gruppo non trovato");
  }
}
