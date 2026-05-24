"use client";

import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import {
  Header,
  HeaderContainer,
  HeaderMenuButton,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
  HeaderGlobalBar,
  HeaderGlobalAction,
  SideNav,
  SideNavItems,
  SideNavLink,
  SkipToContent,
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
      <HeaderContainer
        render={({
          isSideNavExpanded,
          onClickSideNavExpand,
        }: {
          isSideNavExpanded: boolean;
          onClickSideNavExpand: () => void;
        }) => (
          <Header aria-label="Reservation App">
            <SkipToContent />
            {/* HeaderMenuButton: Carbon lo mostra solo sotto il breakpoint lg
                (1056px), HeaderNavigation viceversa è nascosto su mobile.
                Insieme garantiscono navigazione su qualunque larghezza. */}
            <HeaderMenuButton
              aria-label={isSideNavExpanded ? "Chiudi menu" : "Apri menu"}
              onClick={onClickSideNavExpand}
              isActive={isSideNavExpanded}
              aria-expanded={isSideNavExpanded}
            />
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
                <span className="rsv-header-email">{session.user.email}</span>
              )}
              <HeaderGlobalAction
                aria-label="Esci"
                tooltipAlignment="end"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <Logout />
              </HeaderGlobalAction>
            </HeaderGlobalBar>
            <SideNav
              aria-label="Navigazione"
              expanded={isSideNavExpanded}
              isPersistent={false}
              onSideNavBlur={onClickSideNavExpand}
            >
              <SideNavItems>
                {NAV.map((item) => (
                  <SideNavLink
                    key={item.href}
                    href={item.href}
                    isActive={pathname?.startsWith(item.href)}
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      router.push(item.href);
                      onClickSideNavExpand();
                    }}
                  >
                    {item.label}
                  </SideNavLink>
                ))}
              </SideNavItems>
            </SideNav>
          </Header>
        )}
      />
      <Content style={{ padding: "2rem", marginTop: "3rem" }}>{children}</Content>
    </>
  );
}
