import { Module } from "@nestjs/common";
import { ClosuresModule } from "../closures/closures.module";
import { AdminSpotsController } from "./admin-spots.controller";
import { SpotsController } from "./spots.controller";
import { SpotsService } from "./spots.service";

@Module({
  // ClosuresModule esporta ClosuresService, usato da SpotsService per il
  // flag `closed` su listAvailability e per la response di listSpots su
  // giorno bloccato.
  imports: [ClosuresModule],
  controllers: [SpotsController, AdminSpotsController],
  providers: [SpotsService],
  // Esportato per riuso in ManagerModule (endpoint /manager/spots).
  exports: [SpotsService],
})
export class SpotsModule {}
