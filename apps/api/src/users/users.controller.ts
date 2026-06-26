import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt.strategy";
import { UsersService } from "./users.service";

@Controller("me")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  async me(@CurrentUser() payload: JwtPayload) {
    const user = await this.users.provisionFromToken(payload);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      // Gruppo di riserva di appartenenza (C7.1), null se nessuno. Letto fresco
      // da DB (non è nel JWT, congelato al login): l'admin può assegnarlo dopo.
      reservedGroupName: await this.users.getReservedGroupName(user.id),
    };
  }
}
