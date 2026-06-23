"use client";

import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button, Tile } from "@carbon/react";
import Image from "next/image";

interface Props {
  // Flag calcolati lato server dalla presenza delle env var
  // (GOOGLE_CLIENT_ID / AUTH_IBMSSO_ID). Un metodo di login è mostrato solo
  // se il rispettivo provider è configurato.
  googleEnabled: boolean;
  ibmssoEnabled: boolean;
}

// I bottoni usano `useSearchParams` (per il callbackUrl) → vanno isolati in
// un componente sotto `<Suspense>`, altrimenti Next.js 14 fallisce il
// prerender ("missing-suspense-with-csr-bailout").
function LoginButtons({ googleEnabled, ibmssoEnabled }: Props) {
  // `callbackUrl` valorizzato dal middleware withAuth quando l'utente arriva
  // qui da una pagina protetta; fallback a "/" così page.tsx (home) fa la
  // dispatch per ruolo (ADMIN → /admin/reservations, USER → /my-reservations).
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";

  // Edge case: nessun provider configurato (entrambe le env mancanti).
  if (!googleEnabled && !ibmssoEnabled) {
    return (
      <p style={{ color: "#da1e28" }}>
        Nessun metodo di accesso configurato. Contatta l&apos;amministratore.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {googleEnabled && (
        <Button onClick={() => signIn("google", { callbackUrl })}>
          Accedi con Google
        </Button>
      )}
      {/* Separatore "oppure" solo quando entrambi i metodi sono disponibili. */}
      {googleEnabled && ibmssoEnabled && (
        <span style={{ color: "#525252", fontSize: "0.875rem" }}>oppure</span>
      )}
      {ibmssoEnabled && (
        <Button
          onClick={() => signIn("ibmsso", { callbackUrl })}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
        >
          <span>Accedi con IBM w3 SSO</span>
          <Image src="/ibmsso.svg" alt="" width={28} height={28} priority />
        </Button>
      )}
    </div>
  );
}

export function LoginPanel({ googleEnabled, ibmssoEnabled }: Props) {
  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <Tile>
        <h1 style={{ marginBottom: "0.5rem" }}>Reservation App</h1>
        <p style={{ marginBottom: "2rem", color: "#525252" }}>
          Accedi per prenotare posti auto e scrivanie.
        </p>
        <Suspense fallback={<Button disabled>Caricamento…</Button>}>
          <LoginButtons googleEnabled={googleEnabled} ibmssoEnabled={ibmssoEnabled} />
        </Suspense>
      </Tile>
    </main>
  );
}
