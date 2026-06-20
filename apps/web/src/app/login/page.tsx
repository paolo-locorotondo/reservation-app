"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button, Tile } from "@carbon/react";

export default function LoginPage() {
  // `callbackUrl` valorizzato dal middleware withAuth quando l'utente arriva
  // qui da una pagina protetta (es. /admin/reservations → redirect a
  // /login?callbackUrl=/admin/reservations); fallback a "/" così page.tsx
  // può fare la dispatch per ruolo (ADMIN → /admin/reservations, USER →
  // /my-reservations). Forzare un path fisso qui bypasserebbe entrambi i
  // comportamenti.
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <Tile>
        <h1 style={{ marginBottom: "0.5rem" }}>Reservation App</h1>
        <p style={{ marginBottom: "2rem", color: "#525252" }}>
          Accedi per prenotare posti auto e scrivanie.
        </p>
        <Button onClick={() => signIn("google", { callbackUrl })}>
          Accedi con Google
        </Button>
      </Tile>
    </main>
  );
}
