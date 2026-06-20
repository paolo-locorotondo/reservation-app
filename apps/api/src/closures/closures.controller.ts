import { BadRequestException, Controller, Get, Query, UseGuards, UsePipes } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ClosuresQuerySchema, type ClosuresQuery } from "@reservation/shared";
import { ClosuresService } from "./closures.service";

// Lista user-level delle chiusure (no admin guard). Usata dai calendari
// utente come overlay informativo: in /my-reservations non sappiamo a
// priori le sedi di interesse, quindi mostriamo TUTTE le chiusure del
// periodo che potrebbero affettare le sue prenotazioni.
//
// L'output è compatto (date + reason) — gli utenti non hanno bisogno di
// vedere chi le ha create né su quale sede specifica si applichino.
@Controller("closures")
@UseGuards(JwtAuthGuard)
export class ClosuresController {
  constructor(private closures: ClosuresService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(ClosuresQuerySchema))
  async list(@Query() q: ClosuresQuery) {
    const from = q.from ? parseDateOnly(q.from) : undefined;
    const to = q.to ? parseDateOnly(q.to) : undefined;
    return this.closures.listForUser({ from, to, spotType: q.type });
  }
}

function parseDateOnly(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("data non valida");
  }
  return date;
}
