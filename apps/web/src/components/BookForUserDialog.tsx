"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Select,
  SelectItem,
  ComboBox,
  DatePicker,
  DatePickerInput,
  InlineNotification,
} from "@carbon/react";
// `ComboBox` è il componente Carbon con typeahead per single-select: lo usiamo
// sia per Utente sia per Posto. Il dropdown è scrollabile e di altezza limitata
// di default, e l'input filtra la lista mentre digiti.
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

// Default `oggi` come ISO YYYY-MM-DD locale.
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

export interface BookForUserTarget {
  // Tipo posto preimpostato dal tab corrente; non modificabile nel dialog
  // (per cambiarlo l'admin esce e cambia tab — più chiaro).
  type: SpotType;
  // Data preimpostata se l'admin è arrivato da un click su una cella del
  // calendar. Modificabile via DatePicker.
  initialDate?: string;
}

interface Props {
  target: BookForUserTarget | null;
  // Lista utenti già caricata a livello pagina (passata per non rifare
  // fetch nel dialog ad ogni apertura).
  users: AdminUserItem[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BookForUserDialog({ target, users, onClose, onSuccess }: Props) {
  const open = target !== null;

  // Form state. Reset ad ogni apertura tramite useEffect su `target`.
  const [userId, setUserId] = useState<string>("");
  const [date, setDate] = useState<string>(todayIso());
  const [siteId, setSiteId] = useState<string>("");
  const [floorId, setFloorId] = useState<string>("");
  const [spotId, setSpotId] = useState<string>("");

  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [spots, setSpots] = useState<SpotWithAvailability[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [datePickerLocale, setDatePickerLocale] = useState<CustomLocale | undefined>(
    undefined,
  );

  // Reset campi e fetch sites quando il dialog si apre su un nuovo target.
  useEffect(() => {
    if (!target) return;
    setUserId("");
    setDate(target.initialDate ?? todayIso());
    setSiteId("");
    setFloorId("");
    setSpotId("");
    setError(null);
    setSubmitting(false);
    api
      .listSites()
      .then((s) => {
        setSites(s);
        if (s.length > 0) setSiteId(s[0].id);
      })
      .catch((e: ApiError) => setError(`Caricamento sedi: ${e.message}`));
    const lang = navigator.language?.toLowerCase() ?? "";
    if (lang.startsWith("it")) setDatePickerLocale(Italian);
  }, [target]);

  // Floors al cambio di sede.
  useEffect(() => {
    if (!siteId) {
      setFloors([]);
      setFloorId("");
      return;
    }
    setFloorId("");
    setSpotId("");
    api
      .listFloors(siteId)
      .then(setFloors)
      .catch((e: ApiError) => setError(`Caricamento piani: ${e.message}`));
  }, [siteId]);

  // Spots al cambio di sede/piano/data/tipo. Riusa `listSpots` con
  // `available` flag già calcolato dal backend per quella data.
  useEffect(() => {
    if (!target || !siteId || !date) {
      setSpots([]);
      return;
    }
    let cancelled = false;
    api
      .listAdminSpots({
        type: target.type,
        date,
        siteId,
        floorId: floorId || undefined,
      })
      .then((res) => {
        if (cancelled) return;
        setSpots(res.items);
        // Se lo spot selezionato non è più nella lista (cambio piano/sede),
        // resetta. Se è ancora valido ma non più available, lascia: il
        // backend rifiuterà al submit con messaggio chiaro.
        setSpotId((prev) => (prev && res.items.some((s) => s.id === prev) ? prev : ""));
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setError(`Caricamento posti: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [target, siteId, floorId, date]);

  const availableSpots = useMemo(() => spots.filter((s) => s.available), [spots]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === userId) ?? null,
    [users, userId],
  );

  const selectedSpot = useMemo(
    () => availableSpots.find((s) => s.id === spotId) ?? null,
    [availableSpots, spotId],
  );

  async function handleSubmit() {
    if (!target || !userId || !spotId || !date) {
      setError("Completa tutti i campi prima di prenotare.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.adminCreateReservation({ userId, spotId, date });
      onSuccess();
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Prenotazione fallita: ${msg}`);
      setSubmitting(false);
    }
  }

  const itemLabel = target?.type === "PARKING" ? "posto auto" : "scrivania";

  return (
    <Modal
      open={open}
      modalHeading={`Prenota ${itemLabel} per un utente`}
      primaryButtonText={submitting ? "Prenotazione…" : "Prenota"}
      secondaryButtonText="Annulla"
      primaryButtonDisabled={submitting || !userId || !spotId}
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
      onRequestSubmit={handleSubmit}
    >
      {target && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <ComboBox
            id="book-for-user-user"
            titleText="Utente"
            placeholder="Cerca utente per nome o email…"
            items={users}
            itemToString={(u: AdminUserItem | null) =>
              u ? `${u.displayName} (${u.email})` : ""
            }
            selectedItem={selectedUser}
            onChange={({
              selectedItem,
            }: {
              selectedItem: AdminUserItem | null | undefined;
            }) => setUserId(selectedItem?.id ?? "")}
          />

          <Select
            id="book-for-user-site"
            labelText="Sede"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
          >
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id} text={s.name} />
            ))}
          </Select>

          <Select
            id="book-for-user-floor"
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

          {/* Niente `minDate`: l'admin può prenotare anche per date passate
              (es. inserimento storico HR) o oltre `MAX_DAYS_AHEAD`. */}
          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            locale={datePickerLocale}
            value={date}
            onChange={(dates: Date[]) => {
              if (dates[0]) setDate(isoFromDate(dates[0]));
            }}
          >
            <DatePickerInput
              id="book-for-user-date"
              labelText="Data"
              placeholder="YYYY-MM-DD"
            />
          </DatePicker>

          <ComboBox
            id="book-for-user-spot"
            titleText={`Posto disponibile (${availableSpots.length} disponibili)`}
            placeholder="Cerca posto per codice o zona…"
            items={availableSpots}
            itemToString={(s: SpotWithAvailability | null) =>
              s ? `${s.code}${s.zoneName ? ` — ${s.zoneName}` : ""}` : ""
            }
            selectedItem={selectedSpot}
            onChange={({
              selectedItem,
            }: {
              selectedItem: SpotWithAvailability | null | undefined;
            }) => setSpotId(selectedItem?.id ?? "")}
            disabled={availableSpots.length === 0}
          />

          {availableSpots.length === 0 && spots.length > 0 && (
            <InlineNotification
              kind="warning"
              title="Nessun posto disponibile"
              subtitle="Tutti i posti che corrispondono ai filtri sono già prenotati per la data scelta."
              hideCloseButton
              lowContrast
            />
          )}

          {error && (
            <InlineNotification
              kind="error"
              title="Errore"
              subtitle={error}
              hideCloseButton
              lowContrast
            />
          )}
        </div>
      )}
    </Modal>
  );
}
