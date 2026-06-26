import { Module } from "@nestjs/common";
import { ClosuresModule } from "../closures/closures.module";
import { SpotGroupsModule } from "../spot-groups/spot-groups.module";
import { UsersModule } from "../users/users.module";
import { AdminSpotsController } from "./admin-spots.controller";
import { SpotsController } from "./spots.controller";
import { SpotsService } from "./spots.service";

@Module({
  // ClosuresModule  → flag `closed` (giorni bloccati).
  // SpotGroupsModule → eligibilità riserva (lockedForMe) su list/availability.
  // UsersModule      → i controller risolvono l'utente del token (eligibilità).
  imports: [ClosuresModule, SpotGroupsModule, UsersModule],
  controllers: [SpotsController, AdminSpotsController],
  providers: [SpotsService],
  // Esportato per riuso in ManagerModule (endpoint /manager/spots).
  exports: [SpotsService],
})
export class SpotsModule {}
