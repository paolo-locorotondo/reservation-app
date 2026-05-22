import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import jwt from "jsonwebtoken";

// BFF proxy: tutte le chiamate del frontend passano da qui.
// 1) Legge la sessione NextAuth (cookie httpOnly, decifrato server-side).
// 2) Ri-firma un JWT HS256 pulito con NEXTAUTH_SECRET (claims: provider, providerSub, email, name, role).
//    L'API NestJS usa lo stesso segreto per verificare → no JWE, no JWKS, niente di complesso.
// 3) Inoltra metodo/headers/body all'API (API_INTERNAL_URL).

const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

async function handler(req: NextRequest, ctx: { params: { path: string[] } }) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const token = await getToken({ req, secret });
  if (!token || !token.providerSub || !token.email) {
    return NextResponse.json({ error: "unauthorized-at-proxy" }, { status: 401 });
  }

  const apiToken = jwt.sign(
    {
      sub: token.providerSub,
      provider: token.provider,
      email: token.email,
      name: token.name,
      role: token.role ?? "USER",
    },
    secret,
    { algorithm: "HS256", expiresIn: "1h" },
  );

  const subPath = ctx.params.path.join("/");
  const url = new URL(`/api/${subPath}`, API_URL);
  url.search = req.nextUrl.search;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("authorization", `Bearer ${apiToken}`);

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  const upstream = await fetch(url, init);
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
