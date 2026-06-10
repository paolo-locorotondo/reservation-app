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
  Select,
  SelectItem,
  DatePicker,
  DatePickerInput,
  InlineLoading,
  InlineNotification,
  IconButton,
  Search,
  Button,
  ContentSwitcher,
  Switch,
} from "@carbon/react";
import { Filter, FilterEdit, ArrowsVertical, ArrowUp, ArrowDown, Renew } from "@carbon/icons-react";
import { Italian } from "flatpickr/dist/l10n/it.js";
import type { CustomLocale } from "flatpickr/dist/types/locale";
import type { Site, Floor, SpotType, SpotWithAvailability } from "@reservation/shared";
import { api, ApiError, type MyReservation } from "@/lib/api";
import { BookingDialog, type BookingTarget } from "./BookingDialog";
import { FiltersPanel } from "./FiltersPanel";
import { SpotsCalendar } from "./SpotsCalendar";

interface Props {
  type: SpotType;
  title: string;
  // YYYY-MM-DD opzionale: usato come date filter iniziale invece di "oggi".
  // Sorgenti: query string `?date=...` (deep link da /my-reservations calendar),
  // futuri link esterni (Slack, email). Validato a fallback su "oggi" se non
  // matcha il formato o è nel passato.
  initialDate?: string;
}

const HEADERS = [
  { key: "code", header: "Codice" },
  { key: "floor", header: "Piano" },
  { key: "zone", header: "Zona" },
];

const FILTERABLE_KEYS = new Set(["code", "floor", "zone"]);
const SORTABLE_KEYS = new Set(["code", "floor", "zone"]);

type SortState = { key: string; dir: "asc" | "desc" } | null;
function nextSort(prev: SortState, key: string): SortState {
  if (!prev || prev.key !== key) return { key, dir: "asc" };
  if (prev.dir === "asc") return { key, dir: "desc" };
  return null;
}

type StatusFilter = "AVAILABLE" | "OCCUPIED" | null;
function nextStatus(prev: StatusFilter, target: "AVAILABLE" | "OCCUPIED"): StatusFilter {
  if (prev !== target) return target;
  return null;
}

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function isoFromDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Accetta una stringa solo se è nel formato YYYY-MM-DD e >= oggi. Altrimenti
// fallback su today. Evita di partire con una `date` invalida che farebbe poi
// fallire la lista degli spots (date in the past).
function sanitizeInitialDate(s: string | undefined): string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return todayIso();
  return s < todayIso() ? todayIso() : s;
}

export function SpotsBrowser({ type, title, initialDate }: Props) {
  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [floorId, setFloorId] = useState<string>("");
  const [date, setDate] = useState<string>(() => sanitizeInitialDate(initialDate));
  const [spots, setSpots] = useState<SpotWithAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingTarget, setBookingTarget] = useState<BookingTarget | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Filtri per-colonna: chiave colonna → testo digitato. `openFilter` è la
  // colonna con l'input attualmente aperto (al massimo uno per volta).
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  // Toggle Calendario / Lista. State locale (no URL): coerente con gli altri
  // filtri di pagina. Default Calendario: la panoramica mensile è il punto di
  // partenza naturale ("vedo i giorni con disponibilità → scelgo quale").
  // Eccezione: con un `?date=YYYY-MM-DD` nell'URL (deep link da
  // /my-reservations calendar o futuri link esterni) partiamo in Lista, perché
  // l'intent è "guarda i posti di QUEL giorno" e la lista è già filtrata
  // sulla data dal `sanitizeInitialDate`.
  const [view, setView] = useState<"list" | "calendar">(
    initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? "list" : "calendar",
  );
  // Date YYYY-MM-DD delle proprie ACTIVE per `type`: usate dal calendario per
  // disegnare il bordo "--mine" sui giorni dove ho già prenotato. Si aggiorna
  // ad ogni `reloadTick` (anche dopo create/cancel) e quando entro in calendar.
  const [myReservedDates, setMyReservedDates] = useState<Set<string>>(new Set());
  // Locale Flatpickr derivato dal browser. Lo settiamo dopo il mount per evitare
  // mismatch SSR (`navigator` non esiste lato server).
  const [datePickerLocale, setDatePickerLocale] = useState<CustomLocale | undefined>(undefined);

  useEffect(() => {
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.startsWith("it")) setDatePickerLocale(Italian);
  }, []);

  // sites: una sola volta
  useEffect(() => {
    api
      .listSites()
      .then((s) => {
        setSites(s);
        if (s.length > 0 && !siteId) setSiteId(s[0].id);
      })
      .catch((e: ApiError) => setError(`Caricamento sedi: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // floors al cambio di site
  useEffect(() => {
    if (!siteId) return;
    setFloorId("");
    api
      .listFloors(siteId)
      .then(setFloors)
      .catch((e: ApiError) => setError(`Caricamento piani: ${e.message}`));
  }, [siteId]);

  // spots: ricarica al cambio dei filtri
  useEffect(() => {
    if (!date) return;
    // Aspettiamo che siteId sia popolato da listSites() prima di chiedere i
    // posti. Senza questa guard parte un primo fetch con siteId omesso (=
    // posti di TUTTE le sedi), poi al cambio di siteId rifa il fetch con
    // quella selezionata. Se la prima risposta arriva dopo la seconda (race),
    // l'utente vede i posti sbagliati per qualche istante (es. "P-001" della
    // sede Test invece di "P-01" di Bari).
    if (!siteId) {
      setSpots([]);
      return;
    }
    setLoading(true);
    setError(null);
    // Cleanup guard: se i filtri cambiano mentre la fetch è in volo, la sua
    // risposta verrà ignorata. Stesso pattern usato in SpotsCalendar.
    let cancelled = false;
    api
      .listSpots({ type, date, siteId, floorId: floorId || undefined })
      .then((arr) => {
        if (cancelled) return;
        setSpots(arr);
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setError(`Caricamento posti: ${e.message}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, date, siteId, floorId, reloadTick]);

  // myReservedDates: serve solo in vista calendario per il bordo "--mine".
  // Fetch on demand (la prima volta che l'utente apre il calendario) + ad ogni
  // reloadTick (così dopo prenotazione/cancellazione il bordo si aggiorna).
  // Il set è filtrato anche per sede/piano: il bordo blu deve riflettere solo
  // le proprie prenotazioni che matchano i filtri correnti del calendario,
  // altrimenti cambiando sede vedresti bordi "fantasma" su giorni in cui hai
  // prenotato altrove.
  useEffect(() => {
    if (view !== "calendar") return;
    api
      .listMyReservations()
      .then((items: MyReservation[]) => {
        const set = new Set<string>();
        for (const r of items) {
          if (r.spot.type !== type) continue;
          if (r.status !== "ACTIVE") continue;
          if (siteId && r.spot.floor.site.id !== siteId) continue;
          if (floorId && r.spot.floor.id !== floorId) continue;
          // r.date arriva come ISO datetime (es. "2026-06-09T00:00:00.000Z");
          // estraiamo i primi 10 char per avere YYYY-MM-DD.
          set.add(String(r.date).slice(0, 10));
        }
        setMyReservedDates(set);
      })
      .catch(() => {
        // Errore non bloccante: il calendario funziona comunque, perdiamo solo
        // l'overlay. Non sovrascriviamo `error` perché è già usato per gli spots.
        setMyReservedDates(new Set());
      });
  }, [view, type, siteId, floorId, reloadTick]);

  const floorById = useMemo(
    () => Object.fromEntries(floors.map((f) => [f.id, f.name])),
    [floors],
  );

  const rows = spots.map((s) => ({
    id: s.id,
    code: s.code,
    floor: floorById[s.floorId] ?? "—",
    zone: s.zoneName ?? "—",
  }));

  const matchesColFilters = (r: (typeof rows)[number]) =>
    Object.entries(colFilters).every(([key, q]) => {
      if (!q) return true;
      const cell = String(r[key as keyof typeof r] ?? "");
      return cell.toLowerCase().includes(q.toLowerCase());
    });

  // Conteggi calcolati sul set filtrato solo per colonne (non per stato), così
  // che cliccare un chip non azzeri il conteggio dell'altro.
  const colOnlyRows = rows.filter(matchesColFilters);
  const availableCount = colOnlyRows.filter(
    (r) => spots.find((s) => s.id === r.id)?.available,
  ).length;
  const occupiedCount = colOnlyRows.length - availableCount;

  const statusFilteredRows = statusFilter
    ? rows.filter((r) => {
        const available = spots.find((s) => s.id === r.id)?.available ?? false;
        return statusFilter === "AVAILABLE" ? available : !available;
      })
    : rows;

  const filteredRows = statusFilteredRows.filter(matchesColFilters);

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

  const defaultSiteId = sites[0]?.id ?? "";
  const filtersActive =
    siteId !== defaultSiteId ||
    floorId !== "" ||
    date !== todayIso() ||
    statusFilter !== null ||
    Object.values(colFilters).some((v) => v && v.length > 0);

  function resetFilters() {
    setSiteId(defaultSiteId);
    setFloorId("");
    setDate(todayIso());
    setStatusFilter(null);
    setColFilters({});
    setOpenFilter(null);
  }

  // Subtitle calcolato in base a vista + tipo. La differenza tra liste e
  // calendario: in lista clicchi una "riga", in calendar clicchi un "giorno";
  // in calendar non c'è il filtro Data perché lo è il calendario stesso.
  const itemLabel = type === "PARKING" ? "il posto" : "la scrivania";
  const subtitle =
    view === "calendar"
      ? `Filtra per sede, piano e/o Zona, poi clicca un giorno del calendario verde per prenotare ${itemLabel}.`
      : `Filtra per sede, piano, data e/o Zona, poi clicca una riga verde per prenotare ${itemLabel}.`;

  return (
    <main>
      <div className="rsv-page-header-row">
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>{title}</h1>
          <p style={{ marginBottom: 0, color: "#525252" }}>{subtitle}</p>
        </div>
        {/* ContentSwitcher di Carbon vuole `selectedIndex` 0/1 e onChange con
            { name }. Mappiamo manualmente "list"/"calendar" su 0/1. */}
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

      <FiltersPanel
        summary={`Sede: ${sites.find((s) => s.id === siteId)?.name ?? "—"} · Piano: ${
          floorId ? floors.find((f) => f.id === floorId)?.name ?? "—" : "Tutti"
        } · Data: ${date}`}
        activeCount={
          (floorId ? 1 : 0) +
          Object.values(colFilters).filter((v) => v && v.length > 0).length +
          (statusFilter ? 1 : 0)
        }
      >
        <div className="rsv-filter-grid">
          <Select
            id="site-select"
            labelText="Sede"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
          >
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id} text={s.name} />
            ))}
          </Select>
          <Select
            id="floor-select"
            labelText="Piano"
            value={floorId}
            onChange={(e) => setFloorId(e.target.value)}
          >
            <SelectItem value="" text="Tutti i piani" />
            {floors.map((f) => (
              <SelectItem key={f.id} value={f.id} text={f.name} />
            ))}
          </Select>
          {/* DatePicker nascosto in vista Calendario: il calendario stesso è il
              picker. Si riattiva quando torni alla Lista (anche via click su un
              giorno: in quel caso `date` è già stata aggiornata). */}
          {view === "list" && (
            <DatePicker
              datePickerType="single"
              dateFormat="Y-m-d"
              locale={datePickerLocale}
              value={date}
              minDate={todayIso()}
              onChange={(dates: Date[]) => {
                if (dates[0]) setDate(isoFromDate(dates[0]));
              }}
            >
              <DatePickerInput
                id="date-picker"
                labelText="Data"
                placeholder="YYYY-MM-DD"
              />
            </DatePicker>
          )}
        </div>

        {/* Filtro Zona esterno: utile soprattutto su mobile dove la colonna è
            comunque visibile ma il popover dell'header può essere scomodo da
            aprire. È bound allo stesso `colFilters.zone` del filtro per-colonna,
            così i due input restano sincronizzati. */}
        <div className="rsv-secondary-filter">
          <Search
            id="zone-filter-external"
            labelText="Filtra per zona"
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

        {filtersActive && (
          <Button kind="ghost" size="sm" onClick={resetFilters}>
            Reset filtri
          </Button>
        )}
      </FiltersPanel>

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
          title="Prenotazione confermata"
          subtitle={successMsg}
          onCloseButtonClick={() => setSuccessMsg(null)}
          style={{ marginBottom: "1rem" }}
        />
      )}

      {view === "calendar" ? (
        <SpotsCalendar
          type={type}
          siteId={siteId}
          floorId={floorId}
          zoneName={colFilters.zone}
          myReservedDates={myReservedDates}
          onDayClick={(iso) => {
            setDate(iso);
            setView("list");
          }}
        />
      ) : (
      <>
      <div className="rsv-table-toolbar">
        <div className="rsv-legend" aria-label="Filtra per stato">
          <button
            type="button"
            className="rsv-legend-chip"
            aria-pressed={statusFilter === "AVAILABLE"}
            onClick={() => setStatusFilter((p) => nextStatus(p, "AVAILABLE"))}
          >
            <span className="rsv-legend-swatch rsv-legend-swatch--available" />
            Disponibile ({availableCount})
          </button>
          <button
            type="button"
            className="rsv-legend-chip"
            aria-pressed={statusFilter === "OCCUPIED"}
            onClick={() => setStatusFilter((p) => nextStatus(p, "OCCUPIED"))}
          >
            <span className="rsv-legend-swatch rsv-legend-swatch--occupied" />
            Occupato ({occupiedCount})
          </button>
        </div>
        <IconButton
          kind="ghost"
          size="sm"
          label="Aggiorna posti"
          align="bottom-right"
          onClick={() => setReloadTick((t) => t + 1)}
          disabled={loading}
        >
          <Renew />
        </IconButton>
      </div>

      {!loading && rows.length > 0 && filteredRows.length === 0 && (
        <InlineNotification
          kind="warning"
          title="Nessun risultato"
          subtitle="Nessun posto corrisponde ai filtri di colonna applicati."
          hideCloseButton
          lowContrast
          style={{ marginBottom: "1rem" }}
        />
      )}

      {loading ? (
        <InlineLoading description="Carico i posti…" />
      ) : rows.length === 0 ? (
        <p style={{ color: "#525252" }}>Nessun posto trovato per i filtri selezionati.</p>
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
                        sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowsVertical;
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
                                  label={value ? `Filtro attivo: "${value}"` : `Filtra ${h.header}`}
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
                                id={`col-filter-${h.key}`}
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
                    const spot = spots.find((s) => s.id === row.id);
                    const available = spot?.available ?? false;
                    const { key: rowKey, ...rowProps } = getRowProps({ row });
                    const code = row.cells.find((c) => c.info.header === "code")
                      ?.value as string;
                    return (
                      <TableRow
                        key={rowKey}
                        {...rowProps}
                        className={available ? "rsv-row-available" : "rsv-row-occupied"}
                        onClick={() => {
                          if (!available) return;
                          setBookingTarget({
                            spotId: row.id,
                            spotCode: code,
                            date,
                            type,
                            // Tutti gli spot mostrati appartengono al `siteId`
                            // selezionato (il filtro sede è obbligatorio in
                            // SpotsBrowser, default = sites[0].id), quindi il
                            // lookup del nome è diretto. Piano e zona arrivano
                            // dalla row corrente.
                            siteName: sites.find((s) => s.id === siteId)?.name ?? "—",
                            floorName: floorById[spot?.floorId ?? ""] ?? "—",
                            zoneName: spot?.zoneName ?? null,
                          });
                        }}
                        title={available ? "Clicca per prenotare" : "Posto non disponibile"}
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

      <BookingDialog
        target={bookingTarget}
        onClose={() => setBookingTarget(null)}
        onSuccess={() => {
          if (bookingTarget) {
            setSuccessMsg(
              `${bookingTarget.spotCode} prenotato per il ${bookingTarget.date}.`,
            );
          }
          setReloadTick((t) => t + 1);
        }}
        onConflict={() => setReloadTick((t) => t + 1)}
      />
    </main>
  );
}
