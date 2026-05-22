"use client";

import { signIn } from "next-auth/react";
import { Button, Tile } from "@carbon/react";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <Tile>
        <h1 style={{ marginBottom: "0.5rem" }}>Reservation App</h1>
        <p style={{ marginBottom: "2rem", color: "#525252" }}>
          Accedi per prenotare posti auto e scrivanie.
        </p>
        <Button onClick={() => signIn("google", { callbackUrl: "/my-reservations" })}>
          Accedi con Google
        </Button>
      </Tile>
    </main>
  );
}
