-- 1) Aggiungi la colonna come nullable (per non rompere le righe esistenti).
ALTER TABLE "Reservation" ADD COLUMN "spotType" "SpotType";

-- 2) Backfill: popola spotType da Spot.type per ogni reservation esistente.
UPDATE "Reservation" r
SET "spotType" = s."type"
FROM "Spot" s
WHERE r."spotId" = s."id";

-- 3) Imposta NOT NULL adesso che tutte le righe hanno valore.
ALTER TABLE "Reservation" ALTER COLUMN "spotType" SET NOT NULL;

-- 4) Partial unique index: "max 1 ACTIVE per utente/giorno/tipo".
--    Stesso pattern dell'altro partial unique sullo (spotId, date) ACTIVE:
--    non impedisce CANCELLED storiche multiple, garanzia DB-level che
--    sopravvive a bug applicativi e a race condition (doppio submit ravvicinato).
CREATE UNIQUE INDEX "Reservation_userId_date_spotType_active_key"
  ON "Reservation" ("userId", "date", "spotType")
  WHERE "status" = 'ACTIVE';
