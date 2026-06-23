import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { ClosuresModule } from "../closures/closures.module";
import { AdminReservationsController } from "./admin-reservations.controller";
import { ReservationsController } from "./reservations.controller";
import { ReservationsService } from "./reservations.service";

@Module({
  // ClosuresModule esporta ClosuresService, che ReservationsService consuma in
  // create() per il check "giorno bloccato".
  imports: [UsersModule, ClosuresModule],
  controllers: [ReservationsController, AdminReservationsController],
  providers: [ReservationsService],
  // Esportato per riuso in ManagerModule (endpoint /manager/* scoped riporti).
  exports: [ReservationsService],
})
export class ReservationsModule {}
