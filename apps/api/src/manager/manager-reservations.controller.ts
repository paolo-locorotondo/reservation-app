import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
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
import { ReservationsService } from "../reservations/reservations.service";
import { ManagerScopeService } from "./manager-scope.service";

// Endpoint per la pagina /manager/reservations. Speculari a
// /admin/reservations MA con scope ai soli riporti diretti + sé stesso del
// MANAGER chiamante (vedi ManagerScopeService). Il `RolesGuard` ammette solo
// MANAGER: gli ADMIN usano gli endpoint /admin/* (che vedono tutti).
//
// Riusano `ReservationsService` (stessa logica) passando `scopeUserIds` /
// `allowedUserIds`: lo scope è un vincolo di sicurezza SEMPRE applicato, non
// bypassabile dai filtri scelti dall'utente.
@Controller("manager/reservations")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MANAGER)
export class ManagerReservationsController {
  constructor(
    private reservations: ReservationsService,
    private users: UsersService,
    private scope: ManagerScopeService,
  ) {}

  // Risolve manager + set di userId ammessi (helper condiviso dagli endpoint).
  private async resolveScope(payload: JwtPayload) {
    const manager = await this.users.getByToken(payload);
    const allowedUserIds = await this.scope.allowedUserIds({
      email: manager.email,
    });
    return { manager, allowedUserIds };
  }

  // NB: il pipe Zod va applicato SOLO al `@Query()`, non a livello di metodo
  // (`@UsePipes`): un pipe di metodo valida TUTTI i parametri, incluso
  // `@CurrentUser() payload`, e lo schema query (senza sub/provider/email) lo
  // strippa → payload svuotato → getByToken con sub=undefined.
  @Get()
  async list(
    @CurrentUser() payload: JwtPayload,
    @Query(new ZodValidationPipe(AdminReservationsQuerySchema))
    q: AdminReservationsQuery,
  ) {
    const { allowedUserIds } = await this.resolveScope(payload);
    return this.reservations.listAdmin(q, allowedUserIds);
  }

  @Post()
  async create(
    @CurrentUser() payload: JwtPayload,
    @Body(new ZodValidationPipe(AdminCreateReservationSchema))
    dto: AdminCreateReservationDto,
  ) {
    const { manager, allowedUserIds } = await this.resolveScope(payload);
    if (!allowedUserIds.includes(dto.userId)) {
      throw new ForbiddenException(
        "puoi prenotare solo per gli utenti del tuo team",
      );
    }
    return this.reservations.create(
      dto.userId,
      { spotId: dto.spotId, date: dto.date },
      { unrestrictedDate: true, actorUserId: manager.id },
    );
  }

  @Post("bulk")
  async bulkCreate(
    @CurrentUser() payload: JwtPayload,
    @Body(new ZodValidationPipe(AdminBulkCreateReservationsSchema))
    dto: AdminBulkCreateReservationsDto,
  ) {
    const { manager, allowedUserIds } = await this.resolveScope(payload);
    return this.reservations.bulkCreate(dto, manager.id, allowedUserIds);
  }

  @Post("bulk-cancel")
  async bulkCancel(
    @CurrentUser() payload: JwtPayload,
    @Body(new ZodValidationPipe(AdminBulkCancelReservationsSchema))
    dto: AdminBulkCancelReservationsDto,
  ) {
    const { manager, allowedUserIds } = await this.resolveScope(payload);
    return this.reservations.bulkCancel(manager.id, dto.ids, allowedUserIds);
  }

  @Patch(":id")
  async update(
    @CurrentUser() payload: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdminUpdateReservationSchema))
    dto: AdminUpdateReservationDto,
  ) {
    const { allowedUserIds } = await this.resolveScope(payload);
    return this.reservations.adminUpdate(id, dto.userId, { allowedUserIds });
  }

  @Delete(":id")
  async cancel(@CurrentUser() payload: JwtPayload, @Param("id") id: string) {
    const { manager, allowedUserIds } = await this.resolveScope(payload);
    return this.reservations.cancel(manager.id, id, {
      isAdmin: true,
      allowedUserIds,
    });
  }
}
