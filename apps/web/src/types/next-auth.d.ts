import "next-auth";
import "next-auth/jwt";

type Role = "USER" | "ADMIN";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: Role;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    provider?: string;
    providerSub?: string;
    role?: Role;
  }
}
