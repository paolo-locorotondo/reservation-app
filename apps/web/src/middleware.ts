import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Protegge tutte le rotte tranne login, NextAuth, BFF proxy (che gestisce 401
// da solo), asset statici e l'home pubblica del bootstrap.
//
// Per `/admin/*` non basta la session: serve anche `role === "ADMIN"` nel
// token JWT (popolato da `lib/auth.ts` callback `jwt` da `ADMIN_EMAILS`).
// Se il role è diverso, redirect a `/403` (pagina dedicata) — più pulito
// del rendering della tabella admin con banner errore in fondo.
export default withAuth(
  function middleware(req) {
    const isAdminPath = req.nextUrl.pathname.startsWith("/admin");
    if (isAdminPath && req.nextauth.token?.role !== "ADMIN") {
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
  ],
};
