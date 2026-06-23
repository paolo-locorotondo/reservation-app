import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { ReservationsModule } from "../reservations/reservations.module";
import { SpotsModule } from "../spots/spots.module";
import { ManagerScopeService } from "./manager-scope.service";
import { ManagerReservationsController } from "./manager-reservations.controller";
import { ManagerUsersController } from "./manager-users.controller";
import { ManagerSpotsController } from "./manager-spots.controller";

// Endpoint /manager/* per gli utenti con ruolo MANAGER: speculari agli
// /admin/* ma scoped ai propri riporti diretti + sé stesso. Riusano
// ReservationsService / SpotsService / UsersService (esportati dai rispettivi
// moduli) passando lo scope risolto da ManagerScopeService.
@Module({
  imports: [UsersModule, ReservationsModule, SpotsModule],
  controllers: [
    ManagerReservationsController,
    ManagerUsersController,
    ManagerSpotsController,
  ],
  providers: [ManagerScopeService],
})
export class ManagerModule {}
