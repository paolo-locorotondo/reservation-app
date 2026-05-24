"use client";

import { useEffect, useState } from "react";
import {
  DataTable,
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
  TableCell,
  TableContainer,
  Tag,
  Button,
  IconButton,
  InlineLoading,
  InlineNotification,
  Modal,
  Search,
  DatePicker,
  DatePickerInput,
} from "@carbon/react";
import {
  Filter,
  FilterEdit,
  ArrowsVertical,
  ArrowUp,
  ArrowDown,
} from "@carbon/icons-react";
import { Italian } from "flatpickr/dist/l10n/it.js";
import type { CustomLocale } from "flatpickr/dist/types/locale";
import { api, ApiError, type MyReservation } from "@/lib/api";

const HEADERS = [
  { key: "date", header: "Data" },
  { key: "type", header: "Tipo" },
  { key: "code", header: "Codice" },
  { key: "site", header: "Sede" },
  { key: "floor", header: "Piano" },
  { key: "zone", header: "Zona" },
  { key: "actions", header: "" },
];

const FILTERABLE_KEYS = new Set(["date", "type", "code", "site", "floor", "zone"]);
const SORTABLE_KEYS = new Set(["date", "type", "code", "site", "floor", "zone"]);

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

export function MyReservationsList() {
  const [items, setItems] = useState<MyReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MyReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  // Filtro globale "data esatta" via DatePicker. `null` = nessun filtro.
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [datePickerLocale, setDatePickerLocale] = useState<CustomLocale | undefined>(undefined);

  useEffect(() => {
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.startsWith("it")) setDatePickerLocale(Italian);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .listMyReservations()
      .then(setItems)
      .catch((e: ApiError) => setError(`Caricamento prenotazioni: ${e.message}`))
      .finally(() => setLoading(false));
  }, [reloadTick]);

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.cancelReservation(cancelTarget.id);
      setSuccessMsg(
        `Prenotazione del ${formatDate(cancelTarget.date)} (${cancelTarget.spot.code}) cancellata.`,
      );
      setCancelTarget(null);
      setReloadTick((t) => t + 1);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Cancellazione fallita: ${msg}`);
    } finally {
      setCancelling(false);
    }
  }

  // `typeLabel` viene normalizzato così l'utente può filtrare digitando
  // "auto"/"scrivania" anziché "PARKING"/"DESK" (etichette mostrate nella UI).
  const rows = items.map((r) => ({
    id: r.id,
    date: formatDate(r.date),
    type: r.spot.type,
    typeLabel: r.spot.type === "PARKING" ? "Posto auto" : "Scrivania",
    code: r.spot.code,
    site: r.spot.floor.site.name,
    floor: r.spot.floor.name,
    zone: r.spot.zone?.name ?? "—",
  }));

  const filteredRows = rows.filter((r) => {
    if (dateFilter && r.date !== dateFilter) return false;
    return Object.entries(colFilters).every(([key, q]) => {
      if (!q) return true;
      const cell = key === "type" ? r.typeLabel : String(r[key as keyof typeof r] ?? "");
      return cell.toLowerCase().includes(q.toLowerCase());
    });
  });

  const sortedRows = sort
    ? [...filteredRows].sort((a, b) => {
        const k = sort.key === "type" ? "typeLabel" : sort.key;
        const va = a[k as keyof typeof a];
        const vb = b[k as keyof typeof b];
        const cmp = String(va ?? "").localeCompare(String(vb ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return sort.dir === "asc" ? cmp : -cmp;
      })
    : filteredRows;

  return (
    <main>
      <h1 style={{ marginBottom: "0.25rem" }}>Le mie prenotazioni</h1>
      <p style={{ marginBottom: "2rem", color: "#525252" }}>
        Prenotazioni attive — puoi cancellarle in qualsiasi momento.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "1rem",
          marginBottom: "2rem",
          maxWidth: "320px",
        }}
      >
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
            id="my-res-date-filter"
            labelText="Filtra per data"
            placeholder="YYYY-MM-DD"
          />
        </DatePicker>
        {dateFilter && (
          <Button kind="ghost" size="sm" onClick={() => setDateFilter(null)}>
            Rimuovi filtro data
          </Button>
        )}
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

      {!loading && rows.length > 0 && filteredRows.length === 0 && (
        <InlineNotification
          kind="warning"
          title="Nessun risultato"
          subtitle="Nessuna prenotazione corrisponde ai filtri applicati."
          hideCloseButton
          lowContrast
          style={{ marginBottom: "1rem" }}
        />
      )}

      {loading ? (
        <InlineLoading description="Carico le prenotazioni…" />
      ) : rows.length === 0 ? (
        <p style={{ color: "#525252" }}>Non hai prenotazioni attive.</p>
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
                    const { key: rowKey, ...rowProps } = getRowProps({ row });
                    const original = items.find((i) => i.id === row.id);
                    return (
                      <TableRow key={rowKey} {...rowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === "type") {
                            const t = cell.value as string;
                            return (
                              <TableCell key={cell.id}>
                                <Tag type={t === "PARKING" ? "blue" : "purple"}>
                                  {t === "PARKING" ? "Posto auto" : "Scrivania"}
                                </Tag>
                              </TableCell>
                            );
                          }
                          if (cell.info.header === "actions") {
                            return (
                              <TableCell key={cell.id}>
                                <Button
                                  size="sm"
                                  kind="danger--tertiary"
                                  onClick={() => original && setCancelTarget(original)}
                                >
                                  Cancella
                                </Button>
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{String(cell.value)}</TableCell>;
                        })}
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
            Stai per cancellare la prenotazione di{" "}
            <strong>{cancelTarget.spot.code}</strong> per il{" "}
            <strong>{formatDate(cancelTarget.date)}</strong>. L&apos;operazione è
            immediata.
          </p>
        )}
      </Modal>
    </main>
  );
}

function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // YYYY-MM-DD in UTC (i Reservation hanno granularità @db.Date salvati a 00:00 UTC)
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
