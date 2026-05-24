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
} from "@carbon/react";
import { Filter, FilterEdit, ArrowsVertical, ArrowUp, ArrowDown } from "@carbon/icons-react";
import { Italian } from "flatpickr/dist/l10n/it.js";
import type { CustomLocale } from "flatpickr/dist/types/locale";
import type { Site, Floor, SpotType, SpotWithAvailability } from "@reservation/shared";
import { api, ApiError } from "@/lib/api";
import { BookingDialog, type BookingTarget } from "./BookingDialog";

interface Props {
  type: SpotType;
  title: string;
  subtitle: string;
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

export function SpotsBrowser({ type, title, subtitle }: Props) {
  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [floorId, setFloorId] = useState<string>("");
  const [date, setDate] = useState<string>(todayIso());
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
    setLoading(true);
    setError(null);
    api
      .listSpots({ type, date, siteId: siteId || undefined, floorId: floorId || undefined })
      .then(setSpots)
      .catch((e: ApiError) => setError(`Caricamento posti: ${e.message}`))
      .finally(() => setLoading(false));
  }, [type, date, siteId, floorId, reloadTick]);

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

  return (
    <main>
      <h1 style={{ marginBottom: "0.25rem" }}>{title}</h1>
      <p style={{ marginBottom: "2rem", color: "#525252" }}>{subtitle}</p>

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
          title="Prenotazione confermata"
          subtitle={successMsg}
          onCloseButtonClick={() => setSuccessMsg(null)}
          style={{ marginBottom: "1rem" }}
        />
      )}

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
      />
    </main>
  );
}
