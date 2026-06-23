import { Controller, Get, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt.strategy";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";

// Variante MANAGER di /admin/users: ritorna SOLO i riporti diretti del
// manager (NON sé stesso — vedi ManagerScopeService: il manager gestisce le
// proprie prenotazioni da /my-reservations). Popola il MultiSelect "Utenti" e
// i ComboBox di prenotazione/transfer in /manager/reservations.
@Controller("manager/users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MANAGER)
export class ManagerUsersController {
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
  ) {}

  @Get()
  async list(@CurrentUser() payload: JwtPayload) {
    const manager = await this.users.getByToken(payload);
    return this.prisma.user.findMany({
      where: { managerEmail: manager.email },
      orderBy: { displayName: "asc" },
      select: { id: true, email: true, displayName: true },
    });
  }
}
