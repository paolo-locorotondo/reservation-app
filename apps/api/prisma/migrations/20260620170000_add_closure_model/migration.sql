-- Aggiunge la tabella Closure (giorni bloccati / festività / chiusure di sede).
-- Le prenotazioni non possono essere CREATE per giorni che matchano una Closure.
--
-- Match logic (lato applicazione, non SQL):
--   spot blocked := exists Closure C where
--     C.date = dto.date
--     AND (C.siteId IS NULL OR C.siteId = spot.floor.siteId)
--     AND (C.spotType IS NULL OR C.spotType = spot.type)
--
-- Niente UNIQUE su (date, siteId, spotType): permettiamo closure sovrapposte
-- (es. globale "Natale" + locale "Lavori a Bari").

-- CreateTable
CREATE TABLE "Closure" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "siteId" TEXT,
    "spotType" "SpotType",
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "Closure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Closure_date_idx" ON "Closure"("date");

-- CreateIndex
CREATE INDEX "Closure_siteId_date_idx" ON "Closure"("siteId", "date");

-- AddForeignKey
ALTER TABLE "Closure" ADD CONSTRAINT "Closure_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Closure" ADD CONSTRAINT "Closure_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
