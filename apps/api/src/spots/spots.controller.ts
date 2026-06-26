import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt.strategy";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  SpotsQuerySchema,
  SpotsAvailabilityQuerySchema,
  type SpotsQuery,
  type SpotsAvailabilityQuery,
} from "@reservation/shared";
import { UsersService } from "../users/users.service";
import { SpotsService } from "./spots.service";

// NB: il ZodValidationPipe è applicato a LIVELLO DI PARAMETRO sul solo
// `@Query()`, NON via `@UsePipes` method-level. Con più parametri nel handler
// (qui `@CurrentUser()` + `@Query()`), `@UsePipes` valuterebbe lo schema query
// anche contro il payload utente → 400 "type/date Required".
@Controller("spots")
@UseGuards(JwtAuthGuard)
export class SpotsController {
  constructor(
    private spots: SpotsService,
    private users: UsersService,
  ) {}

  // `availability` deve precedere il GET root (Nest applica il primo match).
  // Eligibilità riserva (C7): passiamo l'id dell'utente richiedente così il
  // conteggio e i lock riflettono ciò che LUI può prenotare.
  @Get("availability")
  async availability(
    @CurrentUser() payload: JwtPayload,
    @Query(new ZodValidationPipe(SpotsAvailabilityQuerySchema))
    q: SpotsAvailabilityQuery,
  ) {
    const user = await this.users.getByToken(payload);
    return this.spots.availability(q, user.id);
  }

  @Get()
  async list(
    @CurrentUser() payload: JwtPayload,
    @Query(new ZodValidationPipe(SpotsQuerySchema)) q: SpotsQuery,
  ) {
    const user = await this.users.getByToken(payload);
    return this.spots.list(q, { eligibilityUserId: user.id });
  }
}
