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

function isoFromDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
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
  const [items, setItems] = useState<MyReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Carbon Tabs di default è uncontrolled: se smontiamo durante un reload,
  // al rimontaggio torna al primo tab. Lo rendiamo controllato e teniamo
  // Tabs sempre montato durante i reload (vedi `isInitialLoad` sotto).
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .listMyReservations()
      .then(setItems)
      .catch((e: ApiError) => setError(`Caricamento prenotazioni: ${e.message}`))
      .finally(() => {
        setLoading(false);
        setHasLoadedOnce(true);
      });
  }, [reloadTick]);

  const parkingItems = useMemo(
    () => items.filter((r) => r.spot.type === "PARKING"),
    [items],
  );
  const deskItems = useMemo(
    () => items.filter((r) => r.spot.type === "DESK"),
    [items],
  );

  function handleCancelled(msg: string) {
    setSuccessMsg(msg);
    setReloadTick((t) => t + 1);
  }

  return (
    <main>
      <h1 style={{ marginBottom: "0.25rem" }}>Le mie prenotazioni</h1>
      <p style={{ marginBottom: "2rem", color: "#525252" }}>
        Prenotazioni attive — clicca una riga per cancellare la prenotazione.
      </p>

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

      {loading && !hasLoadedOnce ? (
        <InlineLoading description="Carico le prenotazioni…" />
      ) : items.length === 0 ? (
        <p style={{ color: "#525252" }}>Non hai prenotazioni attive.</p>
      ) : (
        <Tabs
          selectedIndex={selectedIndex}
          onChange={({ selectedIndex: i }) => setSelectedIndex(i)}
        >
          <TabList aria-label="Tipo di prenotazione" contained>
            <Tab>{`Posti auto (${parkingItems.length})`}</Tab>
            <Tab>{`Scrivanie (${deskItems.length})`}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <ReservationsTab
                tabKey="PARKING"
                type="PARKING"
                items={parkingItems}
                onCancelled={handleCancelled}
                onError={(m) => setError(m)}
                onReload={() => setReloadTick((t) => t + 1)}
                loading={loading}
              />
            </TabPanel>
            <TabPanel>
              <ReservationsTab
                tabKey="DESK"
                type="DESK"
                items={deskItems}
                onCancelled={handleCancelled}
                onError={(m) => setError(m)}
                onReload={() => setReloadTick((t) => t + 1)}
                loading={loading}
              />
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}
    </main>
  );
}

interface ReservationsTabProps {
  tabKey: string;
  type: SpotType;
  items: MyReservation[];
  onCancelled: (msg: string) => void;
  onError: (msg: string) => void;
  onReload: () => void;
  loading: boolean;
}

// Sotto-componente per il contenuto di un tab. Ogni istanza ha il proprio
// stato dei filtri (siteId/floorId/dateFilter/colFilters/sort), così PARKING e
// DESK sono indipendenti come da spec.
function ReservationsTab({
  tabKey,
  type,
  items,
  onCancelled,
  onError,
  onReload,
  loading,
}: ReservationsTabProps) {
  const [siteFilter, setSiteFilter] = useState<string>("");
  const [floorFilter, setFloorFilter] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [cancelTarget, setCancelTarget] = useState<MyReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [datePickerLocale, setDatePickerLocale] = useState<CustomLocale | undefined>(
    undefined,
  );

  useEffect(() => {
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.startsWith("it")) setDatePickerLocale(Italian);
  }, []);

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

  const filtered = items.filter((r) => {
    if (siteFilter && r.spot.floor.site.id !== siteFilter) return false;
    if (floorFilter && r.spot.floor.id !== floorFilter) return false;
    if (dateFilter && formatDate(r.date) !== dateFilter) return false;
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
      onError(`Cancellazione fallita: ${msg}`);
    } finally {
      setCancelling(false);
    }
  }

  const typeLabel = type === "PARKING" ? "posto auto" : "scrivania";

  const siteName = sites.find((s) => s.id === siteFilter)?.name;
  const floorName = floors.find((f) => f.id === floorFilter)?.name;
  const filtersSummary = `Sede: ${siteName ?? "Tutte"} · Piano: ${floorName ?? "Tutti"} · Data: ${dateFilter ?? "Tutte"}`;
  const filtersActiveCount =
    (siteFilter ? 1 : 0) +
    (floorFilter ? 1 : 0) +
    (dateFilter ? 1 : 0) +
    Object.values(colFilters).filter((v) => v && v.length > 0).length;

  return (
    <>
      <FiltersPanel summary={filtersSummary} activeCount={filtersActiveCount}>
        <div className="rsv-filter-grid">
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
          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            locale={datePickerLocale}
            value={dateFilter ?? ""}
            onChange={(dates: Date[]) => {
              setDateFilter(dates[0] ? isoFromDate(dates[0]) : null);
            }}
          >
            <DatePickerInput
              id={`date-filter-${tabKey}`}
              labelText="Data"
              placeholder="YYYY-MM-DD"
            />
          </DatePicker>
        </div>

        <div className="rsv-secondary-filter">
          <Search
            id={`zone-filter-${tabKey}`}
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

        {(siteFilter ||
          floorFilter ||
          dateFilter ||
          Object.values(colFilters).some((v) => v && v.length > 0)) && (
          <Button
            kind="ghost"
            size="sm"
            onClick={() => {
              setSiteFilter("");
              setFloorFilter("");
              setDateFilter(null);
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
          <p>
            Stai per cancellare la prenotazione del {typeLabel}{" "}
            <strong>{cancelTarget.spot.code}</strong> per il{" "}
            <strong>{formatDate(cancelTarget.date)}</strong>. L&apos;operazione è
            immediata.
          </p>
        )}
      </Modal>
    </>
  );
}
