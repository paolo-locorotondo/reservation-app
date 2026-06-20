import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AdminReservationsController } from "./admin-reservations.controller";
import { ReservationsController } from "./reservations.controller";
import { ReservationsService } from "./reservations.service";

@Module({
  imports: [UsersModule],
  controllers: [ReservationsController, AdminReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
