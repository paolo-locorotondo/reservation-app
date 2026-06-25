import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import jwt from "jsonwebtoken";

type AppRole = "USER" | "ADMIN" | "MANAGER";

// Parsa una env var CSV di email in un Set normalizzato (lowercase, trimmed).
function emailSet(envVar: string | undefined): Set<string> {
  return new Set(
    (envVar ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return emailSet(process.env.ADMIN_EMAILS).has(email.toLowerCase());
}

// Override manuale del ruolo MANAGER via env (oltre al claim w3id). Usi:
//  - test in locale (il proprio account w3id ha `ibmEdIsManager="N"`);
//  - escape hatch a regime: forzare MANAGER a chi ha il claim sbagliato,
//    senza redeploy del codice.
function isManagerByEnv(email: string | null | undefined): boolean {
  if (!email) return false;
  return emailSet(process.env.MANAGER_EMAILS).has(email.toLowerCase());
}

// Calcolo del ruolo al login (priorità):
//   1. ADMIN   — email in ADMIN_EMAILS (override esplicito, indipendente dall'IdP)
//   2. MANAGER — claim w3id `ibmEdIsManager === "Y"` (confermato nello spike Q1:
//      "Y" per i manager, "N" per i riporti) OPPURE email in MANAGER_EMAILS
//   3. USER    — default
// Il role è "frozen" al login (calcolato solo qui nel branch account&&profile):
// un cambio di ADMIN_EMAILS/MANAGER_EMAILS ha effetto solo dopo re-login. Vedi
// TODO "Revoca privilegi già loggati" per la mitigazione (maxAge, prevista al
// go-live).
function computeRole(
  email: string | null | undefined,
  isManagerClaim: string | undefined,
): AppRole {
  if (isAdmin(email)) return "ADMIN";
  if (isManagerClaim === "Y" || isManagerByEnv(email)) return "MANAGER";
  return "USER";
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
  role: AppRole;
  managerEmail?: string;
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
        managerEmail: payload.managerEmail,
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
        /* 
        // decommenta per debug [SPIKE-Q1]
        console.log(
          "[SPIKE-Q1] w3id profile claims:\n" + JSON.stringify(profile, null, 2),
        ); 
        */
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
        // Claim w3id: `profile` è tipizzato stretto da NextAuth, castiamo a
        // record per leggere i campi custom dell'IdP IBM. Assenti per Google.
        const p = profile as Record<string, unknown>;
        const str = (v: unknown): string | undefined =>
          typeof v === "string" && v.length > 0 ? v : undefined;
        /* 
        // decommenta per debug [SPIKE-Q1]
        console.log(
          "[SPIKE-Q1] account (tokens):\n" + JSON.stringify(account, null, 2),
        );
         */
        token.provider = account.provider;
        token.providerSub = account.providerAccountId;
        token.email = profile.email ?? token.email;
        token.name = profile.name ?? token.name;
        // Ruolo: ADMIN (ADMIN_EMAILS) > MANAGER (ibmEdIsManager==="Y") > USER.
        // Const locale: TS non restringe `token.role` (tipato Role|undefined)
        // dopo l'assegnazione, quindi riuso `role` per il sync sotto.
        const role = computeRole(profile.email, str(p.ibmEdIsManager));
        token.role = role;
        // Email del manager diretto: persistita a DB (User.managerEmail) per
        // ricostruire la gerarchia riporti, e tenuta nel token per il proxy.
        const managerEmail = str(p.managerEmail);
        token.managerEmail = managerEmail;

        // [SPIKE Q1] Claim w3id mostrati nel menu account (box temporaneo per
        // ispezione manager/HR). Assenti per Google → token.w3id undefined.
        const w3id = {
          employeeType: str(p.ibmEdEmployeeType),
          hrActive: str(p.ibmEdHrActive),
          isManager: str(p.ibmEdIsManager),
          managerEmail: str(p.managerEmail),
          managerFirstName: str(p.managerFirstName),
          managerLastName: str(p.managerLastName),
          jobResponsibilities: str(p.ibmEdJobResponsibilities),
        };
        if (Object.values(w3id).some((v) => v !== undefined)) {
          token.w3id = w3id;
        }

        // Allinea User.role + managerEmail del DB col token. Side effect
        // fire-and-forget: il login non blocca se la sync fallisce. Senza
        // questa, il DB resterebbe "drift" perché nessun consumer dell'app
        // chiama mai `/me` a runtime.
        if (token.email && token.providerSub && token.provider) {
          void syncRoleToBackend({
            sub: token.providerSub,
            provider: token.provider,
            email: token.email,
            name: token.name,
            role,
            managerEmail,
          });
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as AppRole) ?? "USER";
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
