"use client";

import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import {
  Header,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
  HeaderGlobalBar,
  HeaderGlobalAction,
  Content,
} from "@carbon/react";
import { Logout } from "@carbon/icons-react";
import type { ReactNode } from "react";

const NAV: { label: string; href: string }[] = [
  { label: "Posti auto", href: "/parking" },
  { label: "Scrivanie", href: "/desks" },
  { label: "Le mie prenotazioni", href: "/my-reservations" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <>
      <Header aria-label="Reservation App">
        <HeaderName href="/" prefix="IBM">
          Reservation
        </HeaderName>
        <HeaderNavigation aria-label="Sezioni">
          {NAV.map((item) => (
            <HeaderMenuItem
              key={item.href}
              href={item.href}
              isActive={pathname?.startsWith(item.href)}
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                router.push(item.href);
              }}
            >
              {item.label}
            </HeaderMenuItem>
          ))}
        </HeaderNavigation>
        <HeaderGlobalBar>
          {session?.user?.email && (
            <span style={{ alignSelf: "center", padding: "0 1rem", fontSize: "0.875rem" }}>
              {session.user.email}
            </span>
          )}
          <HeaderGlobalAction
            aria-label="Esci"
            tooltipAlignment="end"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <Logout />
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>
      <Content style={{ padding: "2rem", marginTop: "3rem" }}>{children}</Content>
    </>
  );
}
