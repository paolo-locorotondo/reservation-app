import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

// Risolve l'insieme di userId su cui un MANAGER può agire: **solo i riporti
// diretti** (User con `managerEmail` = email del manager, claim w3id popolato
// al login). Solo gerarchia a UN livello.
//
// NB: il manager NON include sé stesso. Separazione netta voluta:
//   - `/manager/reservations` = il TEAM (i riporti)
//   - `/my-reservations`      = sé stesso, identico a un USER (range-bound)
// Così non c'è ambiguità sui vincoli temporali per le proprie prenotazioni
// (il manager le gestisce da /my-reservations come tutti).
//
// Caso "team vuoto": un manager i cui riporti non hanno ancora mai fatto
// login ha allowedUserIds = [] → `/manager/reservations` mostra liste vuote.
// Accettabile: il team si popola man mano che i riporti accedono.
@Injectable()
export class ManagerScopeService {
  constructor(private prisma: PrismaService) {}

  async allowedUserIds(manager: { email: string }): Promise<string[]> {
    const reports = await this.prisma.user.findMany({
      where: { managerEmail: manager.email },
      select: { id: true },
    });
    return reports.map((r) => r.id);
  }
}
