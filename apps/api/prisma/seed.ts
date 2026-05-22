import { PrismaClient, SpotType, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[seed] cleaning existing data...");
  await prisma.reservation.deleteMany();
  await prisma.spot.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.floor.deleteMany();
  await prisma.site.deleteMany();
  await prisma.user.deleteMany();

  console.log("[seed] creating sites/floors/zones/spots...");

  const milano = await prisma.site.create({
    data: {
      code: "MI-01",
      name: "Milano Sede Centrale",
      floors: {
        create: [
          {
            name: "Piano Terra (Parcheggio)",
            zones: {
              create: [{ name: "Zona A" }, { name: "Zona B" }],
            },
          },
          {
            name: "Piano 1",
            zones: {
              create: [{ name: "Open Space Nord" }, { name: "Open Space Sud" }],
            },
          },
          {
            name: "Piano 2",
            zones: {
              create: [{ name: "Area Riunioni" }, { name: "Area Operativa" }],
            },
          },
        ],
      },
    },
    include: { floors: { include: { zones: true } } },
  });

  const roma = await prisma.site.create({
    data: {
      code: "RM-01",
      name: "Roma Eur",
      floors: {
        create: [
          {
            name: "Piano Terra (Parcheggio)",
            zones: { create: [{ name: "Zona Unica" }] },
          },
          {
            name: "Piano 1",
            zones: { create: [{ name: "Open Space" }] },
          },
        ],
      },
    },
    include: { floors: { include: { zones: true } } },
  });

  // Milano: parcheggio (Piano Terra) — 15 posti distribuiti su Zona A/B
  const miPark = milano.floors.find((f) => f.name.includes("Parcheggio"))!;
  const miParkSpots = Array.from({ length: 15 }, (_, i) => ({
    code: `P-${String(i + 1).padStart(3, "0")}`,
    type: SpotType.PARKING,
    floorId: miPark.id,
    zoneId: miPark.zones[i % miPark.zones.length].id,
  }));

  // Milano: scrivanie ai piani 1 e 2 — 10 ciascuno
  const miFloor1 = milano.floors.find((f) => f.name === "Piano 1")!;
  const miFloor2 = milano.floors.find((f) => f.name === "Piano 2")!;
  const miDeskSpots = [
    ...Array.from({ length: 10 }, (_, i) => ({
      code: `D1-${String(i + 1).padStart(3, "0")}`,
      type: SpotType.DESK,
      floorId: miFloor1.id,
      zoneId: miFloor1.zones[i % miFloor1.zones.length].id,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      code: `D2-${String(i + 1).padStart(3, "0")}`,
      type: SpotType.DESK,
      floorId: miFloor2.id,
      zoneId: miFloor2.zones[i % miFloor2.zones.length].id,
    })),
  ];

  // Roma: 8 posti auto + 8 scrivanie
  const rmPark = roma.floors.find((f) => f.name.includes("Parcheggio"))!;
  const rmFloor1 = roma.floors.find((f) => f.name === "Piano 1")!;
  const rmSpots = [
    ...Array.from({ length: 8 }, (_, i) => ({
      code: `RP-${String(i + 1).padStart(3, "0")}`,
      type: SpotType.PARKING,
      floorId: rmPark.id,
      zoneId: rmPark.zones[0].id,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      code: `RD-${String(i + 1).padStart(3, "0")}`,
      type: SpotType.DESK,
      floorId: rmFloor1.id,
      zoneId: rmFloor1.zones[0].id,
    })),
  ];

  await prisma.spot.createMany({
    data: [...miParkSpots, ...miDeskSpots, ...rmSpots],
  });

  console.log("[seed] creating test users...");
  // Utenti di seed senza identificatori IdP: servono solo come dati di test per le prenotazioni.
  // Gli utenti reali vengono provisionati al primo login (Google/Entra).
  await prisma.user.createMany({
    data: [
      {
        email: "admin@test.local",
        displayName: "Admin Test",
        role: Role.ADMIN,
      },
      {
        email: "user@test.local",
        displayName: "Mario Rossi",
        role: Role.USER,
      },
    ],
  });

  const counts = {
    sites: await prisma.site.count(),
    floors: await prisma.floor.count(),
    zones: await prisma.zone.count(),
    spots: await prisma.spot.count(),
    users: await prisma.user.count(),
  };
  console.log("[seed] done:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
