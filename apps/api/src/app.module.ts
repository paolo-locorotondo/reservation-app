import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthController } from "./health/health.controller";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { SitesModule } from "./sites/sites.module";
import { SpotsModule } from "./spots/spots.module";
import { ReservationsModule } from "./reservations/reservations.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    SitesModule,
    SpotsModule,
    ReservationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
