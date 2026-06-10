import { Controller, Get, Query, UseGuards, UsePipes } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  SpotsQuerySchema,
  SpotsAvailabilityQuerySchema,
  type SpotsQuery,
  type SpotsAvailabilityQuery,
} from "@reservation/shared";
import { SpotsService } from "./spots.service";

@Controller("spots")
@UseGuards(JwtAuthGuard)
export class SpotsController {
  constructor(private spots: SpotsService) {}

  // `availability` deve precedere il GET root (Nest applica il primo match):
  // /spots/availability altrimenti finirebbe nel route matcher di list().
  @Get("availability")
  @UsePipes(new ZodValidationPipe(SpotsAvailabilityQuerySchema))
  availability(@Query() q: SpotsAvailabilityQuery) {
    return this.spots.availability(q);
  }

  @Get()
  @UsePipes(new ZodValidationPipe(SpotsQuerySchema))
  list(@Query() q: SpotsQuery) {
    return this.spots.list(q);
  }
}
