import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt.strategy";
import { UsersService } from "../users/users.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  CreateReservationSchema,
  ReservationsRangeQuerySchema,
  type CreateReservationDto,
  type ReservationsRangeQuery,
} from "@reservation/shared";
import { ReservationsService } from "./reservations.service";

// I pipe Zod sono applicati al singolo parametro (Body/Query) e non a tutto il
// metodo: @UsePipes a livello di handler li applicherebbe anche a @CurrentUser,
// trasformando il JwtPayload in un oggetto vuoto e causando errori a valle.
@Controller("reservations")
@UseGuards(JwtAuthGuard)
export class ReservationsController {
  constructor(
    private reservations: ReservationsService,
    private users: UsersService,
  ) {}

  @Get("me")
  async listMine(
    @CurrentUser() payload: JwtPayload,
    @Query(new ZodValidationPipe(ReservationsRangeQuerySchema)) q: ReservationsRangeQuery,
  ) {
    const user = await this.users.getByToken(payload);
    return this.reservations.listMine(user.id, q);
  }

  @Post()
  async create(
    @CurrentUser() payload: JwtPayload,
    @Body(new ZodValidationPipe(CreateReservationSchema)) dto: CreateReservationDto,
  ) {
    const user = await this.users.getByToken(payload);
    return this.reservations.create(user.id, dto);
  }

  @Delete(":id")
  async cancel(@CurrentUser() payload: JwtPayload, @Param("id") id: string) {
    const user = await this.users.getByToken(payload);
    return this.reservations.cancel(user.id, id);
  }
}
