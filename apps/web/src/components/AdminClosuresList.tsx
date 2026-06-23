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
  TableToolbar,
  TableToolbarContent,
  Button,
  IconButton,
  InlineLoading,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  TextArea,
  Tag,
  DatePicker,
  DatePickerInput,
} from "@carbon/react";
import {
  Add,
  TrashCan,
  Renew,
  ArrowsVertical,
  ArrowUp,
  ArrowDown,
} from "@carbon/icons-react";
import { Italian } from "flatpickr/dist/l10n/it.js";
import type { CustomLocale } from "flatpickr/dist/types/locale";
import type { Site, SpotType, Closure } from "@reservation/shared";
import { api, ApiError } from "@/lib/api";
import { FiltersPanel } from "./FiltersPanel";
import { SpotsCalendar } from "./SpotsCalendar";

const HEADERS = [
  { key: "date", header: "Data" },
  { key: "site", header: "Sede" },
  { key: "spotType", header: "Tipo" },
  { key: "reason", header: "Motivo" },
  { key: "createdBy", header: "Creato da" },
  { key: "createdAt", header: "Creato il" },
];

const SORTABLE_KEYS = new Set([
  "date",
  "site",
  "spotType",
  "reason",
  "createdBy",
  "createdAt",
]);

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

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

const DT_FMT = new Intl.DateTimeFormat("it-IT", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
function formatDateTime(iso: string): string {
  return DT_FMT.format(new Date(iso));
}


export function AdminClosuresList() {
  const [closures, setClosures] = useState<Closure[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Filtri server-side: Da/A + Sede passati a listAdminClosures.
  const [siteFilter, setSiteFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  // Filtro client-side: il backend non supporta `spotType` come query param
  // (le closure globali si applicano a entrambi i tipi); filtriamo lato
  // client per coerenza UX con altre pagine admin.
  const [typeFilter, setTypeFilter] = useState<SpotType | "">("");
  const [sort, setSort] = useState<SortState>(null);

  // Multi-select per bulk delete.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Closure | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [datePickerLocale, setDatePickerLocale] = useState<CustomLocale | undefined>(
    undefined,
  );
  useEffect(() => {
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.startsWith("it")) setDatePickerLocale(Italian);
  }, []);

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch((e: ApiError) => setError(`Caricamento sedi: ${e.message}`));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    api
      .listAdminClosures({
        from: dateFrom || undefined,
        to: dateTo || undefined,
        siteId: siteFilter || undefined,
      })
      .then((res) => {
        if (cancelled) return;
        setClosures(res);
        // Pulisci la selezione quando cambia il dataset (id potrebbero non
        // essere più nella tabella visibile).
        setSelectedIds(new Set());
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setError(`Caricamento chiusure: ${e.message}`);
        setClosures([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick, dateFrom, dateTo, siteFilter]);

  // Filtraggio client per tipo (il backend non lo supporta come query):
  // typeFilter="" = tutti; "PARKING" = solo PARKING + globali (spotType=null
  // include sia parking che desk, rimangono visibili); idem "DESK".
  const filteredClosures = useMemo(
    () =>
      typeFilter
        ? closures.filter((c) => c.spotType === null || c.spotType === typeFilter)
        : closures,
    [closures, typeFilter],
  );

  const rows = useMemo(
    () =>
      filteredClosures.map((c) => ({
        id: c.id,
        date: formatDate(c.date),
        site: c.site?.name ?? "Tutte",
        spotType:
          c.spotType === "PARKING"
            ? "Posti auto"
            : c.spotType === "DESK"
              ? "Scrivanie"
              : "Entrambi",
        reason: c.reason,
        createdBy: c.createdBy.displayName,
        createdAt: formatDateTime(c.createdAt),
      })),
    [filteredClosures],
  );

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

  const filtersActive =
    siteFilter !== "" || typeFilter !== "" || dateFrom !== null || dateTo !== null;
  const filtersActiveCount =
    (siteFilter ? 1 : 0) +
    (typeFilter ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);
  const filtersSummary = (() => {
    const parts: string[] = [];
    parts.push(`Sede: ${sites.find((s) => s.id === siteFilter)?.name ?? "Tutte"}`);
    parts.push(
      `Tipo: ${
        typeFilter === "PARKING"
          ? "Posti auto"
          : typeFilter === "DESK"
            ? "Scrivanie"
            : "Tutti"
      }`,
    );
    if (dateFrom) parts.push(`Da: ${dateFrom}`);
    if (dateTo) parts.push(`A: ${dateTo}`);
    return parts.join(" · ");
  })();
  function resetFilters() {
    setSiteFilter("");
    setTypeFilter("");
    setDateFrom(null);
    setDateTo(null);
  }

  // Helper selezione: tutte/nessuna su righe correnti.
  const allSelected =
    sortedRows.length > 0 && sortedRows.every((r) => selectedIds.has(r.id));
  const someSelected = sortedRows.some((r) => selectedIds.has(r.id));
  function toggleAll() {
    if (allSelected) {
      // Rimuovi solo gli id delle righe correnti dalla selezione (non tocca
      // eventuali id selezionati ma ora fuori dal filtro — caso edge raro).
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of sortedRows) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of sortedRows) next.add(r.id);
        return next;
      });
    }
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await api.adminBulkDeleteClosures(ids);
      setSuccessMsg(
        `${res.deleted} chiusur${res.deleted === 1 ? "a rimossa" : "e rimosse"}.`,
      );
      setBulkDeleteOpen(false);
      setSelectedIds(new Set());
      setReloadTick((t) => t + 1);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Rimozione multipla fallita: ${msg}`);
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.adminDeleteClosure(deleteTarget.id);
      setSuccessMsg(
        `Chiusura del ${formatDate(deleteTarget.date)} rimossa.`,
      );
      setDeleteTarget(null);
      setReloadTick((t) => t + 1);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Rimozione chiusura fallita: ${msg}`);
    } finally {
      setDeleting(false);
    }
  }

  function handleAddSuccess(count: number) {
    setSuccessMsg(`${count} chiusur${count === 1 ? "a creata" : "e create"} con successo.`);
    setAddOpen(false);
    setReloadTick((t) => t + 1);
  }

  return (
    <main>
      <div className="rsv-page-header-row">
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Amministrazione — Chiusure</h1>
          <p style={{ marginBottom: 0, color: "#525252" }}>
            Giorni in cui le prenotazioni sono disabilitate (festività, manutenzioni, chiusure di sede).
          </p>
        </div>
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

      <FiltersPanel summary={filtersSummary} activeCount={filtersActiveCount}>
        <div className="rsv-filters-stack">
          <div className="rsv-filter-row">
            <Select
              id="closures-site"
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
              id="closures-type"
              labelText="Tipo"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as SpotType | "")}
            >
              <SelectItem value="" text="Tutti" />
              <SelectItem value="PARKING" text="Posti auto" />
              <SelectItem value="DESK" text="Scrivanie" />
            </Select>
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
                id="closures-from"
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
                id="closures-to"
                labelText="A"
                placeholder="YYYY-MM-DD"
              />
            </DatePicker>
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
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Add}
            onClick={() => setAddOpen(true)}
          >
            Aggiungi chiusura
          </Button>
          {/* Bulk delete: visibile solo quando c'è almeno una riga selezionata.
              `kind="danger--tertiary"` mantiene il warning visivo (rosso bordo)
              senza essere troppo invasivo nel layout normale. */}
          {selectedIds.size > 0 && (
            <Button
              kind="danger--tertiary"
              size="sm"
              renderIcon={TrashCan}
              onClick={() => setBulkDeleteOpen(true)}
            >
              {`Rimuovi selezionate (${selectedIds.size})`}
            </Button>
          )}
        </div>
        <IconButton
          kind="ghost"
          size="sm"
          label="Aggiorna"
          align="bottom-right"
          onClick={() => setReloadTick((t) => t + 1)}
          disabled={loading}
        >
          <Renew />
        </IconButton>
      </div>

      {loading ? (
        <InlineLoading description="Carico le chiusure…" />
      ) : sortedRows.length === 0 ? (
        <p style={{ color: "#525252" }}>
          {filtersActive
            ? "Nessuna chiusura corrisponde ai filtri applicati."
            : "Nessuna chiusura attiva."}
        </p>
      ) : (
        <DataTable rows={sortedRows} headers={HEADERS}>
          {({ rows: rs, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <TableContainer>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {/* Checkbox "seleziona tutto" — agisce sulle righe
                        attualmente visibili (post-filtri+sort), non sull'intero
                        dataset. */}
                    <TableSelectAll
                      id="closures-select-all"
                      name="closures-select-all"
                      ariaLabel="Seleziona tutto"
                      checked={allSelected}
                      indeterminate={!allSelected && someSelected}
                      onSelect={toggleAll}
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
                    <TableHeader aria-label="Azioni" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rs.map((row) => {
                    const { key: rowKey, ...rowProps } = getRowProps({ row });
                    const original = closures.find((c) => c.id === row.id);
                    const checked = selectedIds.has(row.id);
                    return (
                      <TableRow key={rowKey} {...rowProps}>
                        <TableSelectRow
                          id={`closures-select-${row.id}`}
                          name={`closures-select-${row.id}`}
                          ariaLabel={`Seleziona chiusura ${row.id}`}
                          checked={checked}
                          onSelect={() => toggleOne(row.id)}
                        />
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{String(cell.value)}</TableCell>
                        ))}
                        <TableCell>
                          <IconButton
                            kind="ghost"
                            size="sm"
                            label="Rimuovi chiusura"
                            align="left"
                            onClick={() => original && setDeleteTarget(original)}
                          >
                            <TrashCan />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}

      {/* Modal conferma bulk delete. Pattern simmetrico al delete singolo,
          messaggio plurale + numero. */}
      <Modal
        open={bulkDeleteOpen}
        danger
        modalHeading={`Rimuovere ${selectedIds.size} chiusur${selectedIds.size === 1 ? "a" : "e"}?`}
        primaryButtonText={deleting ? "Rimozione…" : "Rimuovi"}
        secondaryButtonText="Annulla"
        primaryButtonDisabled={deleting}
        onRequestClose={() => {
          if (!deleting) setBulkDeleteOpen(false);
        }}
        onRequestSubmit={confirmBulkDelete}
      >
        <p>
          Stai per rimuovere <strong>{selectedIds.size}</strong>{" "}
          chiusur{selectedIds.size === 1 ? "a" : "e"}. L&apos;operazione è
          immediata e non reversibile.
        </p>
        <p>
          Le prenotazioni esistenti per i giorni rimossi NON vengono toccate;
          gli utenti potranno nuovamente prenotare per quei giorni.
        </p>
      </Modal>

      {/* Modal Aggiungi chiusura — bulk-friendly: l'admin può selezionare 1 o
          più date in una sola operazione (utile per coppie come Pasqua+Pasquetta
          o range manutenzione). DatePicker `multiple` di flatpickr lo
          supporta nativamente. */}
      <AddClosureDialog
        open={addOpen}
        sites={sites}
        onClose={() => setAddOpen(false)}
        onSuccess={handleAddSuccess}
      />

      <Modal
        open={deleteTarget !== null}
        danger
        modalHeading="Rimuovere la chiusura?"
        primaryButtonText={deleting ? "Rimozione…" : "Rimuovi"}
        secondaryButtonText="Annulla"
        primaryButtonDisabled={deleting}
        onRequestClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onRequestSubmit={confirmDelete}
      >
        {deleteTarget && (
          <>
            <p>
              Stai per rimuovere la chiusura del{" "}
              <strong>{formatDate(deleteTarget.date)}</strong>.
            </p>
            <ul style={{ margin: "0.75rem 0", paddingLeft: "1.25rem" }}>
              <li>
                Sede: <strong>{deleteTarget.site?.name ?? "Tutte"}</strong>
              </li>
              <li>
                Tipo:{" "}
                <strong>
                  {deleteTarget.spotType === "PARKING"
                    ? "Posti auto"
                    : deleteTarget.spotType === "DESK"
                      ? "Scrivanie"
                      : "Entrambi"}
                </strong>
              </li>
              <li>
                Motivo: <strong>{deleteTarget.reason}</strong>
              </li>
            </ul>
            <p>
              Le prenotazioni esistenti per questo giorno NON vengono eliminate
              automaticamente. Dopo la rimozione, gli utenti potranno
              nuovamente prenotare.
            </p>
          </>
        )}
      </Modal>
    </main>
  );
}

interface AddClosureDialogProps {
  open: boolean;
  sites: Site[];
  onClose: () => void;
  onSuccess: (count: number) => void;
}

function AddClosureDialog({ open, sites, onClose, onSuccess }: AddClosureDialogProps) {
  // Set delle date selezionate (toggle on click cella calendar). Salvate
  // come ISO YYYY-MM-DD per coerenza con shape backend.
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [siteId, setSiteId] = useState<string>("");
  const [spotType, setSpotType] = useState<SpotType | "">("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state quando il dialog viene riaperto.
  useEffect(() => {
    if (open) {
      setDates(new Set());
      setSiteId("");
      setSpotType("");
      setReason("");
      setError(null);
    }
  }, [open]);

  // Toggle multi-date: click cella → aggiunta/rimozione dal Set. Niente
  // DatePicker Carbon (non supporta `multiple`); riusiamo SpotsCalendar
  // sotto per il visual + interaction.
  function toggleDate(iso: string) {
    setDates((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }
  function removeDate(d: string) {
    setDates((prev) => {
      const next = new Set(prev);
      next.delete(d);
      return next;
    });
  }
  const sortedDates = useMemo(() => Array.from(dates).sort(), [dates]);

  const canSubmit = sortedDates.length > 0 && reason.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.adminCreateClosures({
        dates: sortedDates,
        siteId: siteId || undefined,
        spotType: spotType || undefined,
        reason: reason.trim(),
      });
      onSuccess(created.length);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Creazione fallita: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      // Full-screen: il dialog contiene un calendar inline (selezione multi-data)
      // + filtri, serve spazio. Stessa classe del BulkBookingsDialog
      // (vedi globals.scss `.rsv-modal-fullscreen`: 100dvh + footer pinnato).
      className="rsv-modal-fullscreen"
      modalHeading="Aggiungi chiusura"
      primaryButtonText={submitting ? "Salvataggio…" : "Crea chiusura"}
      secondaryButtonText="Annulla"
      primaryButtonDisabled={!canSubmit || submitting}
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
      onRequestSubmit={handleSubmit}
    >
      {error && (
        <InlineNotification
          kind="error"
          title="Errore"
          subtitle={error}
          onCloseButtonClick={() => setError(null)}
          lowContrast
          style={{ marginBottom: "1rem", maxWidth: "none" }}
        />
      )}

      <p style={{ marginBottom: "1rem", color: "#525252" }}>
        Clicca sulle date da bloccare nel calendario (toggle: secondo
        click rimuove). Sede e tipo opzionali — senza si bloccano tutte le
        sedi e tutti i tipi.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Calendar inline multi-select: riusiamo `SpotsCalendar` con:
            - showAvailability=false → niente fetch backend, niente pallini
            - unboundedNavigation → admin libero di navigare nel passato/futuro
            - myReservedDates = Set delle date scelte → bordo blu sulla cella
              ("--mine") che fa visivamente da "selezionata"
            - onDayClick toggle nel Set
            Il `type` è placeholder perché senza fetch availability non viene
            usato; passiamo PARKING come default. */}
        <SpotsCalendar
          type="PARKING"
          siteId=""
          floorId=""
          myReservedDates={dates}
          onDayClick={toggleDate}
          showAvailability={false}
          unboundedNavigation
        />

        {sortedDates.length > 0 && (
          <div>
            <div className="cds--label" style={{ marginBottom: "0.5rem" }}>
              Date selezionate ({sortedDates.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {sortedDates.map((d) => (
                <Tag
                  key={d}
                  type="warm-gray"
                  filter
                  onClose={() => removeDate(d)}
                  title="Rimuovi data"
                >
                  {d}
                </Tag>
              ))}
            </div>
          </div>
        )}

        <Select
          id="closure-site"
          labelText="Sede (vuoto = tutte)"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          <SelectItem value="" text="Tutte le sedi" />
          {sites.map((s) => (
            <SelectItem key={s.id} value={s.id} text={s.name} />
          ))}
        </Select>

        <Select
          id="closure-type"
          labelText="Tipo (vuoto = entrambi)"
          value={spotType}
          onChange={(e) => setSpotType(e.target.value as SpotType | "")}
        >
          <SelectItem value="" text="Entrambi" />
          <SelectItem value="PARKING" text="Solo posti auto" />
          <SelectItem value="DESK" text="Solo scrivanie" />
        </Select>

        <TextArea
          id="closure-reason"
          labelText="Motivo"
          placeholder="Es. Festività nazionale, Manutenzione climatizzazione..."
          rows={3}
          maxCount={500}
          enableCounter
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}
