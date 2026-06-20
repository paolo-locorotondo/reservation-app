import { Tile, Button } from "@carbon/react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) {
    // Gli admin atterrano direttamente sulla pagina di amministrazione, gli
    // altri sul booking. Le voci nav restano comunque tutte raggiungibili,
    // questo è solo l'atterraggio "primo accesso" più sensato per ruolo.
    redirect(session.user?.role === "ADMIN" ? "/admin/reservations" : "/parking");
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "720px" }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Reservation App</h1>
      <p style={{ marginBottom: "2rem", color: "#525252" }}>
        Prenotazione posti auto e scrivanie nelle sedi IBM.
      </p>
      <Tile>
        <h3 style={{ marginBottom: "1rem" }}>Accedi</h3>
        <p style={{ marginBottom: "1rem" }}>
          Per usare l&apos;applicazione devi autenticarti col tuo account aziendale.
        </p>
        <Link href="/login">
          <Button>Vai al login</Button>
        </Link>
      </Tile>
    </main>
  );
}
