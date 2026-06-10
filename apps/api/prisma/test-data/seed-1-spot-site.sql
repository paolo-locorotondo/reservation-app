-- Test data: una sede con UN SOLO posto auto e nessuna scrivania, utile per
-- testare l'esaurimento ("posti pieni" → pallino rosso nel calendario, riga
-- rossa nella lista, 409 alla seconda prenotazione).
--
-- USO:
--   psql "$DATABASE_URL" -f apps/api/prisma/test-data/seed-1-spot-site.sql
-- oppure incolla il blocco nello SQL editor di Supabase.
--
-- Idempotente: il blocco DELETE iniziale ripulisce le righe precedenti se lo
-- rilanci. Non tocca le altre sedi del seed principale.
--
-- Gli ID sono stringhe statiche con prefisso "test-" (lo schema usa cuid
-- generati applicativamente da Prisma, ma a livello DB la colonna è text
-- libera: qualsiasi stringa unica va bene).

BEGIN;

-- 1) Cleanup precedente (in ordine: figli → padri per non violare FK).
DELETE FROM "Reservation"
  WHERE "spotId" IN (SELECT id FROM "Spot" WHERE "floorId" IN ('test-floor-0posto','test-floor-1posto'));
DELETE FROM "Spot"  WHERE id IN ('test-spot-1posto', 'test-spot-2posto');
DELETE FROM "Zone"  WHERE id IN ('test-zone-0posto', 'test-zone-1posto');
DELETE FROM "Floor" WHERE id IN ('test-floor-0posto', 'test-floor-1posto');
DELETE FROM "Site"  WHERE id = 'test-site-1posto';

-- 2) Sede di test
INSERT INTO "Site" (id, code, name)
VALUES (
  'test-site-1posto',
  'TEST-1POSTO',
  'Sede di Test (1 posto)'
);

-- 3) Due piani con una zona ciascuno
-- parcheggio: piano 0
INSERT INTO "Floor" (id, "siteId", name)
VALUES (
  'test-floor-0posto',
  'test-site-1posto',
  'Parcheggio Unico Test '
);
-- parcheggio: zona unica
INSERT INTO "Zone" (id, "floorId", name)
VALUES (
  'test-zone-0posto',
  'test-floor-0posto',
  'Zona Unica Parcheggio Test'
);
-- ufficio: piano 1
INSERT INTO "Floor" (id, "siteId", name)
VALUES (
  'test-floor-1posto',
  'test-site-1posto',
  'Primo Piano Test'
);
-- ufficio: zona unica
INSERT INTO "Zone" (id, "floorId", name)
VALUES (
  'test-zone-1posto',
  'test-floor-1posto',
  'Zona Unica Uffici Test'
);

-- 4) Un solo posto auto
INSERT INTO "Spot" (id, code, type, "floorId", "zoneId", active)
VALUES (
  'test-spot-1posto',
  'P-001',
  'PARKING',
  'test-floor-0posto',
  'test-zone-0posto',
  true
);

-- 5) Una sola scrivania
INSERT INTO "Spot" (id, code, type, "floorId", "zoneId", active)
VALUES (
  'test-spot-2posto',
  'D-001',
  'DESK',
  'test-floor-1posto',
  'test-zone-1posto',
  true
);

COMMIT;

-- Verifica:
--   SELECT s.code, s.type, f.name AS floor, st.name AS site
--   FROM "Spot" s
--   JOIN "Floor" f ON f.id = s."floorId"
--   JOIN "Site"  st ON st.id = f."siteId"
--   WHERE st.code = 'TEST-1POSTO';
