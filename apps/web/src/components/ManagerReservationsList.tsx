"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DataTable,
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
  TableCell,
  TableContainer,
  TableSelectAll,
  TableSelectRow,
  Button,
  IconButton,
  InlineLoading,
  InlineNotification,
  Search,
  Select,
  SelectItem,
  DatePicker,
  DatePickerInput,
  ContentSwitcher,
  Switch,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  FilterableMultiSelect,
  ComboBox,
  Modal,
} from "@carbon/react";
import {
  ArrowsVertical,
  ArrowUp,
  ArrowDown,
  Renew,
  Add,
  TrashCan,
} from "@carbon/icons-react";
import { Italian } from "flatpickr/dist/l10n/it.js";
import type { CustomLocale } from "flatpickr/dist/types/locale";
import type { Site, Floor, SpotType, ReservationStatus } from "@reservation/shared";
import {
  api,
  ApiError,
  type AdminReservation,
  type AdminUserItem,
} from "@/lib/api";
import { FiltersPanel } from "./FiltersPanel";
import { ManagerReservationsCalendar } from "./ManagerReservationsCalendar";
import { ManagerBookForUserDialog, type BookForUserTarget } from "./ManagerBookForUserDialog";
import { ManagerBulkBookingsDialog } from "./ManagerBulkBookingsDialog";

// HEADERS della tabella per-tab. Niente colonna "Tipo": è già discriminata
// dal Tab attivo. La cancellazione avviene cliccando direttamente la riga
// (pattern di MyReservationsList) — niente colonna Azioni che peggiorerebbe
// lo scroll orizzontale già forte con 9 colonne.
const HEADERS = [
  { key: "date", header: "Data" },
  { key: "user", header: "Utente" },
  { key: "code", header: "Codice" },
  { key: "site", header: "Sede" },
  { key: "floor", header: "Piano" },
  { key: "zone", header: "Zona" },
  { key: "status", header: "Stato" },
  { key: "createdAt", header: "Creata il" },
  { key: "createdByName", header: "Creata da" },
  { key: "cancelledAt", header: "Cancellata il" },
  { key: "cancelledByName", header: "Cancellata da" },
];

const SORTABLE_KEYS = new Set([
  "date",
  "user",
  "code",
  "site",
  "floor",
  "zone",
  "status",
  "createdAt",
  "createdByName",
  "cancelledAt",
  "cancelledByName",
]);

type SortState = { key: string; dir: "asc" | "desc" } | null;
function nextSort(prev: SortState, key: string): SortState {
  if (!prev || prev.key !== key) return { key, dir: "asc" };
  if (prev.dir === "asc") return { key, dir: "desc" };
  return null;
}

function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DT_FMT = new Intl.DateTimeFormat("it-IT", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
function formatDateTime(iso: string | Date): string {
  return DT_FMT.format(typeof iso === "string" ? new Date(iso) : iso);
}

// Parse "YYYY-MM-DD" → Date UTC. Usato per derivare `initialMonth` del
// calendar dal `dateFrom` corrente del tab (string ISO).
function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoFromDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function ManagerReservationsList() {
  // State a livello pagina, condiviso tra i due tab.
  const [view, setView] = useState<"list" | "calendar">("calendar");
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Lista utenti per il MultiSelect. Caricata al mount + ad ogni incremento
  // di `usersReloadTick`: il bottone Renew del tab corrente lo aggiorna così
  // il manager vede subito gli utenti appena registrati senza dover fare F5.
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersReloadTick, setUsersReloadTick] = useState(0);

  // Conteggi per-tipo, mostrati nelle label dei tab "Posti auto (N)" /
  // "Scrivanie (N)". Lift up dal `ManagerReservationsTab`: ogni tab ha la
  // propria fetch e notifica via `onCountChange` quando il proprio
  // `items.length` cambia. Il numero riflette i filtri server-side
  // attualmente applicati nel tab (Sede/Piano/Zona/Stato/Da/A/Utenti) —
  // utile per "vedo quanti risultati ho col filtro corrente". `null` =
  // ancora non caricato, mostra "—" invece di "0" per non confondere.
  const [parkingCount, setParkingCount] = useState<number | null>(null);
  const [deskCount, setDeskCount] = useState<number | null>(null);

  // Tick di reload globale incrementato dopo un bulk-create: il bulk crea
  // prenotazioni di tipo arbitrario (PARKING e/o DESK), quindi DEVE refreshare
  // ENTRAMBI i tab + tutte le viste, non solo quello da cui è partito.
  // Passato a tutti e due gli ManagerReservationsTab e incluso nelle deps dei
  // loro fetch effect.
  const [bulkReloadTick, setBulkReloadTick] = useState(0);

  useEffect(() => {
    api
      .listManagerUsers()
      .then(setUsers)
      .catch((e: ApiError) => setUsersError(`Caricamento utenti: ${e.message}`));
  }, [usersReloadTick]);

  const reloadUsers = () => setUsersReloadTick((t) => t + 1);
  const handleBulkDone = () => setBulkReloadTick((t) => t + 1);

  return (
    <main>
      <div className="rsv-page-header-row">
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Il mio team — Prenotazioni</h1>
          <p style={{ marginBottom: 0, color: "#525252" }}>
            Le prenotazioni del tuo team. Usa i filtri per restringere; clicca un giorno del calendario per vedere il dettaglio nella vista Lista.
          </p>
        </div>
        <ContentSwitcher
          size="sm"
          selectedIndex={view === "calendar" ? 0 : 1}
          onChange={({ name }) => setView(name === "calendar" ? "calendar" : "list")}
          aria-label="Vista calendario o lista"
        >
          <Switch name="calendar" text="Calendario" />
          <Switch name="list" text="Lista" />
        </ContentSwitcher>
      </div>

      {usersError && (
        <InlineNotification
          kind="warning"
          title="Avviso"
          subtitle={usersError}
          onCloseButtonClick={() => setUsersError(null)}
          style={{ marginBottom: "1rem" }}
        />
      )}

      <Tabs
        selectedIndex={selectedIndex}
        onChange={({ selectedIndex: i }) => setSelectedIndex(i)}
      >
        <TabList aria-label="Tipo di prenotazione" contained>
          <Tab>{`Posti auto (${parkingCount ?? "—"})`}</Tab>
          <Tab>{`Scrivanie (${deskCount ?? "—"})`}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <ManagerReservationsTab
              tabKey="PARKING"
              type="PARKING"
              view={view}
              users={users}
              onSwitchToList={() => setView("list")}
              onReloadUsers={reloadUsers}
              onCountChange={setParkingCount}
              bulkReloadTick={bulkReloadTick}
              onBulkDone={handleBulkDone}
            />
          </TabPanel>
          <TabPanel>
            <ManagerReservationsTab
              tabKey="DESK"
              type="DESK"
              view={view}
              users={users}
              onSwitchToList={() => setView("list")}
              onReloadUsers={reloadUsers}
              onCountChange={setDeskCount}
              bulkReloadTick={bulkReloadTick}
              onBulkDone={handleBulkDone}
            />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </main>
  );
}

interface ManagerReservationsTabProps {
  tabKey: string;
  type: SpotType;
  view: "list" | "calendar";
  users: AdminUserItem[];
  onSwitchToList: () => void;
  // Refetch della lista utenti (state nel parent). Cliccato dal bottone Renew
  // insieme al refetch delle prenotazioni del tab corrente.
  onReloadUsers: () => void;
  // Notifica al padre il numero corrente di items (post-filtri server-side).
  // Usato dal padre per popolare la label del tab "Posti auto (N)" /
  // "Scrivanie (N)".
  onCountChange: (count: number) => void;
  // Tick di reload globale (incrementato dal padre dopo un bulk-create):
  // incluso nelle deps dei fetch così entrambi i tab si aggiornano.
  bulkReloadTick: number;
  // Chiamato dopo un bulk-create andato a buon fine: il padre incrementa
  // `bulkReloadTick` per refreshare entrambi i tab.
  onBulkDone: () => void;
}

// Sotto-componente per il contenuto di un tab. Stato dei filtri indipendente
// per tab — coerente con il pattern di MyReservationsList → ReservationsTab.
function ManagerReservationsTab({
  tabKey,
  type,
  view,
  users,
  onSwitchToList,
  onReloadUsers,
  onCountChange,
  bulkReloadTick,
  onBulkDone,
}: ManagerReservationsTabProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [floorId, setFloorId] = useState<string>("");
  const [zoneName, setZoneName] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "">("ACTIVE");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const [items, setItems] = useState<AdminReservation[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [limit, setLimit] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [sort, setSort] = useState<SortState>(null);

  // Cancellazione massiva (C4): selezione righe ACTIVE + modal di conferma.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);

  // Modal di gestione prenotazione (cancella + cambio intestatario):
  //  - `manageTarget` è la reservation completa (per i dettagli nel modal).
  //  - `editUserId` segna la modalità "cambio utente":
  //    * null  → modale in stato "Cancella" (default all'apertura)
  //    * uguale a `manageTarget.user.id` → admin ha cliccato "Cambia utente"
  //      ma non ha ancora scelto un nome diverso → resta "Cancella"
  //    * valore diverso da `manageTarget.user.id` → "Aggiorna" arancione
  const [manageTarget, setManageTarget] = useState<AdminReservation | null>(null);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Errore mostrato DENTRO al modale di gestione. Necessario perché il caso
  // "il nuovo utente ha già una prenotazione per quel giorno+tipo" (P2002 →
  // 409) è frequente e va visto col modale aperto. La InlineNotification
  // sopra la tabella sarebbe nascosta dietro l'overlay del Modal.
  const [manageError, setManageError] = useState<string | null>(null);

  // Dialog "Prenota per utente": target null = chiuso, oggetto = aperto con
  // tipo (e opzionale data preimpostata).
  const [bookTarget, setBookTarget] = useState<BookForUserTarget | null>(null);
  // Dialog "Prenotazione massiva": il wizard si auto-gestisce internamente
  // (steps, fetch lookup spots, submit), serve solo aprire/chiudere.
  const [bulkOpen, setBulkOpen] = useState(false);
  // Map iso → reason delle Closure attive nel range Da/A correnti, filtrato
  // per (siteId, type) del tab. Passato al calendar admin come overlay
  // visivo (cella grigia + tooltip "Giorno bloccato"). Best-effort: se la
  // fetch fallisce, il calendar mostra le celle senza overlay (niente
  // notifica all'utente, non bloccante).
  const [closuresByDate, setClosuresByDate] = useState<Map<string, string>>(
    new Map(),
  );
  // Numero totale di spot del filtro corrente (type + sede + piano + zona).
  // Serve al calendar per evidenziare i giorni "esauriti" (count >= total).
  // null = non ancora caricato (calendar non mostra --full).
  const [totalCapacity, setTotalCapacity] = useState<number | null>(null);

  const [datePickerLocale, setDatePickerLocale] = useState<CustomLocale | undefined>(
    undefined,
  );
  useEffect(() => {
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.startsWith("it")) setDatePickerLocale(Italian);
  }, []);

  // Sites una volta sola.
  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch((e: ApiError) => setError(`Caricamento sedi: ${e.message}`));
  }, []);

  // Floors al cambio di siteId.
  useEffect(() => {
    if (!siteId) {
      setFloors([]);
      setFloorId("");
      return;
    }
    setFloorId("");
    api
      .listFloors(siteId)
      .then(setFloors)
      .catch((e: ApiError) => setError(`Caricamento piani: ${e.message}`));
  }, [siteId]);

  // Capacity totale del filtro (tipo + sede + piano + zona). Serve al calendar
  // per evidenziare i giorni "esauriti" — count prenotazioni >= numero totale
  // di spot del filtro. Riusa `listSpots` con date=oggi: il `total` non
  // dipende dalla data scelta (è il numero di Spot attivi che matchano).
  // Lo filtriamo lato client per `zoneName` perché `listSpots` non lo supporta
  // (il backend admin invece sì, vedi listAdmin where.spot.zone.name ILIKE).
  useEffect(() => {
    let cancelled = false;
    api
      .listSpots({
        type,
        date: isoFromDate(new Date()),
        siteId: siteId || undefined,
        floorId: floorId || undefined,
      })
      .then((res) => {
        if (cancelled) return;
        const needle = zoneName.trim().toLowerCase();
        const filtered = needle
          ? res.items.filter((s) => (s.zoneName ?? "").toLowerCase().includes(needle))
          : res.items;
        setTotalCapacity(filtered.length);
      })
      .catch(() => {
        // Best-effort: senza capacity il calendar mostra solo --has-items, non
        // --full. Niente notifica all'utente, non è bloccante.
        if (cancelled) return;
        setTotalCapacity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [type, siteId, floorId, zoneName]);

  // Fetch Closure: popola la map iso→reason per il calendar. Il MANAGER NON
  // ha l'endpoint admin /admin/closures (ADMIN-only); usa l'endpoint
  // user-level `listClosures` che ritorna `{date, reason}[]` già filtrato per
  // `type` e collassato per data lato server. Niente filtro siteId (l'endpoint
  // user non lo supporta): l'overlay può mostrare chiusure di sedi diverse da
  // quella filtrata — cosmetico, il check reale è server-side alla create.
  useEffect(() => {
    let cancelled = false;
    api
      .listClosures({
        from: dateFrom || undefined,
        to: dateTo || undefined,
        type,
      })
      .then((closures) => {
        if (cancelled) return;
        const m = new Map<string, string>();
        for (const c of closures) {
          m.set(c.date.slice(0, 10), c.reason);
        }
        setClosuresByDate(m);
      })
      .catch(() => {
        // Best-effort: senza closures il calendar mostra solo --has-items
        // / --full. Niente notifica utente, non bloccante.
        if (cancelled) return;
        setClosuresByDate(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [type, siteId, dateFrom, dateTo, reloadTick, bulkReloadTick]);

  // Fetch principale: cleanup guard per evitare race tra fetch sovrapposti.
  useEffect(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    api
      .listManagerReservations({
        type,
        siteId: siteId || undefined,
        floorId: floorId || undefined,
        zoneName: zoneName.trim() || undefined,
        status: statusFilter || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        userIds: selectedUserIds.length > 0 ? selectedUserIds : undefined,
      })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTruncated(res.truncated);
        setLimit(res.limit);
        // Reset selezione bulk: gli id potrebbero non essere più nel dataset
        // (cambio filtri / reload). Evita di cancellare righe non più visibili.
        setSelectedIds(new Set());
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setError(`Caricamento prenotazioni: ${e.message}`);
        setItems([]);
        setTruncated(false);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    type,
    siteId,
    floorId,
    zoneName,
    statusFilter,
    dateFrom,
    dateTo,
    selectedUserIds,
    reloadTick,
    bulkReloadTick,
  ]);

  // Propaga il count corrente al padre per le label dei tab "Posti auto (N)"
  // / "Scrivanie (N)". Effect separato così non rinnoviamo il fetch principale
  // ad ogni cambio di reference di `onCountChange`.
  useEffect(() => {
    onCountChange(items.length);
  }, [items, onCountChange]);

  const rows = useMemo(() => {
    return items.map((r) => ({
      id: r.id,
      date: formatDate(r.date),
      user: `${r.user.displayName} <${r.user.email}>`,
      code: r.spot.code,
      site: r.spot.floor.site.name,
      floor: r.spot.floor.name,
      zone: r.spot.zone?.name ?? "—",
      status: r.status === "ACTIVE" ? "Attiva" : "Cancellata",
      createdAt: formatDateTime(r.createdAt),
      createdByName: r.createdBy?.displayName ?? "—",
      cancelledAt: r.status === "CANCELLED" ? formatDateTime(r.updatedAt) : "—",
      cancelledByName:
        r.status === "CANCELLED" ? r.cancelledBy?.displayName ?? "—" : "—",
    }));
  }, [items]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const k = sort.key as keyof typeof a;
      const cmp = String(a[k] ?? "").localeCompare(String(b[k] ?? ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort]);

  // Solo le ACTIVE sono selezionabili per la cancellazione massiva (le
  // CANCELLED non hanno azione utile). Set per lookup O(1) nel render.
  const selectableIds = useMemo(
    () => items.filter((r) => r.status === "ACTIVE").map((r) => r.id),
    [items],
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectableIds.some((id) => selectedIds.has(id));
  function toggleAllSelection() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  }
  function toggleOneSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmBulkCancel() {
    if (selectedIds.size === 0) return;
    setBulkCancelling(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await api.managerBulkCancelReservations(ids);
      setSuccessMsg(
        `${res.cancelled} prenotazion${res.cancelled === 1 ? "e cancellata" : "i cancellate"}.`,
      );
      setBulkCancelOpen(false);
      setSelectedIds(new Set());
      setReloadTick((t) => t + 1);
      onBulkDone(); // refresh anche l'altro tab
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Cancellazione multipla fallita: ${msg}`);
    } finally {
      setBulkCancelling(false);
    }
  }

  const filtersActive =
    siteId !== "" ||
    floorId !== "" ||
    zoneName !== "" ||
    statusFilter !== "ACTIVE" ||
    dateFrom !== null ||
    dateTo !== null ||
    selectedUserIds.length > 0;

  function resetFilters() {
    setSiteId("");
    setFloorId("");
    setZoneName("");
    setStatusFilter("ACTIVE");
    setDateFrom(null);
    setDateTo(null);
    setSelectedUserIds([]);
  }

  // Items selezionati nel MultiSelect: ricalcolati ogni volta che cambia
  // selectedUserIds o la lista users (fetched a livello pagina).
  const selectedUsers = useMemo(
    () => users.filter((u) => selectedUserIds.includes(u.id)),
    [users, selectedUserIds],
  );

  const filtersSummary = (() => {
    const parts: string[] = [];
    parts.push(`Sede: ${sites.find((s) => s.id === siteId)?.name ?? "Tutte"}`);
    parts.push(
      `Piano: ${floorId ? floors.find((f) => f.id === floorId)?.name ?? "—" : "Tutti"}`,
    );
    if (zoneName) parts.push(`Zona: "${zoneName}"`);
    parts.push(
      `Stato: ${
        statusFilter === "ACTIVE"
          ? "Attive"
          : statusFilter === "CANCELLED"
            ? "Cancellate"
            : "Tutti"
      }`,
    );
    if (dateFrom) parts.push(`Da: ${dateFrom}`);
    if (dateTo) parts.push(`A: ${dateTo}`);
    if (selectedUsers.length > 0) {
      parts.push(
        `Utenti: ${selectedUsers.length === 1 ? selectedUsers[0].displayName : `${selectedUsers.length} selezionati`}`,
      );
    }
    return parts.join(" · ");
  })();

  const filtersActiveCount =
    (siteId ? 1 : 0) +
    (floorId ? 1 : 0) +
    (zoneName ? 1 : 0) +
    (statusFilter !== "ACTIVE" ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (selectedUserIds.length > 0 ? 1 : 0);

  // Click su un giorno del calendar: setto Da/A allo stesso ISO e passo
  // al parent per switchare la view a Lista. La fetch effect re-triggererà.
  function handleDayClick(iso: string) {
    setDateFrom(iso);
    setDateTo(iso);
    onSwitchToList();
  }

  // Auto-set Da/A al mese visualizzato dal calendar. Chiamato dal calendar
  // al mount e ad ogni navigazione prev/next. Solo in view === "calendar":
  // in vista lista i Da/A sono user-controlled e non vogliamo che il
  // calendar (smontato) interferisca. Inoltre il calendar viene rimontato
  // ad ogni passaggio calendar→list→calendar — ricomincia da oggi e
  // ri-imposta Da/A automaticamente.
  function handleCalendarMonthChange(firstOfMonth: Date) {
    if (view !== "calendar") return;
    const y = firstOfMonth.getUTCFullYear();
    const m = firstOfMonth.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const mm = String(m + 1).padStart(2, "0");
    setDateFrom(`${y}-${mm}-01`);
    setDateTo(`${y}-${mm}-${String(lastDay).padStart(2, "0")}`);
  }

  // Decide quale azione partire dal bottone primary del modal: aggiorna
  // (transfer a un altro utente) se il manager ha selezionato un utente diverso
  // dall'attuale, altrimenti cancella la prenotazione.
  const isUpdate =
    manageTarget !== null &&
    editUserId !== null &&
    editUserId !== manageTarget.user.id;

  function closeManageModal() {
    if (submitting) return;
    setManageTarget(null);
    setEditUserId(null);
    setManageError(null);
  }

  async function confirmManage() {
    if (!manageTarget) return;
    setSubmitting(true);
    setManageError(null);
    try {
      if (isUpdate && editUserId) {
        await api.managerUpdateReservation(manageTarget.id, editUserId);
        const newUser = users.find((u) => u.id === editUserId);
        const newUserLabel = newUser
          ? `${newUser.displayName} (${newUser.email})`
          : "nuovo utente";
        setSuccessMsg(
          `Prenotazione del ${formatDate(manageTarget.date)} (${manageTarget.spot.code}) trasferita da ${manageTarget.user.displayName} a ${newUserLabel}.`,
        );
      } else {
        await api.managerCancelReservation(manageTarget.id);
        setSuccessMsg(
          `Prenotazione di ${manageTarget.user.displayName} del ${formatDate(
            manageTarget.date,
          )} (${manageTarget.spot.code}) cancellata.`,
        );
      }
      setManageTarget(null);
      setEditUserId(null);
      setReloadTick((t) => t + 1);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      // Mostriamo l'errore DENTRO al modale, non come InlineNotification sopra
      // la tabella (sarebbe nascosta dietro l'overlay). Lasciamo aperto il
      // modale così il manager può correggere la selezione utente e ritentare,
      // o annullare.
      setManageError(`${isUpdate ? "Aggiornamento" : "Cancellazione"} fallit${isUpdate ? "o" : "a"}: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  // Apre il dialog "Prenota per utente". Data preimpostata: se i filtri
  // dateFrom/dateTo coincidono (= giorno singolo), uso quella; altrimenti
  // lascio il dialog scegliere il default (oggi).
  function openBookDialog() {
    const initialDate =
      dateFrom && dateTo && dateFrom === dateTo ? dateFrom : undefined;
    setBookTarget({ type, initialDate });
  }

  function handleBookSuccess() {
    setSuccessMsg("Prenotazione creata con successo.");
    setReloadTick((t) => t + 1);
  }

  // Bulk-create success: chiamato DURANTE l'apertura del modal (mostra report
  // skipped). Triggera il reload globale (entrambi i tab) via `onBulkDone`,
  // ma NON imposta un banner di pagina: il report nel modal È già il feedback
  // ricco (created + skipped), e un banner persisterebbe sopra la
  // lista/calendar anche dopo la chiusura del modal (segnalato come fastidioso
  // nei test). Il manager legge il report nel modal e chiude.
  function handleBulkSuccess(createdCount: number) {
    if (createdCount > 0) {
      setReloadTick((t) => t + 1); // refresh del tab corrente
      onBulkDone(); // refresh dell'altro tab via parent
    }
  }

  return (
    <div className={`rsv-spot-tab rsv-spot-tab--${type.toLowerCase()}`}>
      <FiltersPanel summary={filtersSummary} activeCount={filtersActiveCount}>
        {/* Tre righe semantiche di filtri. Ognuna distribuisce i suoi campi a
            larghezza piena con `auto-fit + minmax`: se lo schermo è stretto,
            gli ultimi campi della riga vanno a capo dentro la stessa riga. */}
        <div className="rsv-filters-stack">
          {/* Riga 1: filtri spaziali (Sede + Piano + Zona). */}
          <div className="rsv-filter-row">
            <Select
              id={`manager-site-${tabKey}`}
              labelText="Sede"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <SelectItem value="" text="Tutte le sedi" />
              {sites.map((s) => (
                <SelectItem key={s.id} value={s.id} text={s.name} />
              ))}
            </Select>
            <Select
              id={`manager-floor-${tabKey}`}
              labelText="Piano"
              value={floorId}
              onChange={(e) => setFloorId(e.target.value)}
              disabled={!siteId}
            >
              <SelectItem value="" text="Tutti i piani" />
              {floors.map((f) => (
                <SelectItem key={f.id} value={f.id} text={f.name} />
              ))}
            </Select>
            {/* Carbon `Search` non mostra `labelText` visivamente (a11y only):
                 il campo finirebbe top-allineato col placeholder mentre Select
                 hanno la label sopra. Wrap manuale con <label> Carbon-styled
                 per uniformare l'altezza alle altre celle della riga. */}
            <div>
              <label
                htmlFor={`manager-zone-${tabKey}`}
                className="cds--label"
              >
                Zona
              </label>
              <Search
                id={`manager-zone-${tabKey}`}
                labelText="Zona"
                placeholder="Cerca zona…"
                size="md"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                onClear={() => setZoneName("")}
              />
            </div>
          </div>

          {/* Riga 2: filtri temporali e di stato (Stato + Da + A). */}
          <div className="rsv-filter-row">
            <Select
              id={`manager-status-${tabKey}`}
              labelText="Stato"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ReservationStatus | "")}
            >
              <SelectItem value="ACTIVE" text="Attive" />
              <SelectItem value="CANCELLED" text="Cancellate" />
              <SelectItem value="" text="Tutti" />
            </Select>
            <DatePicker
              datePickerType="single"
              dateFormat="Y-m-d"
              locale={datePickerLocale}
              value={dateFrom ?? ""}
              onChange={(dates: Date[]) => {
                setDateFrom(dates[0] ? isoFromDate(dates[0]) : null);
              }}
            >
              <DatePickerInput
                id={`manager-date-from-${tabKey}`}
                labelText="Da"
                placeholder="YYYY-MM-DD"
              />
            </DatePicker>
            <DatePicker
              datePickerType="single"
              dateFormat="Y-m-d"
              locale={datePickerLocale}
              value={dateTo ?? ""}
              onChange={(dates: Date[]) => {
                setDateTo(dates[0] ? isoFromDate(dates[0]) : null);
              }}
            >
              <DatePickerInput
                id={`manager-date-to-${tabKey}`}
                labelText="A"
                placeholder="YYYY-MM-DD"
              />
            </DatePicker>
          </div>

          {/* Riga 3: filtro utenti full-width (1 campo, occupa tutta la riga). */}
          <div className="rsv-filter-row">
            <FilterableMultiSelect
              id={`manager-users-${tabKey}`}
              titleText="Utenti"
              placeholder="Seleziona utenti…"
              items={users}
              itemToString={(u: AdminUserItem | null) =>
                u ? `${u.displayName} (${u.email})` : ""
              }
              selectedItems={selectedUsers}
              onChange={({ selectedItems }: { selectedItems: AdminUserItem[] | null }) =>
                setSelectedUserIds((selectedItems ?? []).map((u) => u.id))
              }
            />
          </div>
        </div>

        {filtersActive && (
          <Button kind="ghost" size="sm" onClick={resetFilters}>
            Reset filtri
          </Button>
        )}
      </FiltersPanel>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        {/* Azioni "Prenota per utente" (singola) e "Prenotazione massiva"
            (wizard). Visibili solo in vista Lista. In vista Calendario non
            avrebbero contesto (il manager sceglie giorno e poi cliccare attiva
            il flusso normale di switch a Lista). */}
        {view === "list" ? (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={Add}
              onClick={openBookDialog}
            >
              Prenota per utente…
            </Button>
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={Add}
              onClick={() => setBulkOpen(true)}
            >
              Prenotazione massiva…
            </Button>
            {/* Cancella selezionate: visibile solo con almeno una riga ACTIVE
                selezionata. danger--tertiary = warning visivo senza invadere
                il layout quando non c'è selezione. */}
            {selectedIds.size > 0 && (
              <Button
                kind="danger--tertiary"
                size="sm"
                renderIcon={TrashCan}
                onClick={() => setBulkCancelOpen(true)}
              >
                {`Cancella selezionate (${selectedIds.size})`}
              </Button>
            )}
          </div>
        ) : (
          <span /> // placeholder per mantenere space-between con il Renew
        )}
        <IconButton
          kind="ghost"
          size="sm"
          label="Aggiorna"
          align="bottom-right"
          onClick={() => {
            // Doppio refresh: prenotazioni del tab corrente (state locale) +
            // lista utenti del filtro MultiSelect (state pagina-livello).
            // Così il manager vede subito utenti appena registrati senza F5.
            setReloadTick((t) => t + 1);
            onReloadUsers();
          }}
          disabled={loading}
        >
          <Renew />
        </IconButton>
      </div>

      {error && (
        <InlineNotification
          kind="error"
          title="Errore"
          subtitle={error}
          onCloseButtonClick={() => setError(null)}
          style={{ marginBottom: "1rem" }}
        />
      )}

      {successMsg && (
        <InlineNotification
          kind="success"
          title="Operazione completata"
          subtitle={successMsg}
          onCloseButtonClick={() => setSuccessMsg(null)}
          style={{ marginBottom: "1rem" }}
        />
      )}

      {/* Banner truncated visibile in entrambe le viste: in calendar significa
          "questo mese ha più di LIMIT prenotazioni col filtro corrente",
          quindi count e overlay del calendar sono incompleti — caso raro
          ma rilevante quando capita. Il messaggio è generico ("restringi
          i filtri") perché Da/A sono già auto-impostati al mese. */}
      {truncated && (
        <InlineNotification
          kind="warning"
          title="Risultati troncati"
          subtitle={`Sono visibili solo i primi ${limit} risultati. Restringi i filtri per vedere il resto.`}
          hideCloseButton
          lowContrast
          style={{ marginBottom: "1rem" }}
        />
      )}

      {view === "calendar" ? (
        // Il calendar resta SEMPRE montato durante il loading: il suo state
        // interno (`currentMonth`) si perderebbe al rimount, ricominciando da
        // oggi e ignorando la navigazione prev/next. Lo `<InlineLoading>`
        // appare in aggiunta sopra il calendar senza smontarlo. Items/count
        // mostrati durante il loading sono quelli del fetch precedente —
        // accettabile come stale data, sparisce in <1s al completamento.
        <>
          {loading && <InlineLoading description="Carico le prenotazioni…" />}
          <ManagerReservationsCalendar
            items={items}
            totalCapacity={totalCapacity}
            onDayClick={handleDayClick}
            onMonthChange={handleCalendarMonthChange}
            // Riallinea il calendar al mese di `dateFrom` corrente al rimount
            // (passaggio list→calendar). Senza, il calendar tornerebbe sempre
            // al mese corrente perdendo il contesto temporale.
            initialMonth={dateFrom ? dateFromIso(dateFrom) : undefined}
            closuresByDate={closuresByDate}
          />
        </>
      ) : loading ? (
        <InlineLoading description="Carico le prenotazioni…" />
      ) : rows.length === 0 ? (
        <p style={{ color: "#525252" }}>
          Nessuna prenotazione corrisponde ai filtri applicati.
        </p>
      ) : (
        <DataTable rows={sortedRows} headers={HEADERS}>
          {({ rows: rs, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <TableContainer>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {/* Select-all: agisce solo sulle righe ACTIVE visibili. */}
                    <TableSelectAll
                      id={`manager-select-all-${tabKey}`}
                      name={`manager-select-all-${tabKey}`}
                      ariaLabel="Seleziona tutte le prenotazioni attive"
                      checked={allSelected}
                      indeterminate={!allSelected && someSelected}
                      onSelect={toggleAllSelection}
                      disabled={selectableIds.length === 0}
                    />
                    {headers.map((h) => {
                      const { key, ...headerProps } = getHeaderProps({ header: h });
                      const sortable = SORTABLE_KEYS.has(h.key);
                      const sortDir = sort?.key === h.key ? sort.dir : null;
                      const SortIcon =
                        sortDir === "asc"
                          ? ArrowUp
                          : sortDir === "desc"
                            ? ArrowDown
                            : ArrowsVertical;
                      const sortLabel = sortDir
                        ? `Ordinato ${sortDir === "asc" ? "crescente" : "decrescente"} — clic per ${
                            sortDir === "asc" ? "decrescente" : "rimuovere"
                          }`
                        : `Ordina ${h.header}`;
                      return (
                        <TableHeader key={key} {...headerProps}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.25rem",
                            }}
                          >
                            <span>{h.header}</span>
                            {sortable && (
                              <IconButton
                                kind="ghost"
                                size="sm"
                                label={sortLabel}
                                align="bottom"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSort((prev) => nextSort(prev, h.key));
                                }}
                              >
                                <SortIcon />
                              </IconButton>
                            )}
                          </div>
                        </TableHeader>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rs.map((row) => {
                    const { key: rowKey, ...rowProps } = getRowProps({ row });
                    // Riusa il pattern di MyReservationsList: click riga →
                    // modal di gestione (cancella + cambio intestatario).
                    // Le righe CANCELLED non sono cliccabili (niente azione
                    // utile e cursor default segnala il disabled state).
                    const reservation = items.find((r) => r.id === row.id);
                    const isActive = reservation?.status === "ACTIVE";
                    // Click "gestisci" (apre il modal cancella/transfer):
                    // attaccato alle SINGOLE celle dati, NON alla riga. Così
                    // la cella checkbox (TableSelectRow, separata) non lo
                    // eredita — cliccare la checkbox seleziona soltanto, senza
                    // aprire il modal. `stopPropagation` su Carbon
                    // TableSelectRow non è affidabile (non forwarda onClick),
                    // quindi spostiamo l'azione sulle celle invece di provare
                    // a fermarne la propagazione.
                    const openManage =
                      isActive && reservation
                        ? () => {
                            setManageTarget(reservation);
                            setEditUserId(null);
                          }
                        : undefined;
                    return (
                      <TableRow
                        key={rowKey}
                        {...rowProps}
                        className={isActive ? "rsv-row-clickable" : undefined}
                      >
                        {/* Checkbox di selezione: solo per le ACTIVE. Per le
                            CANCELLED una cella vuota mantiene l'allineamento. */}
                        {isActive ? (
                          <TableSelectRow
                            id={`manager-select-${row.id}`}
                            name={`manager-select-${row.id}`}
                            ariaLabel="Seleziona prenotazione"
                            checked={selectedIds.has(row.id)}
                            onSelect={() => toggleOneSelection(row.id)}
                          />
                        ) : (
                          <TableCell />
                        )}
                        {row.cells.map((cell) => (
                          <TableCell
                            key={cell.id}
                            onClick={openManage}
                            title={
                              isActive ? "Clicca per gestire la prenotazione" : undefined
                            }
                          >
                            {String(cell.value)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}

      {/* Modal di gestione prenotazione (admin): due azioni mutuamente
          esclusive nello stesso modale.
          - Default: bottone rosso "Cancella" (semantica primaria del modale).
          - Click "Cambia utente" → ComboBox preselezionato sull'utente
            attuale; quando il manager sceglie un nome diverso, il bottone si
            trasforma in "Aggiorna" arancione (classe `rsv-modal-update` →
            override Carbon orange-50). Se il manager riseleziona se stesso o
            cancella la selezione, il bottone torna a "Cancella" rosso.
          Mostra contesto completo per evitare azioni accidentali su grandi
          liste. */}
      <Modal
        open={manageTarget !== null}
        danger={!isUpdate}
        className={isUpdate ? "rsv-modal-update" : undefined}
        modalHeading={isUpdate ? "Aggiornare la prenotazione?" : "Cancellare la prenotazione?"}
        primaryButtonText={
          submitting
            ? isUpdate
              ? "Aggiornamento…"
              : "Cancellazione…"
            : isUpdate
              ? "Aggiorna"
              : "Cancella"
        }
        secondaryButtonText="Annulla"
        primaryButtonDisabled={submitting}
        onRequestClose={closeManageModal}
        onRequestSubmit={confirmManage}
      >
        {manageTarget && (
          <>
            {manageError && (
              <InlineNotification
                kind="error"
                title="Errore"
                subtitle={manageError}
                onCloseButtonClick={() => setManageError(null)}
                lowContrast
                style={{ marginBottom: "1rem", maxWidth: "none" }}
              />
            )}
            <p>
              {isUpdate ? "Stai per trasferire" : "Stai per cancellare"} la prenotazione{" "}
              {manageTarget.spot.type === "PARKING"
                ? "del posto auto"
                : "della scrivania"}{" "}
              <strong>{manageTarget.spot.code}</strong> per il{" "}
              <strong>{formatDate(manageTarget.date)}</strong>.
            </p>

            {/* Riga utente: in stato "non in modifica" mostra il nome corrente
                + bottone "Cambia utente"; in stato "modifica" sostituisce con
                un ComboBox preselezionato sull'utente attuale. */}
            <div style={{ margin: "0.75rem 0" }}>
              {editUserId === null ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    Utente:{" "}
                    <strong>
                      {manageTarget.user.displayName} ({manageTarget.user.email})
                    </strong>
                  </span>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => setEditUserId(manageTarget.user.id)}
                    disabled={submitting}
                  >
                    Cambia utente
                  </Button>
                </div>
              ) : (
                <ComboBox
                  id="manage-edit-user"
                  titleText="Nuovo utente"
                  placeholder="Cerca utente…"
                  items={users}
                  itemToString={(u: AdminUserItem | null) =>
                    u ? `${u.displayName} (${u.email})` : ""
                  }
                  selectedItem={users.find((u) => u.id === editUserId) ?? null}
                  onChange={({
                    selectedItem,
                  }: {
                    selectedItem: AdminUserItem | null | undefined;
                  }) => {
                    setEditUserId(selectedItem?.id ?? null);
                    // Cambio utente → l'errore precedente potrebbe non essere
                    // più rilevante (es. il manager ha appena corretto un
                    // conflict). Resettiamo per evitare confusione.
                    setManageError(null);
                  }}
                  disabled={submitting}
                />
              )}
            </div>

            <ul style={{ margin: "0.75rem 0", paddingLeft: "1.25rem" }}>
              <li>
                Sede: <strong>{manageTarget.spot.floor.site.name}</strong>
              </li>
              <li>
                Piano: <strong>{manageTarget.spot.floor.name}</strong>
              </li>
              {manageTarget.spot.zone && (
                <li>
                  Zona: <strong>{manageTarget.spot.zone.name}</strong>
                </li>
              )}
            </ul>
            <p>
              {isUpdate
                ? "L'operazione è immediata. Né il vecchio né il nuovo intestatario ricevono notifica."
                : "L'operazione è immediata. L'utente non riceve notifica."}
            </p>
          </>
        )}
      </Modal>

      <ManagerBookForUserDialog
        target={bookTarget}
        users={users}
        onClose={() => setBookTarget(null)}
        onSuccess={handleBookSuccess}
      />

      <ManagerBulkBookingsDialog
        open={bulkOpen}
        users={users}
        onClose={() => setBulkOpen(false)}
        onSuccess={handleBulkSuccess}
        initialFrom={dateFrom}
        initialTo={dateTo}
      />

      {/* Modal conferma cancellazione massiva. Solo le ACTIVE selezionate
          vengono cancellate (il backend ignora le altre). */}
      <Modal
        open={bulkCancelOpen}
        danger
        modalHeading={`Cancellare ${selectedIds.size} prenotazion${selectedIds.size === 1 ? "e" : "i"}?`}
        primaryButtonText={bulkCancelling ? "Cancellazione…" : "Cancella"}
        secondaryButtonText="Annulla"
        primaryButtonDisabled={bulkCancelling}
        onRequestClose={() => {
          if (!bulkCancelling) setBulkCancelOpen(false);
        }}
        onRequestSubmit={confirmBulkCancel}
      >
        <p>
          Stai per cancellare <strong>{selectedIds.size}</strong>{" "}
          prenotazion{selectedIds.size === 1 ? "e" : "i"}. L&apos;operazione è
          immediata e gli utenti non ricevono notifica.
        </p>
      </Modal>
    </div>
  );
}
