import { Module } from "@nestjs/common";
import { AdminSpotsController } from "./admin-spots.controller";
import { SpotsController } from "./spots.controller";
import { SpotsService } from "./spots.service";

@Module({
  controllers: [SpotsController, AdminSpotsController],
  providers: [SpotsService],
})
export class SpotsModule {}
