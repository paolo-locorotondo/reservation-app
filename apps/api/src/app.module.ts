import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthController } from "./health/health.controller";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { SitesModule } from "./sites/sites.module";
import { SpotsModule } from "./spots/spots.module";
import { ReservationsModule } from "./reservations/reservations.module";
import { ClosuresModule } from "./closures/closures.module";
import { ManagerModule } from "./manager/manager.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    SitesModule,
    SpotsModule,
    ReservationsModule,
    ClosuresModule,
    ManagerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
