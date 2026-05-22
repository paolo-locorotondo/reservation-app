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
  Tag,
  InlineLoading,
  InlineNotification,
  Button,
} from "@carbon/react";
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
  { key: "available", header: "Disponibilità" },
  { key: "actions", header: "" },
];

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
    zone: s.zoneId ?? "—",
    available: s.available,
  }));

  return (
    <main>
      <h1 style={{ marginBottom: "0.25rem" }}>{title}</h1>
      <p style={{ marginBottom: "2rem", color: "#525252" }}>{subtitle}</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "1rem",
          marginBottom: "2rem",
          maxWidth: "900px",
        }}
      >
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

      {loading ? (
        <InlineLoading description="Carico i posti…" />
      ) : rows.length === 0 ? (
        <p style={{ color: "#525252" }}>Nessun posto trovato per i filtri selezionati.</p>
      ) : (
        <DataTable rows={rows} headers={HEADERS}>
          {({ rows: rs, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <TableContainer>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {headers.map((h) => {
                      const { key, ...headerProps } = getHeaderProps({ header: h });
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
                    const available = row.cells.find((c) => c.info.header === "available")
                      ?.value as boolean;
                    const { key: rowKey, ...rowProps } = getRowProps({ row });
                    return (
                      <TableRow key={rowKey} {...rowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === "available") {
                            return (
                              <TableCell key={cell.id}>
                                <Tag type={available ? "green" : "red"}>
                                  {available ? "Disponibile" : "Occupato"}
                                </Tag>
                              </TableCell>
                            );
                          }
                          if (cell.info.header === "actions") {
                            return (
                              <TableCell key={cell.id}>
                                <Button
                                  size="sm"
                                  kind="primary"
                                  disabled={!available}
                                  onClick={() => {
                                    const code = row.cells.find((c) => c.info.header === "code")
                                      ?.value as string;
                                    setBookingTarget({
                                      spotId: row.id,
                                      spotCode: code,
                                      date,
                                      type,
                                    });
                                  }}
                                >
                                  Prenota
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
