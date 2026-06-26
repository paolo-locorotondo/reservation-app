import { Injectable } from "@nestjs/common";
import { Prisma, Role, User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { JwtPayload } from "../auth/jwt.strategy";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Provisioning idempotente al primo (e a ogni successivo) login:
   *  1) lookup per (provider, providerSub) tramite Account → strada veloce.
   *  2) altrimenti lookup per email → utente esistente con altro provider:
   *     creiamo un nuovo Account collegato.
   *  3) altrimenti creiamo User + Account in transazione.
   * Allinea anche displayName e role al payload corrente.
   */
  async provisionFromToken(payload: JwtPayload): Promise<User> {
    const { provider, sub: providerSub, email, name, role, managerEmail } = payload;
    const displayName = name?.trim() || email;

    // `managerEmail` lo scriviamo solo quando il token lo porta (login w3id):
    // un token che NON lo include (es. proxy per-request senza il claim, o
    // login Google) non deve azzerare il valore già a DB. Spread condizionale.
    const managerEmailData =
      managerEmail !== undefined ? { managerEmail } : {};
    const updateData = { displayName, role: role as Role, ...managerEmailData };

    // 1) Account già presente → strada veloce, allinea displayName/role.
    const account = await this.prisma.account.findUnique({
      where: { provider_providerSub: { provider, providerSub } },
      include: { user: true },
    });
    if (account) {
      return this.prisma.user.update({ where: { id: account.userId }, data: updateData });
    }

    // 2) Creazione/collegamento TOLLERANTE ALLE RACE. Al primo login una pagina
    //    può sparare più richieste concorrenti (es. /me + /reservations/me):
    //    tutte vedono "nessun account/utente" e provano a creare in parallelo →
    //    una vince, le altre prendono P2002 (unique su email o su
    //    provider+providerSub). In quel caso NON falliamo: ri-risolviamo, perché
    //    un'altra richiesta ha già materializzato user/account.
    try {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        await this.prisma.account.create({
          data: { userId: existing.id, provider, providerSub },
        });
        return this.prisma.user.update({ where: { id: existing.id }, data: updateData });
      }
      return await this.prisma.user.create({
        data: {
          email,
          displayName,
          role: role as Role,
          ...managerEmailData,
          accounts: { create: { provider, providerSub } },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return this.resolveAfterRace(provider, providerSub, email, updateData);
      }
      throw e;
    }
  }

  // Ri-risoluzione dopo una P2002 da provisioning concorrente: a questo punto
  // user/account esistono (creati dalla richiesta che ha vinto la race).
  // Cerchiamo prima per account, poi per email collegando l'account se manca.
  private async resolveAfterRace(
    provider: string,
    providerSub: string,
    email: string,
    updateData: Prisma.UserUpdateInput,
  ): Promise<User> {
    const account = await this.prisma.account.findUnique({
      where: { provider_providerSub: { provider, providerSub } },
      include: { user: true },
    });
    if (account) {
      return this.prisma.user.update({ where: { id: account.userId }, data: updateData });
    }
    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      // L'utente esiste (creato da altro provider o dalla race) ma l'account
      // per questo provider può non essere ancora collegato. `upsert`
      // idempotente: lo crea se manca, no-op se un'altra richiesta l'ha già fatto.
      await this.prisma.account.upsert({
        where: { provider_providerSub: { provider, providerSub } },
        create: { userId: byEmail.id, provider, providerSub },
        update: {},
      });
      return this.prisma.user.update({ where: { id: byEmail.id }, data: updateData });
    }
    // Caso teoricamente irraggiungibile (P2002 ma niente user/account): rilancia
    // un errore esplicito invece di un silenzioso null.
    throw new Error(
      `provisioning: P2002 ma utente non risolvibile per ${provider}/${email}`,
    );
  }

  /**
   * Nome del gruppo di riserva di cui l'utente è membro (C7.1), o null.
   * Usato da GET /me per mostrarlo nel menu account.
   */
  async getReservedGroupName(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { reservedGroup: { select: { name: true } } },
    });
    return u?.reservedGroup?.name ?? null;
  }

  /**
   * Risolve l'utente dal token JWT senza fare scritture, hot-path delle API.
   * Se l'account non esiste ancora (utente non è mai passato da `/me`), fa fallback
   * al provisioning completo per non rompere il flusso.
   */
  async getByToken(payload: JwtPayload): Promise<User> {
    const account = await this.prisma.account.findUnique({
      where: { provider_providerSub: { provider: payload.provider, providerSub: payload.sub } },
      include: { user: true },
    });
    if (account) return account.user;
    return this.provisionFromToken(payload);
  }
}
