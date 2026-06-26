import { Controller, Get, Query, UseGuards } from "@nestjs/common";
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

  // `userId` opzionale: l'utente TARGET per cui l'admin sta prenotando. Se
  // passato, gli spot riservati che il target non può prenotare risultano
  // `lockedForMe` (l'admin li vede lucchettati nel dialog). Senza, nessun
  // lock — `ReservationsService.create` farà comunque rispettare la riserva.
  // ZodValidationPipe a livello di parametro sul solo `@Query()` (vedi nota in
  // SpotsController): con anche `@Query("userId")` nel handler, un pipe
  // method-level validerebbe lo schema anche contro `userId` → 400.
  @Get()
  list(
    @Query(new ZodValidationPipe(SpotsQuerySchema)) q: SpotsQuery,
    @Query("userId") userId?: string,
  ) {
    return this.spots.list(q, {
      unrestrictedDate: true,
      eligibilityUserId: userId || undefined,
    });
  }
}
