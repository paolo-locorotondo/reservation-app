"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DataTable,
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
  TableCell,
  TableContainer,
  Button,
  IconButton,
  InlineLoading,
  InlineNotification,
  Modal,
  Search,
  Select,
  SelectItem,
  DatePicker,
  DatePickerInput,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  ContentSwitcher,
  Switch,
} from "@carbon/react";
import {
  Filter,
  FilterEdit,
  ArrowsVertical,
  ArrowUp,
  ArrowDown,
  Renew,
} from "@carbon/icons-react";
import { Italian } from "flatpickr/dist/l10n/it.js";
import type { CustomLocale } from "flatpickr/dist/types/locale";
import type { SpotType } from "@reservation/shared";
import { api, ApiError, type MyReservation } from "@/lib/api";
import { FiltersPanel } from "./FiltersPanel";
import { SpotsCalendar } from "./SpotsCalendar";

const HEADERS = [
  { key: "date", header: "Data" },
  { key: "code", header: "Codice" },
  { key: "floor", header: "Piano" },
  { key: "zone", header: "Zona" },
];

const FILTERABLE_KEYS = new Set(["date", "code", "floor", "zone"]);
const SORTABLE_KEYS = new Set(["date", "code", "floor", "zone"]);

type SortState = { key: string; dir: "asc" | "desc" } | null;
function nextSort(prev: SortState, key: string): SortState {
  if (!prev || prev.key !== key) return { key, dir: "asc" };
  if (prev.dir === "asc") return { key, dir: "desc" };
  return null;
}

// Parse "YYYY-MM-DD" → Date UTC al giorno corrispondente. Usato per derivare
// `initialMonth` del calendar dal `dateFrom` corrente del tab (string ISO).
function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoFromDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Limite prenotabile lato client (allineato a MAX_DAYS_AHEAD backend). Serve
// per il no-op del calendar sui giorni FUORI RANGE FUTURI (oltre il limite):
// come per i passati, cliccarli e redirigere a /parking?date=... darebbe solo
// l'errore "data oltre i N giorni". Letto da NEXT_PUBLIC_MAX_DAYS_AHEAD.
const MAX_DAYS_AHEAD = process.env.NEXT_PUBLIC_MAX_DAYS_AHEAD
  ? Number(process.env.NEXT_PUBLIC_MAX_DAYS_AHEAD)
  : 30;
function maxBookableIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + MAX_DAYS_AHEAD);
  return isoFromDate(d);
}

function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // YYYY-MM-DD in UTC (i Reservation hanno granularità @db.Date salvati a 00:00 UTC)
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function MyReservationsList() {
  const router = useRouter();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Carbon Tabs di default è uncontrolled: lo rendiamo controllato perché
  // `selectedIndex` lo usiamo anche per il bottone "Prenota qui ..." sotto
  // l'h1 (label dipende dal tab attivo).
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Toggle vista pagina-livello (condiviso tra i due tab). Default Calendario,
  // coerente con /parking e /desks. Ogni `ReservationsTab` riceve `view` come
  // prop e decide internamente cosa renderizzare (calendar o lista) — stesso
  // pattern di `AdminReservationsList`.
  const [view, setView] = useState<"list" | "calendar">("calendar");
  // Conteggi per-tipo, mostrati nelle label dei tab "Posti auto (N)" /
  // "Scrivanie (N)". Lift up dai `ReservationsTab`: ogni tab ha la propria
  // fetch e notifica via `onCountChange`. Il numero riflette i filtri server
  // attualmente applicati nel tab (Da/A) — in vista calendar coincide col
  // numero di prenotazioni del mese visualizzato. `null` = ancora non
  // caricato → mostra "—".
  const [parkingCount, setParkingCount] = useState<number | null>(null);
  const [deskCount, setDeskCount] = useState<number | null>(null);

  function handleCancelled(msg: string) {
    setSuccessMsg(msg);
    setReloadTick((t) => t + 1);
  }

  // Subtitle dinamico: la calendar view ha logica diversa dal list view (click
  // su giorno con propria prenotazione apre il modal di cancellazione, click su
  // un altro giorno naviga a /parking|/desks).
  const subtitle =
    view === "calendar"
      ? "Prenotazioni attive — clicca un giorno del calendario per prenotare o cancellare la tua prenotazione (i giorni con una prenotazione hanno il bordo blu)."
      : "Prenotazioni attive — clicca una riga per cancellare la prenotazione.";

  return (
    <main>
      <div className="rsv-page-header-row">
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Le mie prenotazioni</h1>
          <p style={{ marginBottom: 0, color: "#525252" }}>{subtitle}</p>
          {/* Scorciatoia "Prenota qui ..." per la vista Lista, sempre visibile
              (anche con tab vuoto): se l'utente non ha ancora prenotazioni di
              questo tipo, è proprio il bottone che gli serve. Label dipende
              dal tab attivo. In Calendario il click sui giorni copre già il
              flusso prenotazione, quindi non lo mostriamo. */}
          {view === "list" && (
            <Button
              kind="ghost"
              size="sm"
              style={{ paddingLeft: 0, marginTop: "0.5rem" }}
              onClick={() =>
                router.push(selectedIndex === 0 ? "/parking" : "/desks")
              }
            >
              {selectedIndex === 0
                ? "Prenota qui i posti auto"
                : "Prenota qui la tua scrivania"}
            </Button>
          )}
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

      {successMsg && (
        <InlineNotification
          kind="success"
          title="Operazione completata"
          subtitle={successMsg}
          onCloseButtonClick={() => setSuccessMsg(null)}
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
            <ReservationsTab
              tabKey="PARKING"
              type="PARKING"
              view={view}
              onCancelled={handleCancelled}
              onReload={() => setReloadTick((t) => t + 1)}
              reloadTick={reloadTick}
              onCountChange={setParkingCount}
            />
          </TabPanel>
          <TabPanel>
            <ReservationsTab
              tabKey="DESK"
              type="DESK"
              view={view}
              onCancelled={handleCancelled}
              onReload={() => setReloadTick((t) => t + 1)}
              reloadTick={reloadTick}
              onCountChange={setDeskCount}
            />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </main>
  );
}

interface ReservationsTabProps {
  tabKey: string;
  type: SpotType;
  // Vista pagina-livello (toggle nel padre). Il tab gestisce sia "list" che
  // "calendar" internamente, simmetrico al pattern AdminReservationsTab.
  view: "list" | "calendar";
  onCancelled: (msg: string) => void;
  // Increment counter dal padre: quando cambia (cancellazione dal calendario,
  // o future altre azioni globali) il tab rifà la propria fetch — incluso
  // nella dep array dell'effect.
  onReload: () => void;
  reloadTick: number;
  // Notifica al padre il numero corrente di items, per la label dei tab
  // "Posti auto (N)" / "Scrivanie (N)".
  onCountChange: (count: number) => void;
}

// Sotto-componente per il contenuto di un tab. Gestisce sia la vista lista
// che il calendar internamente, con una sola fetch per type+Da+A. In vista
// calendar Da/A vengono settati automaticamente al mese visualizzato dal
// SpotsCalendar (handleCalendarMonthChange), così LIMIT e truncated sono
// per-mese — pattern simmetrico ad AdminReservationsTab.
function ReservationsTab({
  tabKey,
  type,
  view,
  onCancelled,
  onReload,
  reloadTick,
  onCountChange,
}: ReservationsTabProps) {
  const router = useRouter();
  // Fetch state (per-tab, simmetrico ad AdminReservationsTab):
  // items + flag truncated + limit + loading + error tutti interni.
  const [items, setItems] = useState<MyReservation[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [limit, setLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtri per la query backend (date range Da/A — stesso pattern admin).
  // Restringono il dataset a livello server: il limit MY_LIST_LIMIT viene
  // applicato DOPO il filtro, quindi truncated è meaningful in relazione
  // ai filtri attuali.
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);

  // Filtri client-side aggiuntivi (sopra il dataset già fetched). Sede/Piano
  // sono derivati dai dati ricevuti — non ha senso offrire opzioni di cui
  // non ci sono prenotazioni.
  const [siteFilter, setSiteFilter] = useState<string>("");
  const [floorFilter, setFloorFilter] = useState<string>("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [cancelTarget, setCancelTarget] = useState<MyReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Overlay closure per il calendar: la fetch è separata da quella delle
  // prenotazioni (endpoint user-level GET /closures, no auth admin). Il
  // calendar mostra cella grigia + tooltip per i giorni bloccati. Click
  // resta abilitato se l'utente ha già una prenotazione lì
  // (gestito in SpotsCalendar via doppio classname --mine + --closed).
  const [closuresByDate, setClosuresByDate] = useState<Map<string, string>>(
    new Map(),
  );
  const [datePickerLocale, setDatePickerLocale] = useState<CustomLocale | undefined>(
    undefined,
  );

  useEffect(() => {
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.startsWith("it")) setDatePickerLocale(Italian);
  }, []);

  // Fetch principale: cleanup guard `cancelled` per evitare race tra effect
  // sovrapposti (es. l'utente cambia rapidamente Da/A). Si re-runna anche al
  // cambio di `reloadTick` propagato dal padre (cancellazione da calendario).
  useEffect(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    api
      .listMyReservations({
        type,
        from: dateFrom ?? undefined,
        to: dateTo ?? undefined,
      })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTruncated(res.truncated);
        setLimit(res.limit);
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
  }, [type, dateFrom, dateTo, reloadTick]);

  // Notifica il count corrente al padre per la label del tab.
  useEffect(() => {
    onCountChange(items.length);
  }, [items, onCountChange]);

  // Fetch closures per il calendar overlay. Best-effort: se fallisce, il
  // calendar mostra le celle senza grigio (niente notifica utente, non
  // bloccante). Range = stesso Da/A della fetch principale (mese visualizzato
  // in vista calendar, oppure range custom dell'utente in vista lista).
  useEffect(() => {
    if (!dateFrom && !dateTo) {
      // Senza un range definito eviterei di scaricare tutte le closure di
      // sempre. Quando l'utente non è ancora atterrato sul calendar (Da/A
      // null), la map resta vuota — il calendar al primo render imposterà
      // Da/A al mese e ri-triggererà questo effect.
      setClosuresByDate(new Map());
      return;
    }
    let cancelled = false;
    api
      .listClosures({
        type,
        from: dateFrom ?? undefined,
        to: dateTo ?? undefined,
      })
      .then((closures) => {
        if (cancelled) return;
        const m = new Map<string, string>();
        for (const c of closures) m.set(c.date, c.reason);
        setClosuresByDate(m);
      })
      .catch(() => {
        if (cancelled) return;
        setClosuresByDate(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [type, dateFrom, dateTo, reloadTick]);

  // Auto-set Da/A al mese visualizzato dal SpotsCalendar — solo in vista
  // calendar. In vista lista i Da/A sono user-controlled. Quando l'utente
  // passa list→calendar→list, i Da/A restano l'ultimo mese visto in
  // calendar (così la lista è già pre-filtrata sullo stesso periodo).
  //
  // Niente clamp al range MAX_DAYS_AHEAD: la lettura delle proprie
  // prenotazioni non è limitata temporalmente (vedi `listMine` backend, che
  // usa parseDateOnly per from/to). MAX_DAYS_AHEAD vale solo per le AZIONI
  // (creazione di nuove prenotazioni) — il calendar mostra freely.
  function handleCalendarMonthChange(firstOfMonth: Date) {
    if (view !== "calendar") return;
    const y = firstOfMonth.getUTCFullYear();
    const m = firstOfMonth.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const mm = String(m + 1).padStart(2, "0");
    setDateFrom(`${y}-${mm}-01`);
    setDateTo(`${y}-${mm}-${String(lastDay).padStart(2, "0")}`);
  }

  // Click su giorno del calendar:
  //  - se l'utente ha una prenotazione in quel giorno → modal di cancel
  //    (sempre, anche su giorni passati: deve poterla gestire);
  //  - altrimenti, se il giorno è PRENOTABILE (oggi o futuro) → naviga a
  //    /parking|/desks per crearne una nuova;
  //  - se è un giorno PASSATO senza prenotazione propria → no-op. Il
  //    calendar ha `unboundedNavigation` per poter *vedere* lo storico, ma
  //    nel passato non c'è nulla da prenotare → evitiamo il redirect inutile
  //    a /parking?date=passato (che mostrerebbe comunque oggi per via del
  //    clamp in SpotsBrowser, confondendo l'utente).
  function handleCalendarDayClick(iso: string) {
    const own = items.find((r) => String(r.date).slice(0, 10) === iso);
    if (own) {
      setCancelTarget(own);
      return;
    }
    // Fuori dal range prenotabile [oggi, oggi+MAX_DAYS_AHEAD] e senza
    // prenotazione propria → no-op (niente redirect a /parking che darebbe
    // errore o mostrerebbe oggi confondendo).
    if (iso < isoFromDate(new Date()) || iso > maxBookableIso()) {
      return;
    }
    const path = type === "PARKING" ? "/parking" : "/desks";
    router.push(`${path}?date=${iso}`);
  }

  // Overlay "giorni-mio" + label "sede · codice" per il SpotsCalendar.
  // Derivati dagli items del tab — il calendar mostra solo le prenotazioni
  // del proprio tipo, già filtrate per il mese tramite Da/A.
  const myReservedDates = useMemo(
    () => new Set(items.map((r) => String(r.date).slice(0, 10))),
    [items],
  );
  const myReservationLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of items) {
      m.set(String(r.date).slice(0, 10), `${r.spot.floor.site.name} · ${r.spot.code}`);
    }
    return m;
  }, [items]);

  // Derivare sedi/piani dalle prenotazioni dell'utente: ha senso solo offrire
  // come filtro le opzioni di cui esistono prenotazioni.
  const sites = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const r of items) map.set(r.spot.floor.site.id, r.spot.floor.site);
    return Array.from(map.values());
  }, [items]);

  const floors = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const r of items) {
      if (siteFilter && r.spot.floor.site.id !== siteFilter) continue;
      map.set(r.spot.floor.id, { id: r.spot.floor.id, name: r.spot.floor.name });
    }
    return Array.from(map.values());
  }, [items, siteFilter]);

  // Reset del piano quando cambia la sede (il piano selezionato potrebbe non
  // essere più valido per la nuova sede).
  useEffect(() => {
    if (!floorFilter) return;
    if (!floors.some((f) => f.id === floorFilter)) setFloorFilter("");
  }, [floors, floorFilter]);

  // Le date sono già filtrate server-side via dateFrom/dateTo nella query;
  // qui restano solo i filtri client (sede/piano).
  const filtered = items.filter((r) => {
    if (siteFilter && r.spot.floor.site.id !== siteFilter) return false;
    if (floorFilter && r.spot.floor.id !== floorFilter) return false;
    return true;
  });

  const rows = filtered.map((r) => ({
    id: r.id,
    date: formatDate(r.date),
    code: r.spot.code,
    floor: r.spot.floor.name,
    zone: r.spot.zone?.name ?? "—",
  }));

  const filteredRows = rows.filter((r) =>
    Object.entries(colFilters).every(([key, q]) => {
      if (!q) return true;
      const cell = String(r[key as keyof typeof r] ?? "");
      return cell.toLowerCase().includes(q.toLowerCase());
    }),
  );

  const sortedRows = sort
    ? [...filteredRows].sort((a, b) => {
        const k = sort.key as keyof typeof a;
        const cmp = String(a[k] ?? "").localeCompare(String(b[k] ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return sort.dir === "asc" ? cmp : -cmp;
      })
    : filteredRows;

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.cancelReservation(cancelTarget.id);
      onCancelled(
        `Prenotazione del ${formatDate(cancelTarget.date)} (${cancelTarget.spot.code}) cancellata.`,
      );
      setCancelTarget(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Cancellazione fallita: ${msg}`);
    } finally {
      setCancelling(false);
    }
  }

  const typeLabel = type === "PARKING" ? "posto auto" : "scrivania";

  const siteName = sites.find((s) => s.id === siteFilter)?.name;
  const floorName = floors.find((f) => f.id === floorFilter)?.name;
  const filtersSummary = (() => {
    const parts = [
      `Sede: ${siteName ?? "Tutte"}`,
      `Piano: ${floorName ?? "Tutti"}`,
    ];
    if (dateFrom) parts.push(`Da: ${dateFrom}`);
    if (dateTo) parts.push(`A: ${dateTo}`);
    return parts.join(" · ");
  })();
  const filtersActiveCount =
    (siteFilter ? 1 : 0) +
    (floorFilter ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    Object.values(colFilters).filter((v) => v && v.length > 0).length;

  return (
    <div className={`rsv-spot-tab rsv-spot-tab--${type.toLowerCase()}`}>
      {/* Vista calendar: SpotsCalendar mostra il mese corrente, click su un
          giorno-mio apre modal cancel, click su un giorno qualunque naviga a
          /parking|/desks per prenotare. Il banner truncated/error sopra il
          calendar è renderizzato sotto la fine del view branch. */}
      {view === "calendar" ? (
        <>
          {error && (
            <InlineNotification
              kind="error"
              title="Errore"
              subtitle={error}
              onCloseButtonClick={() => setError(null)}
              style={{ marginBottom: "1rem" }}
            />
          )}
          {truncated && (
            <InlineNotification
              kind="warning"
              title="Risultati troncati"
              subtitle={`Sono visibili solo le prime ${limit} prenotazioni. Restringi i filtri per vederne altre.`}
              hideCloseButton
              lowContrast
              style={{ marginBottom: "1rem" }}
            />
          )}
          {/* Calendar SEMPRE montato durante il loading: il suo state interno
              `currentMonth` si perderebbe al rimount, ricominciando da oggi
              ad ogni cambio mese (perché il fetch innescato da prev/next
              triggera loading=true → smonta calendar → re-mount → reset).
              `<InlineLoading>` appare in aggiunta senza smontarlo. */}
          {loading && <InlineLoading description="Carico le prenotazioni…" />}
          <SpotsCalendar
            type={type}
            siteId=""
            floorId=""
            myReservedDates={myReservedDates}
            myReservationLabels={myReservationLabels}
            onDayClick={handleCalendarDayClick}
            showAvailability={false}
            onMonthChange={handleCalendarMonthChange}
            unboundedNavigation
            // Celle fuori range [oggi, oggi+MAX] senza prenotazione propria
            // → grigie + cursore divieto (non c'è nulla da prenotare lì). I
            // giorni-miei restano cliccabili (cancel) a qualsiasi data.
            disableOutOfRange
            // Riallinea il calendar al mese di Da/A correnti (settati l'ultima
            // volta dal calendar stesso o dall'utente in vista lista). Letto
            // solo al mount → effetto al ritorno list→calendar.
            initialMonth={dateFrom ? dateFromIso(dateFrom) : undefined}
            closuresByDate={closuresByDate}
          />
        </>
      ) : (
        <>
      <FiltersPanel summary={filtersSummary} activeCount={filtersActiveCount}>
        {/* Stesso layout 2-righe di /admin/reservations:
            riga 1 = filtri spaziali (Sede + Piano + Zona),
            riga 2 = range temporale (Da + A). Le righe usano `auto-fit +
            minmax(260px,1fr)`, quindi su schermi stretti i campi vanno a
            capo dentro la propria riga senza confondersi con quelli di
            altre righe. */}
        <div className="rsv-filters-stack">
          <div className="rsv-filter-row">
            <Select
              id={`site-filter-${tabKey}`}
              labelText="Sede"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
            >
              <SelectItem value="" text="Tutte le sedi" />
              {sites.map((s) => (
                <SelectItem key={s.id} value={s.id} text={s.name} />
              ))}
            </Select>
            <Select
              id={`floor-filter-${tabKey}`}
              labelText="Piano"
              value={floorFilter}
              onChange={(e) => setFloorFilter(e.target.value)}
            >
              <SelectItem value="" text="Tutti i piani" />
              {floors.map((f) => (
                <SelectItem key={f.id} value={f.id} text={f.name} />
              ))}
            </Select>
            {/* Carbon `Search` non mostra `labelText` visivamente (a11y only):
                wrappiamo con una <label> Carbon-styled per uniformare la
                cella alle Select adiacenti — vedi `/admin/reservations`. */}
            <div>
              <label htmlFor={`zone-filter-${tabKey}`} className="cds--label">
                Zona
              </label>
              <Search
                id={`zone-filter-${tabKey}`}
                labelText="Zona"
                placeholder="Cerca zona…"
                size="md"
                value={colFilters.zone ?? ""}
                onChange={(e) =>
                  setColFilters((prev) => ({ ...prev, zone: e.target.value }))
                }
                onClear={() =>
                  setColFilters((prev) => {
                    const { zone: _, ...rest } = prev;
                    return rest;
                  })
                }
              />
            </div>
          </div>

          <div className="rsv-filter-row">
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
                id={`date-from-${tabKey}`}
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
                id={`date-to-${tabKey}`}
                labelText="A"
                placeholder="YYYY-MM-DD"
              />
            </DatePicker>
          </div>
        </div>

        {(siteFilter ||
          floorFilter ||
          dateFrom ||
          dateTo ||
          Object.values(colFilters).some((v) => v && v.length > 0)) && (
          <Button
            kind="ghost"
            size="sm"
            onClick={() => {
              setSiteFilter("");
              setFloorFilter("");
              setDateFrom(null);
              setDateTo(null);
              setColFilters({});
              setOpenFilter(null);
            }}
          >
            Reset filtri
          </Button>
        )}
      </FiltersPanel>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
        <IconButton
          kind="ghost"
          size="sm"
          label="Aggiorna prenotazioni"
          align="bottom-right"
          onClick={onReload}
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

      {truncated && (
        <InlineNotification
          kind="warning"
          title="Risultati troncati"
          subtitle={`Sono visibili solo le prime ${limit} prenotazioni. Restringi i filtri per vederne altre.`}
          hideCloseButton
          lowContrast
          style={{ marginBottom: "1rem" }}
        />
      )}

      {items.length > 0 && filteredRows.length === 0 && (
        <InlineNotification
          kind="warning"
          title="Nessun risultato"
          subtitle="Nessuna prenotazione corrisponde ai filtri applicati."
          hideCloseButton
          lowContrast
          style={{ marginBottom: "1rem" }}
        />
      )}

      {items.length === 0 ? (
        <p style={{ color: "#525252" }}>
          Nessuna prenotazione attiva per questo tipo.
        </p>
      ) : (
        <DataTable rows={sortedRows} headers={HEADERS}>
          {({ rows: rs, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <TableContainer>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {headers.map((h) => {
                      const { key, ...headerProps } = getHeaderProps({ header: h });
                      const filterable = FILTERABLE_KEYS.has(h.key);
                      const sortable = SORTABLE_KEYS.has(h.key);
                      const value = colFilters[h.key] ?? "";
                      const isOpen = openFilter === h.key;
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
                              flexDirection: "column",
                              gap: "0.25rem",
                            }}
                          >
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
                              {filterable && (
                                <IconButton
                                  kind="ghost"
                                  size="sm"
                                  label={
                                    value
                                      ? `Filtro attivo: "${value}"`
                                      : `Filtra ${h.header}`
                                  }
                                  align="bottom"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenFilter(isOpen ? null : h.key);
                                  }}
                                >
                                  {value ? <FilterEdit /> : <Filter />}
                                </IconButton>
                              )}
                            </div>
                            {filterable && isOpen && (
                              <Search
                                id={`col-filter-${tabKey}-${h.key}`}
                                labelText={`Filtra ${h.header}`}
                                placeholder="Filtra…"
                                size="sm"
                                value={value}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setColFilters((prev) => ({
                                    ...prev,
                                    [h.key]: e.target.value,
                                  }))
                                }
                                onClear={() =>
                                  setColFilters((prev) => {
                                    const { [h.key]: _, ...rest } = prev;
                                    return rest;
                                  })
                                }
                              />
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
                    const original = items.find((i) => i.id === row.id);
                    return (
                      <TableRow
                        key={rowKey}
                        {...rowProps}
                        className="rsv-row-clickable"
                        onClick={() => original && setCancelTarget(original)}
                        title="Clicca per cancellare la prenotazione"
                      >
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{String(cell.value)}</TableCell>
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
        </>
      )}

      <Modal
        open={cancelTarget !== null}
        danger
        modalHeading="Cancellare la prenotazione?"
        primaryButtonText={cancelling ? "Cancellazione…" : "Cancella"}
        secondaryButtonText="Annulla"
        primaryButtonDisabled={cancelling}
        onRequestClose={() => {
          if (!cancelling) setCancelTarget(null);
        }}
        onRequestSubmit={confirmCancel}
      >
        {cancelTarget && (
          <>
            <p>
              Stai per cancellare la prenotazione del {typeLabel}{" "}
              <strong>{cancelTarget.spot.code}</strong> per il{" "}
              <strong>{formatDate(cancelTarget.date)}</strong>.
            </p>
            <ul style={{ margin: "0.75rem 0", paddingLeft: "1.25rem" }}>
              <li>
                Sede: <strong>{cancelTarget.spot.floor.site.name}</strong>
              </li>
              <li>
                Piano: <strong>{cancelTarget.spot.floor.name}</strong>
              </li>
              {cancelTarget.spot.zone && (
                <li>
                  Zona: <strong>{cancelTarget.spot.zone.name}</strong>
                </li>
              )}
            </ul>
            <p>L&apos;operazione è immediata.</p>
          </>
        )}
      </Modal>
    </div>
  );
}
