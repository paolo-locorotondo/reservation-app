import { Button } from "@carbon/react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) {
    // Atterraggio per ruolo:
    //   ADMIN → pagina di amministrazione (panoramica del sistema)
    //   USER  → "Le mie prenotazioni" (dashboard naturale: vede subito le sue
    //           prenotazioni attive e da lì decide se prenotare nuove via
    //           "Prenota qui i posti auto / la tua scrivania")
    // Le altre voci nav restano comunque tutte raggiungibili.
    redirect(
      session.user?.role === "ADMIN" ? "/admin/reservations" : "/my-reservations",
    );
  }

  return (
    <main className="rsv-auth-main">
      <div className="rsv-auth-card">
        <div className="rsv-auth-bar" />
        <h1 style={{ marginBottom: "0.75rem" }}>
          <strong>IBM</strong> Reservation App
        </h1>
        <p style={{ marginBottom: "1.5rem", color: "#525252", lineHeight: 1.5 }}>
          Prenotazione posti auto e scrivanie nelle sedi IBM
        </p>
        <p style={{ marginBottom: "1.5rem", color: "#525252", lineHeight: 1.5 }}>
          Per usare l&apos;applicazione accedi col tuo account aziendale.
        </p>
        <Link href="/login">
          <Button>Vai al login</Button>
        </Link>
      </div>
    </main>
  );
}
