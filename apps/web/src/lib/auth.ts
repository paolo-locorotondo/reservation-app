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
    {
      id: 'ibmsso', // signIn("ibmsso"), parte dell'URL di callback /api/auth/callback/ibmsso
      name: 'IBM SSO', // testo del bottone nella pagina di login
      // NextAuth v4 tipizza solo `type: 'oauth'` (non esiste 'oidc' nel union).
      // La discovery OIDC si attiva col campo `wellKnown` + `idToken: true`:
      // openid-client legge il documento di discovery e ne ricava
      // authorization_endpoint, token_endpoint, jwks_uri, ecc. Senza
      // `wellKnown` (solo `issuer`) NON fa discovery → l'errore
      // "authorization_endpoint must be configured on the issuer".
      type: 'oauth',
      issuer: 'https://preprod.login.w3.ibm.com/oidc/endpoint/default',
      // Discovery document: deve restituire un JSON con authorization_endpoint,
      // token_endpoint, jwks_uri, ecc. Verifica con:
      //   curl https://preprod.login.w3.ibm.com/oidc/endpoint/default/.well-known/openid-configuration
      wellKnown:
        'https://preprod.login.w3.ibm.com/oidc/endpoint/default/.well-known/openid-configuration',
      idToken: true,
      clientId: process.env.AUTH_IBMSSO_ID,
      clientSecret: process.env.AUTH_IBMSSO_SECRET,
      authorization: { params: { scope: 'openid profile email' } },
      // Alcuni tenant w3id non espongono `email`/`name` nell'id_token ma solo
      // via userinfo: NextAuth con type oidc fa la chiamata userinfo in automatico.
      style: { logo: "/ibmsso.svg", bg: "#fff", text: "#000" },
      profile(profile) {
        // [SPIKE Q1 — DEBUG TEMPORANEO] Dump di TUTTI i claim restituiti da
        // w3id (id_token + userinfo merge fatto da openid-client). Qui si vede
        // se esistono attributi utili per i ruoli/riporti: manager, dept,
        // employeeType, groups, ecc. RIMUOVERE prima del merge in main.
        // NB: contiene PII (email, nome, forse serial) — censura prima di
        // condividere il log.
        console.log(
          "[SPIKE-Q1] w3id profile claims:\n" + JSON.stringify(profile, null, 2),
        );
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    },
  ],
  callbacks: {
    // Arricchisce il JWT al primo login: i campi `account` e `profile` sono
    // disponibili solo in quel momento. Salviamo provider, sub stabile e ruolo
    // così il BFF può ri-firmare un JWT pulito per l'API.
    async jwt({ token, account, profile }) {
      if (account && profile) {
        // [SPIKE Q1 — DEBUG TEMPORANEO] L'`account` contiene i token grezzi:
        // id_token (JWT, decodificabile su jwt.io o con jwt.decode), access_token
        // (serve per chiamare /userinfo o Graph manualmente). RIMUOVERE prima
        // del merge in main.
        console.log(
          "[SPIKE-Q1] account (tokens):\n" + JSON.stringify(account, null, 2),
        );

        token.provider = account.provider;
        token.providerSub = account.providerAccountId;
        token.email = profile.email ?? token.email;
        token.name = profile.name ?? token.name;
        token.role = isAdmin(profile.email) ? "ADMIN" : "USER";

        // [SPIKE Q1] Cattura i claim w3id rilevanti per ruoli/gerarchia, così
        // li mostriamo nel menu account per verifica empirica. `profile` è
        // tipizzato stretto da NextAuth: castiamo a record per leggere i
        // campi custom dell'IdP IBM. Assenti per Google → token.w3id undefined.
        const p = profile as Record<string, unknown>;
        const str = (v: unknown): string | undefined =>
          typeof v === "string" && v.length > 0 ? v : undefined;
        const w3id = {
          employeeType: str(p.ibmEdEmployeeType),
          hrActive: str(p.ibmEdHrActive),
          isManager: str(p.ibmEdIsManager),
          managerEmail: str(p.managerEmail),
          managerFirstName: str(p.managerFirstName),
          managerLastName: str(p.managerLastName),
          jobResponsibilities: str(p.ibmEdJobResponsibilities),
        };
        // Salva solo se almeno un campo è valorizzato (evita oggetto vuoto
        // per i login Google).
        if (Object.values(w3id).some((v) => v !== undefined)) {
          token.w3id = w3id;
        }

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
        // [SPIKE Q1] Espone i claim w3id alla UI (menu account).
        session.user.w3id = token.w3id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
