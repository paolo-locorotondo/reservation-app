import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const dbOk = await this.prisma
      .$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);

    return {
      status: dbOk ? "ok" : "degraded",
      service: "reservation-api",
      db: dbOk ? "up" : "down",
      timestamp: new Date().toISOString(),
    };
  }
}
