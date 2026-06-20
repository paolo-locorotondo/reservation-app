import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
  AdminBulkDeleteClosuresSchema,
  AdminClosuresQuerySchema,
  AdminCreateClosureSchema,
  type AdminBulkDeleteClosuresDto,
  type AdminClosuresQuery,
  type AdminCreateClosureDto,
} from "@reservation/shared";
import { UsersService } from "../users/users.service";
import { ClosuresService } from "./closures.service";

// Endpoint dedicati alla pagina /admin/closures.
// Path-spaced sotto /admin/... insieme a /admin/reservations e /admin/users.
@Controller("admin/closures")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminClosuresController {
  constructor(
    private closures: ClosuresService,
    private users: UsersService,
  ) {}

  @Get()
  @UsePipes(new ZodValidationPipe(AdminClosuresQuerySchema))
  list(@Query() q: AdminClosuresQuery) {
    return this.closures.listAdmin(q);
  }

  // Bulk-friendly: il body accetta `dates: string[]`. Singola call inserisce
  // N closure (una per data) con stessi siteId/spotType/reason. Atomico.
  @Post()
  async create(
    @CurrentUser() payload: JwtPayload,
    @Body(new ZodValidationPipe(AdminCreateClosureSchema))
    dto: AdminCreateClosureDto,
  ) {
    const admin = await this.users.getByToken(payload);
    return this.closures.create(admin.id, dto);
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
    return this.closures.delete(id);
  }

  // Bulk-delete via POST con body. DELETE+body non è universalmente
  // supportato (alcuni client/proxy lo strippano), POST è più safe.
  @Post("bulk-delete")
  bulkDelete(
    @Body(new ZodValidationPipe(AdminBulkDeleteClosuresSchema))
    dto: AdminBulkDeleteClosuresDto,
  ) {
    return this.closures.deleteMany(dto.ids);
  }
}
