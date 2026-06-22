-- Audit (C5): chi ha creato / cancellato una prenotazione.
-- Entrambe nullable: i record legacy (pre-migration) restano NULL → la UI
-- mostra "—". Nessun backfill.
--
-- onDelete: SET NULL — cancellare un User che era solo "attore" (admin che
-- ha creato/cancellato per conto di altri) non deve cancellare a cascata le
-- prenotazioni: si perde solo il riferimento all'attore.

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "cancelledByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Reservation_createdByUserId_idx" ON "Reservation"("createdByUserId");
CREATE INDEX "Reservation_cancelledByUserId_idx" ON "Reservation"("cancelledByUserId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
