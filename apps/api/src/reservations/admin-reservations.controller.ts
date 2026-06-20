import { Controller, Get, Query, UseGuards, UsePipes } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  AdminReservationsQuerySchema,
  type AdminReservationsQuery,
} from "@reservation/shared";
import { ReservationsService } from "./reservations.service";

// Endpoint dedicato alla pagina /admin/reservations (read-only).
// Path-spaced sotto /admin/... per fare spazio in futuro a /admin/closures
// e /admin/settings: quando ci saranno, valuteremo se estrarli in un
// AdminModule. Per ora resta in ReservationsModule (riusa lo stesso provider).
@Controller("admin/reservations")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminReservationsController {
  constructor(private reservations: ReservationsService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(AdminReservationsQuerySchema))
  list(@Query() q: AdminReservationsQuery) {
    return this.reservations.listAdmin(q);
  }
}
