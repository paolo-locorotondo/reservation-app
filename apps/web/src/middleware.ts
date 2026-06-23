import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Protegge tutte le rotte tranne login, NextAuth, BFF proxy (che gestisce 401
// da solo), asset statici e l'home pubblica del bootstrap.
//
// Gating per ruolo (oltre alla session):
//  - `/admin/*`   → solo `role === "ADMIN"`.
//  - `/manager/*` → solo `role === "MANAGER"`. NON ADMIN: i controller
//    backend /manager/* sono `@Roles(MANAGER)` (darebbero 403 a un admin),
//    e l'admin ha comunque la vista completa su /admin/*. Tenere il gate
//    pagina coerente col gate API evita pagine che caricano ma falliscono
//    le chiamate.
// Role diverso → redirect a `/403`.
export default withAuth(
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
      // Auth check di base: token presente. Il check del role avviene nel
      // middleware sopra (perché qui non abbiamo accesso a `pathname`).
      authorized: ({ token }) => !!token,
    },
  },
);

export const config = {
  matcher: [
    "/parking/:path*",
    "/desks/:path*",
    "/my-reservations/:path*",
    "/admin/:path*",
    "/manager/:path*",
  ],
};
