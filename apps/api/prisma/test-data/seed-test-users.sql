-- Test data: 600 utenti generati con Postgres `generate_series()`. Servono
-- soprattutto a stressare il filtro MultiSelect "Utenti" della pagina admin
-- e a verificare che a quel volume il dropdown resti reattivo.
--
-- USO:
--   psql "$DATABASE_URL" -f apps/api/prisma/test-data/seed-test-users.sql
-- oppure incolla nel SQL editor di Supabase.
--
-- Idempotente: il blocco DELETE iniziale ripulisce le righe precedenti se
-- rilanciato. NON tocca utenti reali (cleanup filtra per id LIKE 'test-user-%').
--
-- `lpad(i, 3, '0')` produce "001", "002", ..., "600": così il sort
-- alfabetico per `displayName` (default del backend) restituisce gli utenti
-- in ordine numerico naturale anche nel dropdown.

BEGIN;

-- 1) Cleanup precedente. La FK Reservation.userId → User.id ha onDelete:
-- Cascade quindi le reservation dei test-user vengono droppate in cascata,
-- ma esplicitiamo prima per essere sicuri (e più veloce in batch grandi).
DELETE FROM "Reservation" WHERE "userId" LIKE 'test-user-%';
DELETE FROM "Account"     WHERE "userId" LIKE 'test-user-%';
DELETE FROM "User"        WHERE id LIKE 'test-user-%';

-- 2) Insert massivo: 600 righe da una sola query.
INSERT INTO "User" (id, email, "displayName", role, "updatedAt")
SELECT
  'test-user-'  || lpad(i::text, 3, '0'),
  'user.'       || lpad(i::text, 3, '0') || '@example.com',
  'Utente '     || lpad(i::text, 3, '0'),
  'USER',
  NOW()
FROM generate_series(1, 600) AS i;

COMMIT;

-- Verifica:
--   SELECT COUNT(*) FROM "User" WHERE id LIKE 'test-user-%';   -- atteso: 600
--   SELECT "displayName" FROM "User" WHERE id LIKE 'test-user-%' ORDER BY "displayName" LIMIT 5;
--   -- atteso: Utente 001, Utente 002, ..., Utente 005
