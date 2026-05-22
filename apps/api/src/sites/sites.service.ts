import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SitesService {
  constructor(private prisma: PrismaService) {}

  listSites() {
    return this.prisma.site.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    });
  }

  async listFloors(siteId: string) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException("site not found");
    return this.prisma.floor.findMany({
      where: { siteId },
      orderBy: { name: "asc" },
      select: { id: true, siteId: true, name: true },
    });
  }
}
