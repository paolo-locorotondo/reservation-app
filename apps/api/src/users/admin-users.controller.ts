import { Controller, Get, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../prisma/prisma.service";

// Endpoint usato dalla pagina /admin/reservations per popolare il filtro
// MultiSelect "Utenti". Niente filtro/paginazione: per MVP la lista è piccola
// (decine, non centinaia di utenti) e Carbon `FilterableMultiSelect` ha già
// il typeahead lato client. Quando il dataset crescerà, aggiungiamo `?q=` e
// passiamo a typeahead remoto.
@Controller("admin/users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminUsersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.user.findMany({
      orderBy: { displayName: "asc" },
      select: { id: true, email: true, displayName: true },
    });
  }
}
