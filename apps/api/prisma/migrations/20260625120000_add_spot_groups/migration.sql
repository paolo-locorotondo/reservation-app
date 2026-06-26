-- Postazioni riservate (C7 + C7.1): gruppi di riserva + assegnazione spot +
-- membership ESCLUSIVA (un utente sta in al più un gruppo, FK su User).

-- CreateTable
CREATE TABLE "SpotGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpotGroup_name_key" ON "SpotGroup"("name");

-- AlterTable: Spot.reservedGroupId (spot riservato a 0/1 gruppo)
ALTER TABLE "Spot" ADD COLUMN "reservedGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Spot_reservedGroupId_idx" ON "Spot"("reservedGroupId");

-- AddForeignKey
ALTER TABLE "Spot" ADD CONSTRAINT "Spot_reservedGroupId_fkey" FOREIGN KEY ("reservedGroupId") REFERENCES "SpotGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: User.reservedGroupId (membership esclusiva — 1:N, non M:N)
ALTER TABLE "User" ADD COLUMN "reservedGroupId" TEXT;

-- CreateIndex
CREATE INDEX "User_reservedGroupId_idx" ON "User"("reservedGroupId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reservedGroupId_fkey" FOREIGN KEY ("reservedGroupId") REFERENCES "SpotGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
