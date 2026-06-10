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
import { UserAvatar, Car, Devices, Calendar } from "@carbon/icons-react";
import type { ComponentType, ReactNode } from "react";

// Le icone vengono usate solo nella variante mobile dell'header (dove la nav
// testuale collassa nel side menu). Su desktop si usano comunque le label.
const NAV: { label: string; href: string; Icon: ComponentType }[] = [
  { label: "Posti auto", href: "/parking", Icon: Car },
  { label: "Scrivanie", href: "/desks", Icon: Devices },
  { label: "Le mie prenotazioni", href: "/my-reservations", Icon: Calendar },
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
              {/* Nav-shortcut a icone visibili solo su mobile (sotto il
                  breakpoint Carbon `lg` = 1056px, dove la HeaderNavigation
                  testuale è già nascosta da Carbon). Su desktop la classe
                  `rsv-header-mobile-nav` le nasconde via CSS, evitando
                  duplicati con la nav testuale. */}
              {NAV.map((item) => (
                <HeaderGlobalAction
                  key={item.href}
                  aria-label={item.label}
                  tooltipAlignment="center"
                  isActive={pathname?.startsWith(item.href)}
                  onClick={() => router.push(item.href)}
                  className="rsv-header-mobile-nav"
                >
                  <item.Icon />
                </HeaderGlobalAction>
              ))}
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
