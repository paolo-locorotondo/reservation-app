"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Select,
  SelectItem,
  DatePicker,
  DatePickerInput,
  Checkbox,
  RadioButtonGroup,
  RadioButton,
  FilterableMultiSelect,
  ComboBox,
  InlineNotification,
  InlineLoading,
  Tag,
  DataTable,
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
  TableCell,
  TableContainer,
  IconButton,
  Button,
} from "@carbon/react";
import { Close, Copy } from "@carbon/icons-react";
import { Italian } from "flatpickr/dist/l10n/it.js";
import type { CustomLocale } from "flatpickr/dist/types/locale";
import type {
  Site,
  Floor,
  SpotType,
  SpotWithAvailability,
} from "@reservation/shared";
import {
  api,
  ApiError,
  type AdminUserItem,
} from "@/lib/api";

// Dialog di caricamento massivo prenotazioni (admin). Wizard a 4 step:
//  1. Utenti
//  2. Range date + giorni della settimana
//  3. Mappatura spot (esplicita 1:1 oppure auto-assign dal pool)
//  4. Riepilogo + submit + report skipped
//
// Open/close gestito dal parent (AdminReservationsList) via prop `open`.

interface Props {
  open: boolean;
  users: AdminUserItem[];
  onClose: () => void;
  // Notifica il parent (per reload + eventuale messaggio). Passa created +
  // skipped count così il parent può comporre il banner "N inviate di cui Y
  // create e Z saltate".
  onSuccess: (createdCount: number, skippedCount: number) => void;
  // Pre-popolamento di Da/A dai filtri della vista Lista del tab da cui è
  // stato aperto il dialog (se valorizzati). Letti solo all'apertura.
  initialFrom?: string | null;
  initialTo?: string | null;
}

type Step = 1 | 2 | 3 | 4;
type MappingMode = "explicit" | "pool";

// Ordine UI per i checkbox giorni della settimana. Carbon DateGetDay() ritorna
// 0=Dom, 1=Lun, ..., 6=Sab. Default selezionati: lun-ven (1..5).
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Gio" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" },
];

function isoFromDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Conta i giorni nel range [from, to] che matchano almeno uno dei weekdays
// selezionati. Usato dalla preview "5 utenti × 23 giorni = 115 prenotazioni".
function countMatchingDays(
  fromIso: string,
  toIso: string,
  weekdays: Set<number>,
): number {
  const from = parseIso(fromIso);
  const to = parseIso(toIso);
  if (!from || !to || to.getTime() < from.getTime()) return 0;
  if (weekdays.size === 0) return 0;
  let count = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    if (weekdays.has(new Date(t).getUTCDay())) count++;
  }
  return count;
}

function parseIso(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function BulkBookingsDialog({
  open,
  users,
  onClose,
  onSuccess,
  initialFrom,
  initialTo,
}: Props) {
  const [step, setStep] = useState<Step>(1);

  // Step 1 — utenti
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Step 2 — range + giorni della settimana
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [weekdays, setWeekdays] = useState<Set<number>>(
    () => new Set([1, 2, 3, 4, 5]), // default lun-ven
  );

  // Step 3 — mappatura spot
  const [mappingMode, setMappingMode] = useState<MappingMode>("explicit");
  // explicit: user → spotId
  const [spotMapping, setSpotMapping] = useState<Record<string, string>>({});
  // pool: siteId + spotType
  const [poolSiteId, setPoolSiteId] = useState<string>("");
  const [poolSpotType, setPoolSpotType] = useState<SpotType>("PARKING");

  // Lookups per gli spot disponibili (caricati on-demand in step 3).
  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]); // per il filtro lista
  // Per ogni utente, il filtro Sede+Piano usato nel ComboBox di mappatura
  // explicit. Tenuto come Map perché ogni utente può avere il suo filtro.
  // spotsBySite cache: chiave = "siteId|floorId|type" → SpotWithAvailability[]
  const [spotCache, setSpotCache] = useState<
    Map<string, SpotWithAvailability[]>
  >(new Map());
  // Filtri di lookup correnti (condivisi, default ultimo usato dall'admin).
  // Per semplicità tutti gli utenti usano lo stesso sito+piano+tipo per
  // restringere il combo — l'admin tipicamente assegna posti della stessa
  // sede ai nuovi assunti.
  const [lookupSiteId, setLookupSiteId] = useState<string>("");
  const [lookupFloorId, setLookupFloorId] = useState<string>("");
  const [lookupType, setLookupType] = useState<SpotType>("PARKING");

  // Step 4 — submit + report
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<
    | {
        created: number;
        skipped: Array<{ userId: string; date: string; reason: string }>;
      }
    | null
  >(null);

  const [datePickerLocale, setDatePickerLocale] = useState<CustomLocale | undefined>(
    undefined,
  );
  useEffect(() => {
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.startsWith("it")) setDatePickerLocale(Italian);
  }, []);

  // Reset state quando il dialog viene riaperto.
  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedUserIds([]);
      // Pre-popola Da/A dai filtri del tab (se presenti all'apertura).
      setDateFrom(initialFrom ?? "");
      setDateTo(initialTo ?? "");
      setWeekdays(new Set([1, 2, 3, 4, 5]));
      setMappingMode("explicit");
      setSpotMapping({});
      setPoolSiteId("");
      setPoolSpotType("PARKING");
      setLookupSiteId("");
      setLookupFloorId("");
      setLookupType("PARKING");
      setSubmitting(false);
      setError(null);
      setReport(null);
    }
  }, [open]);

  // Carica sedi una volta sola (al primo open).
  useEffect(() => {
    if (!open) return;
    api
      .listSites()
      .then(setSites)
      .catch((e: ApiError) => setError(`Caricamento sedi: ${e.message}`));
  }, [open]);

  // Piani al cambio di lookupSiteId.
  useEffect(() => {
    if (!lookupSiteId) {
      setFloors([]);
      setLookupFloorId("");
      return;
    }
    setLookupFloorId("");
    api
      .listFloors(lookupSiteId)
      .then(setFloors)
      .catch((e: ApiError) => setError(`Caricamento piani: ${e.message}`));
  }, [lookupSiteId]);

  // Svuota i mapping utente→posto ad OGNI cambio dei filtri di lookup
  // (sede/piano/tipo). Scelta UX esplicita: cambiare filtro azzera le
  // selezioni invece di tenerle "fuori filtro" (evita lo stato confuso
  // "2 di 3 popolati" al ritorno alla sede originale). Skip sul primo render
  // a modal chiuso (mapping già vuoto, niente da fare).
  useEffect(() => {
    if (!open) return;
    setSpotMapping({});
  }, [lookupSiteId, lookupFloorId, lookupType, open]);

  // Pre-caricamento spots per il combo della mappatura explicit, una volta
  // al cambio di lookup (sede/piano/tipo). Cache per evitare ricaricamenti.
  const lookupCacheKey = `${lookupSiteId}|${lookupFloorId}|${lookupType}`;
  const lookupSpots = spotCache.get(lookupCacheKey) ?? [];
  useEffect(() => {
    if (!open || mappingMode !== "explicit") return;
    if (!lookupSiteId) return;
    if (spotCache.has(lookupCacheKey)) return;
    // Data placeholder per la query (lo spot.list richiede una data anche se
    // qui non ci interessa la disponibilità). Usiamo oggi: l'admin assegna
    // spot, non li prenota qui — la disponibilità reale è verificata dal
    // backend in fase di bulk-create.
    const todayIso = isoFromDate(new Date());
    api
      .listAdminSpots({
        type: lookupType,
        date: todayIso,
        siteId: lookupSiteId,
        floorId: lookupFloorId || undefined,
      })
      .then((res) => {
        setSpotCache((prev) => new Map(prev).set(lookupCacheKey, res.items));
      })
      .catch((e: ApiError) => setError(`Caricamento posti: ${e.message}`));
  }, [open, mappingMode, lookupCacheKey, lookupSiteId, lookupFloorId, lookupType, spotCache]);

  // Utenti selezionati (per il MultiSelect Carbon, controlled).
  const selectedUsers = useMemo(
    () => users.filter((u) => selectedUserIds.includes(u.id)),
    [users, selectedUserIds],
  );

  // Validità di ogni step (per abilitare/disabilitare il bottone "Avanti").
  const step1Valid = selectedUserIds.length > 0;
  const step2Valid = (() => {
    if (!dateFrom || !dateTo) return false;
    const from = parseIso(dateFrom);
    const to = parseIso(dateTo);
    if (!from || !to) return false;
    if (to.getTime() < from.getTime()) return false;
    if (weekdays.size === 0) return false;
    return true;
  })();
  const step3Valid = (() => {
    if (mappingMode === "explicit") {
      return selectedUserIds.every((uid) => spotMapping[uid]);
    }
    return poolSiteId !== "" && poolSpotType !== undefined;
  })();

  const matchingDaysCount = countMatchingDays(dateFrom, dateTo, weekdays);
  const totalCandidates = selectedUserIds.length * matchingDaysCount;

  function toggleWeekday(d: number) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.adminBulkCreateReservations({
        userIds: selectedUserIds,
        from: dateFrom,
        to: dateTo,
        weekdays: Array.from(weekdays),
        mode: mappingMode,
        spotMapping: mappingMode === "explicit" ? spotMapping : undefined,
        spotPool:
          mappingMode === "pool"
            ? { siteId: poolSiteId, spotType: poolSpotType }
            : undefined,
      });
      setReport(res);
      onSuccess(res.created, res.skipped.length);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Caricamento massivo fallito: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  // Header del wizard: titolo + step indicator testuale.
  const heading = report
    ? "Caricamento completato"
    : `Prenotazione massiva — Step ${step} di 4`;

  // Bottoni del Modal: cambiano per step. Step 4 → primary = "Crea N";
  // post-submit → primary = "Chiudi".
  const primaryButtonText = (() => {
    if (report) return "Chiudi";
    if (step < 4) return "Avanti";
    if (submitting) return "Creazione in corso…";
    return `Crea ${totalCandidates} prenotazion${totalCandidates === 1 ? "e" : "i"}`;
  })();
  const primaryButtonDisabled = (() => {
    if (report) return false;
    if (submitting) return true;
    if (step === 1) return !step1Valid;
    if (step === 2) return !step2Valid;
    if (step === 3) return !step3Valid;
    if (step === 4) return totalCandidates === 0;
    return false;
  })();
  function handlePrimary() {
    if (report) {
      onClose();
      return;
    }
    if (step < 4) {
      setStep((step + 1) as Step);
      return;
    }
    void handleSubmit();
  }

  return (
    <Modal
      open={open}
      size="lg"
      className="rsv-modal-fullscreen"
      modalHeading={heading}
      primaryButtonText={primaryButtonText}
      primaryButtonDisabled={primaryButtonDisabled}
      secondaryButtonText={step > 1 && !report ? "Indietro" : "Annulla"}
      onRequestClose={() => {
        if (submitting) return;
        // Confirm "modifiche non salvate" SOLO se l'utente ha già iniziato a
        // compilare (almeno step 2 con qualche field). Step 1 senza scelte
        // non vale la pena confermare.
        const hasProgress =
          selectedUserIds.length > 0 || dateFrom !== "" || dateTo !== "";
        if (!report && hasProgress) {
          if (!confirm("Hai modifiche non salvate. Chiudere comunque?")) return;
        }
        onClose();
      }}
      onSecondarySubmit={() => {
        if (submitting) return;
        if (report) return; // pulsante "Annulla" non visibile in report
        if (step > 1) {
          setStep((step - 1) as Step);
          return;
        }
        onClose();
      }}
      onRequestSubmit={handlePrimary}
    >
      {/* Lazy-mount del body: quando `open=false` Carbon Modal mantiene il
          container nel DOM (per le transizioni di chiusura) ma il children
          resta renderizzato — duplicate id detection del browser scatta
          quando un altro Modal apre uno dei suoi form field con id che il
          DOM ha già visto. Wrappando con `{open && ...}` smontiamo tutto al
          close. Stesso pattern di BookForUserDialog (che fa `{target && ...}`). */}
      {open && (
        <>
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

          {/* Report post-submit: prevale su tutto. Mostra count + skipped[]. */}
          {report ? (
            <ReportView report={report} users={users} />
          ) : (
            <>
          {step === 1 && (
            <Step1Users
              users={users}
              selectedUsers={selectedUsers}
              onChange={(ids) => setSelectedUserIds(ids)}
            />
          )}
          {step === 2 && (
            <Step2Dates
              dateFrom={dateFrom}
              dateTo={dateTo}
              weekdays={weekdays}
              datePickerLocale={datePickerLocale}
              onChangeFrom={setDateFrom}
              onChangeTo={setDateTo}
              onToggleWeekday={toggleWeekday}
            />
          )}
          {step === 3 && (
            <Step3Mapping
              mode={mappingMode}
              onChangeMode={setMappingMode}
              selectedUsers={selectedUsers}
              spotMapping={spotMapping}
              onChangeMapping={setSpotMapping}
              sites={sites}
              floors={floors}
              lookupSiteId={lookupSiteId}
              lookupFloorId={lookupFloorId}
              lookupType={lookupType}
              onChangeLookupSite={setLookupSiteId}
              onChangeLookupFloor={setLookupFloorId}
              onChangeLookupType={setLookupType}
              lookupSpots={lookupSpots}
              poolSiteId={poolSiteId}
              poolSpotType={poolSpotType}
              onChangePoolSite={setPoolSiteId}
              onChangePoolType={setPoolSpotType}
            />
          )}
          {step === 4 && (
            <Step4Review
              userCount={selectedUserIds.length}
              dateFrom={dateFrom}
              dateTo={dateTo}
              weekdays={weekdays}
              matchingDays={matchingDaysCount}
              totalCandidates={totalCandidates}
              mode={mappingMode}
              poolSite={sites.find((s) => s.id === poolSiteId)?.name ?? "—"}
              poolSpotType={poolSpotType}
              submitting={submitting}
            />
          )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

// ───────────────────────── Step 1 ─────────────────────────

interface Step1Props {
  users: AdminUserItem[];
  selectedUsers: AdminUserItem[];
  onChange: (ids: string[]) => void;
}
function Step1Users({ users, selectedUsers, onChange }: Step1Props) {
  return (
    <div>
      <p style={{ marginBottom: "1rem", color: "#525252" }}>
        Seleziona gli utenti per cui creare le prenotazioni.
      </p>
      <FilterableMultiSelect
        id="bulk-users"
        titleText="Utenti"
        placeholder="Cerca per nome o email…"
        items={users}
        itemToString={(u: AdminUserItem | null) =>
          u ? `${u.displayName} (${u.email})` : ""
        }
        selectedItems={selectedUsers}
        onChange={({
          selectedItems,
        }: {
          selectedItems: AdminUserItem[] | null;
        }) => onChange((selectedItems ?? []).map((u) => u.id))}
      />
      {selectedUsers.length > 0 && (
        <p style={{ marginTop: "0.5rem", color: "#525252" }}>
          {selectedUsers.length} utent{selectedUsers.length === 1 ? "e" : "i"} selezionat
          {selectedUsers.length === 1 ? "o" : "i"}.
        </p>
      )}
    </div>
  );
}

// ───────────────────────── Step 2 ─────────────────────────

interface Step2Props {
  dateFrom: string;
  dateTo: string;
  weekdays: Set<number>;
  datePickerLocale: CustomLocale | undefined;
  onChangeFrom: (iso: string) => void;
  onChangeTo: (iso: string) => void;
  onToggleWeekday: (d: number) => void;
}
function Step2Dates({
  dateFrom,
  dateTo,
  weekdays,
  datePickerLocale,
  onChangeFrom,
  onChangeTo,
  onToggleWeekday,
}: Step2Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <p style={{ marginBottom: "0.75rem", color: "#525252" }}>
          Imposta il range di date e per quali giorni della settimana
          prenotare.
        </p>
        {/* `auto-fit + minmax` invece di `1fr 1fr` fisso: su mobile (modal
            full-screen ma viewport stretta) le due celle Da/A vanno a capo
            invece di forzare scroll orizzontale. La classe è in globals.scss
            perché le media query non sono esprimibili inline. */}
        <div className="rsv-bulk-date-grid">
          {/* Carbon DatePicker non ha clear nativo: affianchiamo una piccola
              X (IconButton ghost) visibile solo quando il campo è valorizzato.
              `align-items: end` allinea la X alla baseline dell'input (sotto
              la label). */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "0.25rem" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                locale={datePickerLocale}
                value={dateFrom}
                onChange={(dates: Date[]) => {
                  onChangeFrom(dates[0] ? isoFromDate(dates[0]) : "");
                }}
              >
                <DatePickerInput
                  id="bulk-from"
                  labelText="Da"
                  placeholder="YYYY-MM-DD"
                />
              </DatePicker>
            </div>
            {dateFrom && (
              <IconButton
                kind="ghost"
                size="md"
                label="Pulisci data Da"
                align="bottom"
                onClick={() => onChangeFrom("")}
              >
                <Close />
              </IconButton>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "0.25rem" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                locale={datePickerLocale}
                value={dateTo}
                onChange={(dates: Date[]) => {
                  onChangeTo(dates[0] ? isoFromDate(dates[0]) : "");
                }}
              >
                <DatePickerInput
                  id="bulk-to"
                  labelText="A"
                  placeholder="YYYY-MM-DD"
                />
              </DatePicker>
            </div>
            {dateTo && (
              <IconButton
                kind="ghost"
                size="md"
                label="Pulisci data A"
                align="bottom"
                onClick={() => onChangeTo("")}
              >
                <Close />
              </IconButton>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="cds--label" style={{ marginBottom: "0.5rem" }}>
          Giorni della settimana
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          {WEEKDAYS.map((w) => (
            <Checkbox
              key={w.value}
              id={`bulk-wd-${w.value}`}
              labelText={w.label}
              checked={weekdays.has(w.value)}
              onChange={() => onToggleWeekday(w.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Step 3 ─────────────────────────

interface Step3Props {
  mode: MappingMode;
  onChangeMode: (m: MappingMode) => void;
  selectedUsers: AdminUserItem[];
  spotMapping: Record<string, string>;
  onChangeMapping: (m: Record<string, string>) => void;
  sites: Site[];
  floors: Floor[];
  lookupSiteId: string;
  lookupFloorId: string;
  lookupType: SpotType;
  onChangeLookupSite: (id: string) => void;
  onChangeLookupFloor: (id: string) => void;
  onChangeLookupType: (t: SpotType) => void;
  lookupSpots: SpotWithAvailability[];
  poolSiteId: string;
  poolSpotType: SpotType;
  onChangePoolSite: (id: string) => void;
  onChangePoolType: (t: SpotType) => void;
}
function Step3Mapping(props: Step3Props) {
  const {
    mode,
    onChangeMode,
    selectedUsers,
    spotMapping,
    onChangeMapping,
    sites,
    floors,
    lookupSiteId,
    lookupFloorId,
    lookupType,
    onChangeLookupSite,
    onChangeLookupFloor,
    onChangeLookupType,
    lookupSpots,
    poolSiteId,
    poolSpotType,
    onChangePoolSite,
    onChangePoolType,
  } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <p style={{ color: "#525252", marginBottom: 0 }}>
        Come assegnare i posti agli utenti?
      </p>
      <RadioButtonGroup
        legendText="Modalità di assegnazione"
        name="bulk-mapping-mode"
        valueSelected={mode}
        onChange={(v: string | number | undefined) => {
          if (v) onChangeMode(v as MappingMode);
        }}
        orientation="vertical"
      >
        <RadioButton
          id="bulk-mode-explicit"
          labelText="Mappatura esplicita 1:1 — scegli tu il posto per ogni utente"
          value="explicit"
        />
        <RadioButton
          id="bulk-mode-pool"
          labelText="Auto-assign — il sistema sceglie il primo libero per ogni utente/data"
          value="pool"
        />
      </RadioButtonGroup>

      {mode === "explicit" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ color: "#525252", fontSize: "0.875rem" }}>
            Imposta i filtri per i posti disponibili e scegline uno per ogni
            utente accanto ad esso.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "1rem",
            }}
          >
            <Select
              id="bulk-lookup-site"
              labelText="Sede"
              value={lookupSiteId}
              onChange={(e) => onChangeLookupSite(e.target.value)}
            >
              <SelectItem value="" text="Seleziona…" />
              {sites.map((s) => (
                <SelectItem key={s.id} value={s.id} text={s.name} />
              ))}
            </Select>
            <Select
              id="bulk-lookup-floor"
              labelText="Piano (opzionale)"
              value={lookupFloorId}
              onChange={(e) => onChangeLookupFloor(e.target.value)}
              disabled={!lookupSiteId}
            >
              <SelectItem value="" text="Tutti i piani" />
              {floors.map((f) => (
                <SelectItem key={f.id} value={f.id} text={f.name} />
              ))}
            </Select>
            <Select
              id="bulk-lookup-type"
              labelText="Tipo"
              value={lookupType}
              onChange={(e) => onChangeLookupType(e.target.value as SpotType)}
            >
              <SelectItem value="PARKING" text="Posti auto" />
              <SelectItem value="DESK" text="Scrivanie" />
            </Select>
          </div>

          {selectedUsers.length > 0 && (
            <div>
              <div className="cds--label" style={{ marginBottom: "0.5rem" }}>
                Mappatura utente → posto
              </div>
              {/* Niente `overflow:auto` qui: clipperebbe il dropdown del
                  ComboBox (renderizzato inline da Carbon) tagliando le option.
                  Il modal è full-screen con scroll proprio, quindi la lista
                  scrolla con esso senza bisogno di un contenitore interno. */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                {selectedUsers.map((u) => {
                  const currentSpot =
                    lookupSpots.find((s) => s.id === spotMapping[u.id]) ?? null;
                  return (
                    <div
                      key={u.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "0.75rem",
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={`${u.displayName} (${u.email})`}
                      >
                        {u.displayName}
                        <span style={{ color: "#525252", marginLeft: "0.5rem" }}>
                          {u.email}
                        </span>
                      </div>
                      <ComboBox
                        id={`bulk-spot-${u.id}`}
                        titleText=""
                        placeholder={
                          lookupSiteId ? "Scegli posto…" : "Scegli sede prima…"
                        }
                        items={lookupSpots}
                        itemToString={(s: SpotWithAvailability | null) =>
                          s ? `${s.code}${s.zoneName ? ` - ${s.zoneName}` : ""}` : ""
                        }
                        selectedItem={currentSpot}
                        disabled={!lookupSiteId}
                        onChange={({
                          selectedItem,
                        }: {
                          selectedItem: SpotWithAvailability | null | undefined;
                        }) => {
                          const next = { ...spotMapping };
                          if (selectedItem) next[u.id] = selectedItem.id;
                          else delete next[u.id];
                          onChangeMapping(next);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "pool" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ color: "#525252", fontSize: "0.875rem" }}>
            Il sistema assegna il primo posto libero per ogni (utente, data).
            Se i posti disponibili si esauriscono per una data, le combinazioni
            rimanenti finiscono nel report finale come saltate.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "1rem",
            }}
          >
            <Select
              id="bulk-pool-site"
              labelText="Sede"
              value={poolSiteId}
              onChange={(e) => onChangePoolSite(e.target.value)}
            >
              <SelectItem value="" text="Seleziona…" />
              {sites.map((s) => (
                <SelectItem key={s.id} value={s.id} text={s.name} />
              ))}
            </Select>
            <Select
              id="bulk-pool-type"
              labelText="Tipo"
              value={poolSpotType}
              onChange={(e) => onChangePoolType(e.target.value as SpotType)}
            >
              <SelectItem value="PARKING" text="Posti auto" />
              <SelectItem value="DESK" text="Scrivanie" />
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Step 4 ─────────────────────────

interface Step4Props {
  userCount: number;
  dateFrom: string;
  dateTo: string;
  weekdays: Set<number>;
  matchingDays: number;
  totalCandidates: number;
  mode: MappingMode;
  poolSite: string;
  poolSpotType: SpotType;
  submitting: boolean;
}
function Step4Review({
  userCount,
  dateFrom,
  dateTo,
  weekdays,
  matchingDays,
  totalCandidates,
  mode,
  poolSite,
  poolSpotType,
  submitting,
}: Step4Props) {
  const wdLabels = WEEKDAYS.filter((w) => weekdays.has(w.value))
    .map((w) => w.label)
    .join(", ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={{ color: "#525252" }}>
        Riepilogo prima della creazione. Le combinazioni saltate (chiusure
        festive, utente già prenotato, posto occupato) finiranno nel report
        post-creazione.
      </p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        <li>
          <strong>{userCount}</strong> utent
          {userCount === 1 ? "e" : "i"}
        </li>
        <li>
          Range: <strong>{dateFrom}</strong> → <strong>{dateTo}</strong>
        </li>
        <li>
          Giorni della settimana: <strong>{wdLabels || "—"}</strong>
        </li>
        <li>
          Giorni effettivi nel range: <strong>{matchingDays}</strong>
        </li>
        <li>
          Modalità:{" "}
          <strong>
            {mode === "explicit" ? "Mappatura esplicita 1:1" : "Auto-assign"}
          </strong>
        </li>
        {mode === "pool" && (
          <li>
            Posti:{" "}
            <strong>
              {poolSite} —{" "}
              {poolSpotType === "PARKING" ? "Posti auto" : "Scrivanie"}
            </strong>
          </li>
        )}
        <li
          style={{
            marginTop: "0.5rem",
            fontSize: "1.125rem",
            color: totalCandidates > 0 ? "#0f62fe" : "#525252",
          }}
        >
          {totalCandidates === 1 ? (
            <>
              <strong>1</strong> prenotazione verrà creata (se non saltata).
            </>
          ) : (
            <>
              <strong>{totalCandidates}</strong> prenotazioni verranno create
              (se nessuna è saltata).
            </>
          )}
        </li>
      </ul>
      {submitting && (
        <InlineLoading description="Creazione in corso, può richiedere alcuni secondi…" />
      )}
    </div>
  );
}

// ───────────────────────── Report ─────────────────────────

interface ReportProps {
  report: {
    created: number;
    skipped: Array<{ userId: string; date: string; reason: string }>;
  };
  users: AdminUserItem[];
}
function ReportView({ report, users }: ReportProps) {
  const [copied, setCopied] = useState(false);
  const userById = useMemo(() => {
    const m = new Map<string, AdminUserItem>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);
  const skippedRows = report.skipped.map((s, idx) => ({
    id: `${idx}`,
    user:
      userById.get(s.userId)?.displayName ??
      userById.get(s.userId)?.email ??
      s.userId,
    date: s.date,
    reason: s.reason,
  }));

  // Copia la lista saltate come TSV (incollabile in Excel/Sheets). Feedback
  // "Copiato" temporaneo di 2s. Fallback silenzioso se clipboard API non
  // disponibile (es. contesto non-secure) — l'admin può sempre screenshottare.
  function copySkipped() {
    const header = "Utente\tData\tMotivo";
    const body = skippedRows
      .map((r) => `${r.user}\t${r.date}\t${r.reason}`)
      .join("\n");
    const text = `${header}\n${body}`;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* no-op: clipboard non disponibile */
      });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <InlineNotification
        kind={report.created > 0 ? "success" : "warning"}
        title="Caricamento completato"
        subtitle={`${report.created + report.skipped.length} prenotazioni inviate di cui ${report.created} create con successo e ${report.skipped.length} saltate.`}
        hideCloseButton
        lowContrast
        style={{ maxWidth: "none" }}
      />
      {report.skipped.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}
          >
            <div className="cds--label" style={{ margin: 0 }}>
              Combinazioni saltate
            </div>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Copy}
              onClick={copySkipped}
            >
              {copied ? "Copiato!" : "Copia lista"}
            </Button>
          </div>
          <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
            <DataTable
              rows={skippedRows}
              headers={[
                { key: "user", header: "Utente" },
                { key: "date", header: "Data" },
                { key: "reason", header: "Motivo" },
              ]}
            >
              {({
                rows: rs,
                headers,
                getHeaderProps,
                getRowProps,
                getTableProps,
              }) => (
                <TableContainer>
                  <Table {...getTableProps()} size="sm">
                    <TableHead>
                      <TableRow>
                        {headers.map((h) => {
                          const { key, ...headerProps } = getHeaderProps({
                            header: h,
                          });
                          return (
                            <TableHeader key={key} {...headerProps}>
                              {h.header}
                            </TableHeader>
                          );
                        })}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rs.map((row) => {
                        const { key: rowKey, ...rowProps } = getRowProps({ row });
                        return (
                          <TableRow key={rowKey} {...rowProps}>
                            {row.cells.map((cell) => (
                              <TableCell key={cell.id}>
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
          </div>
          <p style={{ marginTop: "0.5rem", color: "#525252", fontSize: "0.875rem" }}>
            Chiudendo il dialog questa lista andrà persa: usa “Copia lista” se
            ti serve per consultazione successiva.
          </p>
        </div>
      )}
      {report.skipped.length === 0 && report.created > 0 && (
        <Tag type="green">Tutto creato senza errori.</Tag>
      )}
    </div>
  );
}
