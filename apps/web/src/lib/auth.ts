import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
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
