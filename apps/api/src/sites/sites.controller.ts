import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SitesService } from "./sites.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class SitesController {
  constructor(private sites: SitesService) {}

  @Get("sites")
  listSites() {
    return this.sites.listSites();
  }

  @Get("sites/:id/floors")
  listFloors(@Param("id") id: string) {
    return this.sites.listFloors(id);
  }
}
