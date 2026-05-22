-- Sostituisce la unique piena (spotId, date, status) con un partial unique
-- index sulle sole prenotazioni ACTIVE: vincola "max 1 ACTIVE per spot/giorno"
-- senza impedire la coesistenza di più CANCELLED storiche sullo stesso slot.
DROP INDEX "Reservation_spotId_date_status_key";

CREATE UNIQUE INDEX "Reservation_spotId_date_active_key"
  ON "Reservation" ("spotId", "date")
  WHERE "status" = 'ACTIVE';
