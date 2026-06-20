"use client";

import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button, Tile } from "@carbon/react";

// `useSearchParams()` impedisce il prerender statico della pagina (richiede il
// bailout a CSR). Next.js 14 esige che sia isolato dentro a un `<Suspense>`
// boundary, altrimenti il build production fallisce con
// "missing-suspense-with-csr-bailout". Estraiamo il bottone in un sub-componente
// così solo lui resta dynamic — il resto della pagina (titolo + paragrafo) può
// essere prerenderizzato.
function LoginButton() {
  // `callbackUrl` valorizzato dal middleware withAuth quando l'utente arriva
  // qui da una pagina protetta (es. /admin/reservations → redirect a
  // /login?callbackUrl=/admin/reservations); fallback a "/" così page.tsx
  // può fare la dispatch per ruolo (ADMIN → /admin/reservations, USER →
  // /my-reservations). Forzare un path fisso qui bypasserebbe entrambi i
  // comportamenti.
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  return (
    <Button onClick={() => signIn("google", { callbackUrl })}>
      Accedi con Google
    </Button>
  );
}

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <Tile>
        <h1 style={{ marginBottom: "0.5rem" }}>Reservation App</h1>
        <p style={{ marginBottom: "2rem", color: "#525252" }}>
          Accedi per prenotare posti auto e scrivanie.
        </p>
        {/* Fallback identico al render finale per evitare CLS: il bottone è
            l'unico contenuto dinamico, mostriamo subito un placeholder dello
            stesso ingombro. */}
        <Suspense fallback={<Button disabled>Accedi con Google</Button>}>
          <LoginButton />
        </Suspense>
      </Tile>
    </main>
  );
}
