import { Injectable } from "@nestjs/common";
import { Role, User } from "@prisma/client";
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
    const { provider, sub: providerSub, email, name, role } = payload;
    const displayName = name?.trim() || email;

    const account = await this.prisma.account.findUnique({
      where: { provider_providerSub: { provider, providerSub } },
      include: { user: true },
    });
    if (account) {
      return this.prisma.user.update({
        where: { id: account.userId },
        data: { displayName, role: role as Role },
      });
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      await this.prisma.account.create({
        data: { userId: existing.id, provider, providerSub },
      });
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { displayName, role: role as Role },
      });
    }

    return this.prisma.user.create({
      data: {
        email,
        displayName,
        role: role as Role,
        accounts: { create: { provider, providerSub } },
      },
    });
  }
}
