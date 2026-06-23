-- Aggiunge il ruolo MANAGER all'enum Role e la colonna User.managerEmail.
--
-- MANAGER è derivato al login dal claim w3id `ibmEdIsManager === "Y"`
-- (vedi apps/web/src/lib/auth.ts). `managerEmail` (dal claim w3id omonimo)
-- permette di ricostruire la gerarchia: i riporti diretti di un manager
-- sono gli User con managerEmail = email del manager.
--
-- Nota Postgres: `ALTER TYPE ... ADD VALUE` è sicuro in transazione su PG 12+
-- finché il nuovo valore NON viene usato nella stessa transazione (qui non lo
-- usiamo: aggiungiamo solo enum + colonna). Supabase è PG 15.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MANAGER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "managerEmail" TEXT;

-- CreateIndex
CREATE INDEX "User_managerEmail_idx" ON "User"("managerEmail");
