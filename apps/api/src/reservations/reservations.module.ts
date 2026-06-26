import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { ClosuresModule } from "../closures/closures.module";
import { SpotGroupsModule } from "../spot-groups/spot-groups.module";
import { AdminReservationsController } from "./admin-reservations.controller";
import { ReservationsController } from "./reservations.controller";
import { ReservationsService } from "./reservations.service";

@Module({
  // ClosuresModule  → check "giorno bloccato" in create().
  // SpotGroupsModule → check riserva (eligibilità gruppo) in create()/bulkCreate().
  imports: [UsersModule, ClosuresModule, SpotGroupsModule],
  controllers: [ReservationsController, AdminReservationsController],
  providers: [ReservationsService],
  // Esportato per riuso in ManagerModule (endpoint /manager/* scoped riporti).
  exports: [ReservationsService],
})
export class ReservationsModule {}
