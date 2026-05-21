import { Tile, Tag } from "@carbon/react";

async function fetchHealth(): Promise<{
  status: string;
  service: string;
  db: string;
  timestamp: string;
} | null> {
  try {
    const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001";
    const res = await fetch(`${apiUrl}/api/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function Home() {
  const health = await fetchHealth();
  const apiUp = health?.status === "ok";
  const dbUp = health?.db === "up";

  return (
    <main>
      <h1 style={{ marginBottom: "0.5rem" }}>Reservation App</h1>
      <p style={{ marginBottom: "2rem", color: "#525252" }}>
        Prenotazione posti auto e scrivanie — Sprint 0 (bootstrap)
      </p>

      <Tile style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginBottom: "1rem" }}>Stato dei servizi</h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Tag type={apiUp ? "green" : "red"}>API: {apiUp ? "ok" : "non raggiungibile"}</Tag>
          <Tag type={dbUp ? "green" : "red"}>DB: {dbUp ? "up" : "down"}</Tag>
        </div>
        {health && (
          <pre
            style={{
              marginTop: "1rem",
              padding: "0.75rem",
              background: "#f4f4f4",
              fontSize: "0.85rem",
              overflowX: "auto",
            }}
          >
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
      </Tile>

      <Tile>
        <h3 style={{ marginBottom: "0.5rem" }}>Prossimi passi</h3>
        <ul style={{ paddingLeft: "1.25rem", lineHeight: "1.75" }}>
          <li>Sprint 1 — Auth: Entra ID + NextAuth + BFF proxy</li>
          <li>Sprint 2 — Catalogo posti</li>
          <li>Sprint 3 — Prenotazioni</li>
        </ul>
      </Tile>
    </main>
  );
}
