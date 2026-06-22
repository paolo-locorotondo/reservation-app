import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt.strategy";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  AdminBulkCancelReservationsSchema,
  AdminBulkCreateReservationsSchema,
  AdminCreateReservationSchema,
  AdminReservationsQuerySchema,
  AdminUpdateReservationSchema,
  type AdminBulkCancelReservationsDto,
  type AdminBulkCreateReservationsDto,
  type AdminCreateReservationDto,
  type AdminReservationsQuery,
  type AdminUpdateReservationDto,
} from "@reservation/shared";
import { UsersService } from "../users/users.service";
import { ReservationsService } from "./reservations.service";

// Endpoint dedicati alla pagina /admin/reservations.
// Path-spaced sotto /admin/... per fare spazio in futuro a /admin/closures
// e /admin/settings: quando ci saranno, valuteremo se estrarli in un
// AdminModule. Per ora resta in ReservationsModule (riusa lo stesso provider).
@Controller("admin/reservations")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminReservationsController {
  constructor(
    private reservations: ReservationsService,
    private users: UsersService,
  ) {}

  @Get()
  @UsePipes(new ZodValidationPipe(AdminReservationsQuerySchema))
  list(@Query() q: AdminReservationsQuery) {
    return this.reservations.listAdmin(q);
  }

  // Prenota per conto di un altro utente. Riusa `ReservationsService.create`:
  // le regole "spot active" e "max 1 ACTIVE per utente/giorno/tipo" restano
  // valide. L'admin invece BYPASSA il vincolo temporale via
  // `unrestrictedDate: true`: può prenotare per date nel passato (es.
  // inserimento storico HR) e oltre `MAX_DAYS_AHEAD` (pianificazione lunga).
  @Post()
  async create(
    @CurrentUser() payload: JwtPayload,
    @Body(new ZodValidationPipe(AdminCreateReservationSchema))
    dto: AdminCreateReservationDto,
  ) {
    const admin = await this.users.getByToken(payload);
    return this.reservations.create(
      dto.userId,
      { spotId: dto.spotId, date: dto.date },
      // `actorUserId` = admin chiamante per l'audit createdBy (la
      // prenotazione è intestata a `dto.userId` ma creata dall'admin).
      { unrestrictedDate: true, actorUserId: admin.id },
    );
  }

  // Caricamento massivo (pre-carico HR): N utenti × M giorni in una call.
  // Skip & report: non transazionale, ogni create fallita finisce in
  // `response.skipped[]` con motivo. Vedi `ReservationsService.bulkCreate`.
  @Post("bulk")
  async bulkCreate(
    @CurrentUser() payload: JwtPayload,
    @Body(new ZodValidationPipe(AdminBulkCreateReservationsSchema))
    dto: AdminBulkCreateReservationsDto,
  ) {
    const admin = await this.users.getByToken(payload);
    return this.reservations.bulkCreate(dto, admin.id);
  }

  // Cancellazione massiva: cancella tutte le ACTIVE tra gli `ids` selezionati.
  // POST con body (DELETE+body non universalmente supportato). Idempotente.
  // `cancelledByUserId` = admin chiamante (audit C5).
  @Post("bulk-cancel")
  async bulkCancel(
    @CurrentUser() payload: JwtPayload,
    @Body(new ZodValidationPipe(AdminBulkCancelReservationsSchema))
    dto: AdminBulkCancelReservationsDto,
  ) {
    const admin = await this.users.getByToken(payload);
    return this.reservations.bulkCancel(admin.id, dto.ids);
  }

  // Trasferisce una prenotazione attiva a un altro utente (cambio intestatario).
  // Solo `userId` è modificabile: data/spot/tipo restano invariati. Il vincolo
  // unique partial `(userId, date, spotType) WHERE active` protegge dal caso
  // "il nuovo utente ha già una prenotazione per quel giorno e tipo".
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdminUpdateReservationSchema))
    dto: AdminUpdateReservationDto,
  ) {
    return this.reservations.adminUpdate(id, dto.userId);
  }

  // Cancella prenotazione di qualsiasi utente. Il check `r.userId !== userId`
  // è bypassato dal flag `isAdmin: true`; il `userId` passato è quello
  // dell'admin chiamante (non usato per il permesso, ma utile per audit).
  @Delete(":id")
  async cancel(@CurrentUser() payload: JwtPayload, @Param("id") id: string) {
    const admin = await this.users.getByToken(payload);
    return this.reservations.cancel(admin.id, id, { isAdmin: true });
  }
}
