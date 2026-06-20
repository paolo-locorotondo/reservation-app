import { Controller, Get, Query, UseGuards, UsePipes } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SpotsQuerySchema, type SpotsQuery } from "@reservation/shared";
import { SpotsService } from "./spots.service";

// Variante admin di `GET /spots`: stesso payload + flag `unrestrictedDate`
// passato al service per saltare il check `>= today` e `<= today + MAX`.
// Usato dal dialog "Prenota per utente" per popolare la lista posti anche
// per date storiche (inserimento prenotazioni passate).
@Controller("admin/spots")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSpotsController {
  constructor(private spots: SpotsService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(SpotsQuerySchema))
  list(@Query() q: SpotsQuery) {
    return this.spots.list(q, { unrestrictedDate: true });
  }
}
