import { Controller, Get, Query, UseGuards, UsePipes } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SpotsQuerySchema, type SpotsQuery } from "@reservation/shared";
import { SpotsService } from "./spots.service";

@Controller("spots")
@UseGuards(JwtAuthGuard)
export class SpotsController {
  constructor(private spots: SpotsService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(SpotsQuerySchema))
  list(@Query() q: SpotsQuery) {
    return this.spots.list(q);
  }
}
