import { Module } from "@nestjs/common";
import { AdminSpotGroupsController } from "./admin-spot-groups.controller";
import { SpotGroupsService } from "./spot-groups.service";

@Module({
  controllers: [AdminSpotGroupsController],
  providers: [SpotGroupsService],
  // Esportato per l'eligibilità: SpotsService (flag lockedForMe su listSpots /
  // availability) e ReservationsService (403 in create, skip nel bulk).
  exports: [SpotGroupsService],
})
export class SpotGroupsModule {}
