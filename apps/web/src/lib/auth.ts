import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import jwt from "jsonwebtoken";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

// Allinea User.role nel DB col role appena calcolato dal JWT NextAuth.
// Chiamiamo l'API NestJS `GET /me` (che internamente esegue
// `provisionFromToken`, riapplicando role + displayName a DB).
//
// Side effect non bloccante: errori di rete/backend non rompono il login.
// Replica la firma JWT del proxy BFF (apps/web/src/app/api/proxy/...),
// usando lo stesso `NEXTAUTH_SECRET` che l'API verifica via passport-jwt.
async function syncRoleToBackend(payload: {
  sub: string;
  provider: string;
  email: string;
  name?: string | null;
  role: "USER" | "ADMIN";
}): Promise<void> {
  const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001";
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.warn("[auth] NEXTAUTH_SECRET not set; skipping DB role sync");
    return;
  }
  try {
    const apiJwt = jwt.sign(
      {
        sub: payload.sub,
        provider: payload.provider,
        email: payload.email,
        name: payload.name ?? undefined,
        role: payload.role,
      },
      secret,
      { algorithm: "HS256", expiresIn: "1h" },
    );
    const url = new URL("/api/me", apiUrl);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${apiJwt}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[auth] DB role sync got ${res.status}: ${await res.text()}`);
    }
  } catch (e) {
    console.error("[auth] DB role sync failed:", e);
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    // Arricchisce il JWT al primo login: i campi `account` e `profile` sono
    // disponibili solo in quel momento. Salviamo provider, sub stabile e ruolo
    // così il BFF può ri-firmare un JWT pulito per l'API.
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.provider = account.provider;
        token.providerSub = account.providerAccountId;
        token.email = profile.email ?? token.email;
        token.name = profile.name ?? token.name;
        token.role = isAdmin(profile.email) ? "ADMIN" : "USER";

        // Allinea User.role del DB col role appena calcolato. Side effect
        // fire-and-forget: il login non blocca se la sync fallisce. Senza
        // questa, il DB resterebbe "drift" da `ADMIN_EMAILS` perché nessun
        // consumer dell'app chiama mai `/me` a runtime.
        if (token.email && token.providerSub && token.provider) {
          void syncRoleToBackend({
            sub: token.providerSub,
            provider: token.provider,
            email: token.email,
            name: token.name,
            role: token.role,
          });
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as "USER" | "ADMIN") ?? "USER";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
