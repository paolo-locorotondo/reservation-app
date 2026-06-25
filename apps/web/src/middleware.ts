import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { MAINTENANCE_HTML } from "./maintenance-html";

// Path che richiedono autenticazione (+ eventuale gating per ruolo). Tutto il
// resto (/, /login, /api/*, /403, asset) passa senza auth.
const PROTECTED = ["/parking", "/desks", "/my-reservations", "/admin", "/manager"];

// Auth + gating per ruolo, applicato SOLO ai path protetti (vedi sotto).
//  - `/admin/*`   → solo `role === "ADMIN"`.
//  - `/manager/*` → solo `role === "MANAGER"` (NON ADMIN: i controller backend
//    /manager/* sono `@Roles(MANAGER)`; l'admin usa /admin/*). Tenere il gate
//    pagina coerente col gate API evita pagine che caricano ma falliscono le
//    chiamate. Role diverso → redirect a `/403`.
const authMiddleware = withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const role = req.nextauth.token?.role;
    if (pathname.startsWith("/admin") && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/403", req.url));
    }
    if (pathname.startsWith("/manager") && role !== "MANAGER") {
      return NextResponse.redirect(new URL("/403", req.url));
    }
  },
  {
    callbacks: {
      // Auth check di base: token presente. Il check del role è nel middleware
      // sopra (qui non abbiamo accesso a `pathname`).
      authorized: ({ token }) => !!token,
    },
  },
);

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  // --- Maintenance mode (env-gated) ---
  // Quando `MAINTENANCE_MODE=1`, OGNI richiesta riceve la pagina 503 (incluse
  // le pagine app E il proxy /api/* → la SPA non funziona, sito "giù").
  // Toggle: settare la env su Vercel + redeploy (il middleware legge l'env al
  // boot Edge). Per un toggle istantaneo servirebbe Edge Config (futuro).
  if (process.env.MAINTENANCE_MODE === "1") {
    return new NextResponse(MAINTENANCE_HTML, {
      status: 503, // Service Unavailable: corretto per client/monitoring/SEO
      headers: {
        "content-type": "text/html; charset=utf-8",
        "Retry-After": "3600",
        "Cache-Control": "no-store",
      },
    });
  }

  // --- Modalità normale ---
  // Auth/role solo sui path protetti; il resto (/, /login, /api/proxy, /403)
  // passa attraverso. Il matcher è ampio per coprire tutto in maintenance
  // mode, quindi qui filtriamo esplicitamente cosa proteggere.
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isProtected) {
    return authMiddleware(req as NextRequestWithAuth, event);
  }
  return NextResponse.next();
}

export const config = {
  // Ampio: tutto tranne gli asset interni di Next e la favicon. Serve a far
  // funzionare il maintenance mode su QUALSIASI rotta (pagine + /api/*). In
  // modalità normale, i path non protetti vengono lasciati passare dal
  // middleware sopra (overhead trascurabile: una sola string-check).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
