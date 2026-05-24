// Entry-point serverless per Vercel: una singola Function catch-all che instrada
// TUTTI i path `/api/*` verso l'app NestJS. Su Vercel, i file dentro `api/` sono
// Functions; `[[...slug]]` matcha qualunque profondità di segmenti, inclusa la
// root `/api`.
//
// Strategia anti cold-start: bootstrap di Nest UNA sola volta per istanza Lambda
// e cache dell'Express handler in una variabile module-scope. Le invocazioni
// successive sulla stessa istanza riusano l'handler già pronto (~5–20ms invece
// dei ~1–3s del primo avvio).
//
// Nota: replichiamo qui le stesse impostazioni di `src/main.ts` (globalPrefix,
// ValidationPipe) MENO `app.listen()`. Su Vercel non c'è un server HTTP nostro:
// è la piattaforma a invocare l'handler Express che esponiamo.

import "reflect-metadata";
import type { IncomingMessage, ServerResponse } from "http";
import type { Express } from "express";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { AppModule } from "../src/app.module";

let cachedHandler: Express | null = null;

async function bootstrap(): Promise<Express> {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    cors: false,
    logger: ["error", "warn"],
  });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return expressApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!cachedHandler) {
    cachedHandler = await bootstrap();
  }
  cachedHandler(req as never, res as never);
}
