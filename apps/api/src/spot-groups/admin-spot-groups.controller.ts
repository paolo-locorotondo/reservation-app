import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  AdminCreateSpotGroupSchema,
  AdminSetSpotGroupMembersSchema,
  AdminSetSpotGroupSpotsSchema,
  type AdminCreateSpotGroupDto,
  type AdminSetSpotGroupMembersDto,
  type AdminSetSpotGroupSpotsDto,
} from "@reservation/shared";
import { SpotGroupsService } from "./spot-groups.service";

// Gestione gruppi di riserva — SOLO ADMIN. Il MANAGER non riserva postazioni
// (ne subisce solo gli effetti di eligibilità quando prenota per i riporti).
@Controller("admin/spot-groups")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSpotGroupsController {
  constructor(private groups: SpotGroupsService) {}

  @Get()
  list() {
    return this.groups.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(AdminCreateSpotGroupSchema))
    dto: AdminCreateSpotGroupDto,
  ) {
    return this.groups.create(dto);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.groups.detail(id);
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
    return this.groups.delete(id);
  }

  @Put(":id/members")
  setMembers(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdminSetSpotGroupMembersSchema))
    dto: AdminSetSpotGroupMembersDto,
  ) {
    return this.groups.setMembers(id, dto.userIds);
  }

  @Put(":id/spots")
  setSpots(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdminSetSpotGroupSpotsSchema))
    dto: AdminSetSpotGroupSpotsDto,
  ) {
    return this.groups.setSpots(id, dto.spotIds);
  }
}
