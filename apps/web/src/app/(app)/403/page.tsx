import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main>
      <h1 style={{ marginBottom: "0.25rem" }}>Accesso negato</h1>
      <p style={{ marginBottom: "1.5rem", color: "#525252" }}>
        Non hai i permessi per visualizzare questa pagina. Se ritieni sia un
        errore, contatta un amministratore.
      </p>

      <p>
        <Link href="/parking">← Torna ai posti auto</Link>
      </p>
    </main>
  );
}
