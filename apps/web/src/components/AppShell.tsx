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
  HeaderMenu,
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
  SideNavMenu,
  SideNavMenuItem,
  SkipToContent,
  Content,
} from "@carbon/react";
import { UserAvatar, Car, Devices, Calendar, Group, Home } from "@carbon/icons-react";
import type { ComponentType, ReactNode } from "react";
import { api } from "@/lib/api";

// Voce di nav. Le voci con `children` si rendono come dropdown
// (Carbon `HeaderMenu` su desktop, `SideNavMenu` su mobile drawer); cliccare
// la voce-padre apre il sotto-menu invece di navigare. Le voci foglia
// navigano direttamente all'`href`. `roles` (se presente) limita la
// visibilità della voce ai soli ruoli elencati; assente = visibile a tutti.
//
// L'`Icon` è usata solo nello shortcut della top-bar mobile (HeaderGlobalAction).
// Per voci-padre con children, lo shortcut va al PRIMO figlio (default landing
// per quella sezione) — comportamento idiomatico per nav a 2 livelli su mobile.
type NavRole = "USER" | "ADMIN" | "MANAGER";
type NavLeaf = { label: string; href: string; Icon: ComponentType };
type NavBranch = { label: string; Icon: ComponentType; children: NavLeaf[] };
type NavItem = (NavLeaf | NavBranch) & { roles?: NavRole[] };

function isBranch(item: NavItem): item is NavBranch & { roles?: NavRole[] } {
  return "children" in item;
}

const NAV: NavItem[] = [
  { label: "Posti auto", href: "/parking", Icon: Car },
  { label: "Scrivanie", href: "/desks", Icon: Devices },
  { label: "Le mie prenotazioni", href: "/my-reservations", Icon: Calendar },
  {
    label: "Amministrazione",
    Icon: Group,
    roles: ["ADMIN"],
    children: [
      { label: "Prenotazioni", href: "/admin/reservations", Icon: Group },
      { label: "Chiusure", href: "/admin/closures", Icon: Group },
      { label: "Postazioni riservate", href: "/admin/spot-groups", Icon: Group },
    ],
  },
  {
    // Vista MANAGER: stessa UX di "Amministrazione" ma scoped ai propri
    // riporti (vedi /manager/*). Niente "Chiusure" (resta ADMIN-only).
    label: "Il mio team",
    Icon: Group,
    roles: ["MANAGER"],
    children: [
      { label: "Prenotazioni", href: "/manager/reservations", Icon: Group },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  // Per le voci-padre della nav (branch), su mobile l'icona shortcut nella
  // top-bar apre un HeaderPanel con i sotto-link invece di navigare al primo
  // figlio. Identifico il branch aperto dalla sua label (max 1 alla volta).
  const [branchPanelLabel, setBranchPanelLabel] = useState<string | null>(null);

  const displayName = session?.user?.name ?? "";
  const email = session?.user?.email ?? "";
  // [SPIKE Q1] Claim w3id mostrati nel menu account (solo login ibmsso).
  const w3id = session?.user?.w3id;
  // Gruppo di riserva (C7.1): non è nel JWT (assegnato dall'admin DOPO il
  // login) → letto fresco da /me e mostrato nel menu account.
  const [reservedGroupName, setReservedGroupName] = useState<string | null>(null);
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    api
      .getMe()
      .then((m) => {
        if (!cancelled) setReservedGroupName(m.reservedGroupName);
      })
      .catch(() => {
        /* best-effort: il menu funziona anche senza */
      });
    return () => {
      cancelled = true;
    };
  }, [email]);
  // Voci nav filtrate per ruolo: una voce con `roles` è visibile solo se il
  // ruolo della session è incluso (vedi types/next-auth.d.ts + lib/auth.ts).
  // Senza `roles` → visibile a tutti.
  const role = session?.user?.role;
  const visibleNav = NAV.filter(
    (n) => !n.roles || (role !== undefined && n.roles.includes(role)),
  );

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

  // Stesso pattern click-outside per il branch-panel mobile (Amministrazione
  // ha 3 sotto-voci che si aprono come dropdown anche da icona). Stesso
  // listener riutilizzabile per tutti i branch (max 1 aperto alla volta).
  const branchPanelRef = useRef<HTMLDivElement | null>(null);
  const branchTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!branchPanelLabel) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (branchPanelRef.current?.contains(t)) return;
      if (branchTriggerRef.current?.contains(t)) return;
      setBranchPanelLabel(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBranchPanelLabel(null);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [branchPanelLabel]);

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
            {/* Branding adattivo: stesso `<HeaderName>` su tutte le larghezze.
                Su desktop si vede "IBM Reservation"; sotto Carbon $breakpoint-md
                (672px) il testo + il prefix Carbon vengono nascosti via CSS e
                resta visibile solo l'icona Home, così la HeaderGlobalBar di
                destra recupera lo spazio per Esci. Vedi `.rsv-brand` in
                globals.scss. */}
            <HeaderName href="/" prefix="IBM" className="rsv-brand">
              <span className="rsv-brand-text">Reservation</span>
              <Home size={20} className="rsv-brand-home" aria-label="Home" />
            </HeaderName>
            <HeaderNavigation aria-label="Sezioni">
              {visibleNav.map((item) => {
                if (isBranch(item)) {
                  // `HeaderMenu` Carbon: link-padre con caret che apre un
                  // dropdown contenente i `HeaderMenuItem` figli. Il padre
                  // appare "active" se il pathname matcha uno qualsiasi dei
                  // figli (es. su /admin/closures la voce "Amministrazione"
                  // resta evidenziata).
                  const anyChildActive = item.children.some((c) =>
                    pathname?.startsWith(c.href),
                  );
                  return (
                    <HeaderMenu
                      key={item.label}
                      aria-label={item.label}
                      menuLinkName={item.label}
                      isActive={anyChildActive}
                    >
                      {item.children.map((child) => (
                        <HeaderMenuItem
                          key={child.href}
                          href={child.href}
                          isActive={pathname?.startsWith(child.href)}
                          onClick={(e: React.MouseEvent) => {
                            e.preventDefault();
                            router.push(child.href);
                          }}
                        >
                          {child.label}
                        </HeaderMenuItem>
                      ))}
                    </HeaderMenu>
                  );
                }
                return (
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
                );
              })}
            </HeaderNavigation>
            <HeaderGlobalBar>
              {/* Nav-shortcut a icone visibili solo su mobile (sotto il
                  breakpoint Carbon `lg` = 1056px, dove la HeaderNavigation
                  testuale è già nascosta da Carbon). Su desktop la classe
                  `rsv-header-mobile-nav` le nasconde via CSS, evitando
                  duplicati con la nav testuale.
                  Voci-foglia: click → navigate. Voci-padre (branch): click
                  apre/chiude un HeaderPanel con i sotto-link (idiomatico
                  Carbon, simmetrico al menu utente). Il drawer del menu
                  hamburger li mostra anche come SideNavMenu — i 2 entry
                  point coesistono. */}
              {visibleNav.map((item) => {
                if (isBranch(item)) {
                  const isOpen = branchPanelLabel === item.label;
                  const matchPrefix = item.children.some((c) =>
                    pathname?.startsWith(c.href),
                  );
                  return (
                    <HeaderGlobalAction
                      key={item.label}
                      aria-label={
                        isOpen ? `Chiudi menu ${item.label}` : `Apri menu ${item.label}`
                      }
                      tooltipAlignment="center"
                      isActive={isOpen || matchPrefix}
                      onClick={() =>
                        setBranchPanelLabel(isOpen ? null : item.label)
                      }
                      // Ref dinamico: punta al trigger del branch attualmente
                      // aperto (per il click-outside detector). Quando isOpen
                      // diventa false la ref viene "abbandonata" — accettabile
                      // perché il listener parte solo quando branchPanelLabel
                      // è valorizzato.
                      ref={isOpen ? branchTriggerRef : undefined}
                      className="rsv-header-mobile-nav"
                    >
                      <item.Icon />
                    </HeaderGlobalAction>
                  );
                }
                return (
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
                );
              })}
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
                  {/* Gruppo di riserva di appartenenza (C7.1), se assegnato. */}
                  {reservedGroupName && (
                    <div className="rsv-user-panel-group">
                      <span>Gruppo riservato:</span> {reservedGroupName}
                    </div>
                  )}
                  {/* [SPIKE Q1] Claim w3id per ispezione (verifica con
                      manager/HR). Visibili solo per login ibmsso. Da rimuovere
                      quando il modello ruoli sarà deciso (vedi TODO Q1). */}
                  {w3id && (
                    <div className="rsv-user-panel-w3id">
                      {w3id.jobResponsibilities && (
                        <div>
                          <span>JobRole:</span> {w3id.jobResponsibilities}
                        </div>
                      )}
                      {w3id.employeeType && (
                        <div>
                          <span>Tipo dipendente:</span> {w3id.employeeType}
                        </div>
                      )}
                      {w3id.isManager && (
                        <div>
                          <span>È manager:</span> {w3id.isManager}
                        </div>
                      )}
                      {w3id.managerEmail  && (
                        <div>
                          <span>Manager Email:</span> {w3id.managerEmail}
                        </div>
                      )}
                      {w3id.managerFirstName  && (
                        <div>
                          <span>Manager FirstName:</span> {w3id.managerFirstName}
                        </div>
                      )}
                      {w3id.managerLastName  && (
                        <div>
                          <span>Manager LastName:</span> {w3id.managerLastName}
                        </div>
                      )}
                      {w3id.hrActive && (
                        <div>
                          <span>HR active:</span> {w3id.hrActive}
                        </div>
                      )}
                    </div>
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
            {/* Un HeaderPanel per ogni branch della nav (oggi solo
                "Amministrazione"). Si aprono al click dell'icona shortcut
                mobile e contengono i sotto-link come SwitcherItem.
                `expanded` controllato dal `branchPanelLabel`. */}
            {visibleNav.map((item) => {
              if (!isBranch(item)) return null;
              const isOpen = branchPanelLabel === item.label;
              return (
                <HeaderPanel
                  key={item.label}
                  expanded={isOpen}
                  aria-label={`Menu ${item.label}`}
                  ref={isOpen ? branchPanelRef : undefined}
                >
                  <Switcher aria-label={item.label}>
                    {item.children.map((child) => (
                      <SwitcherItem
                        key={child.href}
                        aria-label={child.label}
                        isSelected={pathname?.startsWith(child.href)}
                        onClick={() => {
                          setBranchPanelLabel(null);
                          router.push(child.href);
                        }}
                      >
                        {child.label}
                      </SwitcherItem>
                    ))}
                  </Switcher>
                </HeaderPanel>
              );
            })}
            <SideNav
              aria-label="Navigazione"
              expanded={isSideNavExpanded}
              isPersistent={false}
              onSideNavBlur={onClickSideNavExpand}
            >
              <SideNavItems>
                {visibleNav.map((item) => {
                  if (isBranch(item)) {
                    // `SideNavMenu` Carbon: voce espandibile (chevron) che
                    // contiene `SideNavMenuItem` figli. `defaultExpanded`
                    // se siamo già dentro una sotto-pagina del branch, così
                    // il drawer apre già "aperto" sul branch corrente.
                    const anyChildActive = item.children.some((c) =>
                      pathname?.startsWith(c.href),
                    );
                    return (
                      <SideNavMenu
                        key={item.label}
                        title={item.label}
                        defaultExpanded={anyChildActive}
                      >
                        {item.children.map((child) => (
                          <SideNavMenuItem
                            key={child.href}
                            href={child.href}
                            isActive={pathname?.startsWith(child.href)}
                            onClick={(e: React.MouseEvent) => {
                              e.preventDefault();
                              router.push(child.href);
                              onClickSideNavExpand();
                            }}
                          >
                            {child.label}
                          </SideNavMenuItem>
                        ))}
                      </SideNavMenu>
                    );
                  }
                  return (
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
                  );
                })}
              </SideNavItems>
            </SideNav>
          </Header>
        )}
      />
      {/* Padding gestito via classe (non inline) per poter rispondere a media
          query: su mobile riduciamo il padding del Content per dare più
          larghezza orizzontale ai filtri/datepicker — vedi globals.scss. */}
      <Content className="rsv-app-content">{children}</Content>
    </>
  );
}
