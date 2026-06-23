import { Controller, Get, Query, UseGuards, UsePipes } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SpotsQuerySchema, type SpotsQuery } from "@reservation/shared";
import { SpotsService } from "../spots/spots.service";

// Variante MANAGER di /admin/spots: popola la lista posti per i dialog di
// prenotazione del manager. `unrestrictedDate: true` per parità con admin
// (il manager gestisce il proprio team con le stesse capacità temporali).
// Gli spot NON sono scoped per utente — qui non serve filtrare per riporti.
@Controller("manager/spots")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MANAGER)
export class ManagerSpotsController {
  constructor(private spots: SpotsService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(SpotsQuerySchema))
  list(@Query() q: SpotsQuery) {
    return this.spots.list(q, { unrestrictedDate: true });
  }
}
