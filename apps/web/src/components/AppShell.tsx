"use client";

import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Header,
  HeaderContainer,
  HeaderMenuButton,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
  HeaderGlobalBar,
  HeaderGlobalAction,
  HeaderPanel,
  Switcher,
  SwitcherItem,
  SwitcherDivider,
  SideNav,
  SideNavItems,
  SideNavLink,
  SkipToContent,
  Content,
} from "@carbon/react";
import { UserAvatar } from "@carbon/icons-react";
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
  const [userPanelOpen, setUserPanelOpen] = useState(false);

  const displayName = session?.user?.name ?? "";
  const email = session?.user?.email ?? "";

  // Click-outside per chiudere il pannello utente. HeaderPanel non lo gestisce
  // nativamente: il pannello e il bottone trigger sono fratelli, quindi un
  // listener globale che esclude entrambi è la via più pulita.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!userPanelOpen) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setUserPanelOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setUserPanelOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [userPanelOpen]);

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
              {displayName && (
                <span className="rsv-header-username">{displayName}</span>
              )}
              <HeaderGlobalAction
                aria-label={userPanelOpen ? "Chiudi menu account" : "Apri menu account"}
                tooltipAlignment="end"
                isActive={userPanelOpen}
                onClick={() => setUserPanelOpen((v) => !v)}
                ref={triggerRef}
              >
                <UserAvatar />
              </HeaderGlobalAction>
            </HeaderGlobalBar>
            <HeaderPanel
              expanded={userPanelOpen}
              aria-label="Menu account"
              ref={panelRef}
            >
              <Switcher aria-label="Account">
                <li className="rsv-user-panel-info" role="presentation">
                  <div className="rsv-user-panel-name">{displayName || email || "Utente"}</div>
                  {email && email !== displayName && (
                    <div className="rsv-user-panel-email">{email}</div>
                  )}
                </li>
                <SwitcherDivider />
                <SwitcherItem
                  aria-label="Esci"
                  onClick={() => {
                    setUserPanelOpen(false);
                    void signOut({ callbackUrl: "/login" });
                  }}
                >
                  Esci
                </SwitcherItem>
              </Switcher>
            </HeaderPanel>
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
