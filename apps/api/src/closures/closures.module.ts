import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AdminClosuresController } from "./admin-closures.controller";
import { ClosuresController } from "./closures.controller";
import { ClosuresService } from "./closures.service";

@Module({
  imports: [UsersModule],
  controllers: [AdminClosuresController, ClosuresController],
  providers: [ClosuresService],
  // Esportato per riuso in ReservationsService (check pre-create) e in
  // SpotsService (closed flag su availability + filtro listSpots).
  exports: [ClosuresService],
})
export class ClosuresModule {}
