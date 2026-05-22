export { default } from "next-auth/middleware";

// Protegge tutte le rotte tranne login, NextAuth, BFF proxy (che gestisce 401 da solo),
// asset statici e l'home pubblica del bootstrap.
export const config = {
  matcher: ["/parking/:path*", "/desks/:path*", "/my-reservations/:path*"],
};
