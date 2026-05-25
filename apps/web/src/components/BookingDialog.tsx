"use client";

import { useEffect, useState } from "react";
import { Modal, InlineNotification } from "@carbon/react";
import type { SpotType } from "@reservation/shared";
import { api, ApiError } from "@/lib/api";

export interface BookingTarget {
  spotId: string;
  spotCode: string;
  date: string;
  type: SpotType;
}

interface Props {
  target: BookingTarget | null;
  onClose: () => void;
  onSuccess: () => void;
  // Chiamata quando il backend risponde 409 (spot già preso o quota giornaliera).
  // Il parent può ricaricare la lista per mostrare subito lo stato reale.
  onConflict?: () => void;
}

export function BookingDialog({ target, onClose, onSuccess, onConflict }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset stato quando si apre/chiude il dialog su un nuovo target.
  useEffect(() => {
    setError(null);
    setSubmitting(false);
  }, [target?.spotId, target?.date]);

  const open = target !== null;

  async function handleConfirm() {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createReservation({ spotId: target.spotId, date: target.date });
      onSuccess();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(humanizeError(e));
        if (e.status === 409) onConflict?.();
      } else {
        setError("Errore imprevisto. Riprova.");
      }
      setSubmitting(false);
    }
  }

  const label = target?.type === "PARKING" ? "posto auto" : "scrivania";

  return (
    <Modal
      open={open}
      modalHeading="Confermi la prenotazione?"
      primaryButtonText={submitting ? "Prenotazione…" : "Prenota"}
      secondaryButtonText="Annulla"
      primaryButtonDisabled={submitting}
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
      onRequestSubmit={handleConfirm}
    >
      {target && (
        <>
          <p style={{ marginBottom: "1rem" }}>
            Stai per prenotare <strong>{label}</strong>{" "}
            <strong>{target.spotCode}</strong> per il giorno{" "}
            <strong>{target.date}</strong>.
          </p>
          {error && (
            <InlineNotification
              kind="error"
              title="Prenotazione non riuscita"
              subtitle={error}
              hideCloseButton
              lowContrast
            />
          )}
        </>
      )}
    </Modal>
  );
}

function humanizeError(e: ApiError): string {
  if (e.status === 409) {
    // Il backend già restituisce messaggi italiani specifici (1/giorno, spot occupato).
    const msg = tryParseMessage(e.message);
    return msg ?? "Hai già una prenotazione per questa data, oppure il posto è appena stato preso.";
  }
  if (e.status === 400) return tryParseMessage(e.message) ?? "Dati non validi.";
  if (e.status === 401) return "Sessione scaduta. Ricarica la pagina e accedi di nuovo.";
  if (e.status === 404) return "Posto non trovato.";
  return `Errore (${e.status}). Riprova.`;
}

function tryParseMessage(raw: string): string | null {
  try {
    const j = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(j.message)) return j.message.join("; ");
    if (typeof j.message === "string") return j.message;
  } catch {
    // non-JSON, fall through
  }
  return raw || null;
}
