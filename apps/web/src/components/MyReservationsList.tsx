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
  InlineLoading,
  InlineNotification,
  Modal,
} from "@carbon/react";
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

export function MyReservationsList() {
  const [items, setItems] = useState<MyReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MyReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

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

  const rows = items.map((r) => ({
    id: r.id,
    date: formatDate(r.date),
    type: r.spot.type,
    code: r.spot.code,
    site: r.spot.floor.site.name,
    floor: r.spot.floor.name,
    zone: r.spot.zone?.name ?? "—",
  }));

  return (
    <main>
      <h1 style={{ marginBottom: "0.25rem" }}>Le mie prenotazioni</h1>
      <p style={{ marginBottom: "2rem", color: "#525252" }}>
        Prenotazioni attive — puoi cancellarle in qualsiasi momento.
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

      {loading ? (
        <InlineLoading description="Carico le prenotazioni…" />
      ) : rows.length === 0 ? (
        <p style={{ color: "#525252" }}>Non hai prenotazioni attive.</p>
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
