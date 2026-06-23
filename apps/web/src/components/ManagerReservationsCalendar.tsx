"use client";

import { useEffect, useMemo, useState } from "react";
import { IconButton } from "@carbon/react";
import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import type { AdminReservation } from "@/lib/api";

// Calendar manager: una griglia mensile dove ogni cella mostra il numero del
// giorno e (se ≥ 1 prenotazione coi filtri attuali) un badge col count.
//
// Differenze chiave rispetto a `SpotsCalendar` usato in /parking-/desks-
// /my-reservations:
//  - Niente bound `MAX_DAYS_AHEAD`: il manager naviga liberamente passato/futuro.
//  - Niente fetch interno: aggrega gli `items` ricevuti dal parent (che a sua
//    volta li ottiene da `listAdminReservations`).
//  - Click su qualsiasi cella → `onDayClick(iso)`. Anche su giorni con count=0:
//    permette di aprire la lista (vuota) di un giorno specifico.

const WEEKDAYS_IT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", {
  month: "long",
  year: "numeric",
});

interface Props {
  items: AdminReservation[];
  // Numero totale di spot del filtro corrente (tipo + sede + piano + zona).
  // Quando count del giorno >= totalCapacity, il giorno è "esaurito" e la
  // cella si colora in rosso. `null` = non noto (es. fetch fallita) →
  // niente evidenza esaurimento, solo il colore default per --has-items.
  totalCapacity: number | null;
  onDayClick: (iso: string) => void;
  // Notifica al parent il mese attualmente visualizzato (Date al primo del
  // mese, UTC). Chiamato al mount E ad ogni navigazione prev/next. Il parent
  // lo usa per filtrare la fetch a "questo mese" (Da/A automatici).
  onMonthChange?: (firstOfMonthUtc: Date) => void;
  // Mese iniziale. Letto solo al mount: serve a "ricordare" il mese tra
  // smontaggio/rimontaggio quando il manager passa list→calendar→list. Default =
  // mese corrente. Tipicamente il padre passa il mese di `dateFrom` corrente.
  initialMonth?: Date;
  // Map iso → reason delle Closure attive nel mese. Quando una cella matcha,
  // applichiamo la classe `--closed` (sfondo grigio + pattern strisce). A
  // differenza del calendar utente in /parking|/desks, lato manager il click
  // resta abilitato anche su giorni bloccati: il manager potrebbe aver
  // necessità di vedere/cancellare prenotazioni esistenti in giorni che
  // sono stati bloccati DOPO la creazione.
  closuresByDate?: Map<string, string>;
}

function isoFromUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function weekdayIndexLunDom(d: Date): number {
  const u = d.getUTCDay();
  return u === 0 ? 6 : u - 1;
}

export function ManagerReservationsCalendar({
  items,
  totalCapacity,
  onDayClick,
  onMonthChange,
  initialMonth,
  closuresByDate,
}: Props) {
  const [currentMonth, setCurrentMonth] = useState(() =>
    initialMonth ? startOfMonthUtc(initialMonth) : startOfMonthUtc(todayUtc()),
  );

  // Propaga al parent il mese visualizzato (al mount + ad ogni cambio).
  // Effect separato per non legare la callback al render iniziale del
  // calendar — se il parent rifà render, currentMonth resta lo stesso e
  // l'effect non rispara.
  useEffect(() => {
    onMonthChange?.(currentMonth);
  }, [currentMonth, onMonthChange]);

  // Aggregazione count per giorno: si ricalcola solo al cambio di items.
  // `r.date` arriva come ISO datetime (es. "2026-06-12T00:00:00.000Z");
  // i primi 10 char sono YYYY-MM-DD.
  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of items) {
      const iso = String(r.date).slice(0, 10);
      m.set(iso, (m.get(iso) ?? 0) + 1);
    }
    return m;
  }, [items]);

  const monthEnd = useMemo(() => endOfMonthUtc(currentMonth), [currentMonth]);

  // Pad iniziale (gg precedenti al 1°) + giorni del mese + pad finale fino a
  // multiplo di 7. Stesso pattern di SpotsCalendar.
  const cells = useMemo(() => {
    const pad = weekdayIndexLunDom(currentMonth);
    const daysInMonth = monthEnd.getUTCDate();
    const totalCells = Math.ceil((pad + daysInMonth) / 7) * 7;
    const out: { iso: string | null; day: number | null }[] = [];
    for (let i = 0; i < totalCells; i++) {
      const dayOfMonth = i - pad + 1;
      if (dayOfMonth < 1 || dayOfMonth > daysInMonth) {
        out.push({ iso: null, day: null });
      } else {
        const d = new Date(
          Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), dayOfMonth),
        );
        out.push({ iso: isoFromUtc(d), day: dayOfMonth });
      }
    }
    return out;
  }, [currentMonth, monthEnd]);

  const monthLabel = MONTH_LABEL.format(currentMonth);
  const monthLabelCap = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  // ISO del giorno corrente, calcolato una sola volta al mount per il
  // confronto cella-per-cella in render. Inutile useMemo con dep `today`:
  // un calendar admin che resta aperto a cavallo della mezzanotte è caso
  // estremo, accettiamo che la classe --today sia stale fino al prossimo
  // mount/refresh.
  const todayIsoString = isoFromUtc(todayUtc());

  function gotoPrev() {
    setCurrentMonth(
      (m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)),
    );
  }
  function gotoNext() {
    setCurrentMonth(
      (m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)),
    );
  }

  return (
    <div className="rsv-admin-calendar">
      <div className="rsv-calendar-header">
        <IconButton
          kind="ghost"
          size="sm"
          label="Mese precedente"
          align="bottom-left"
          onClick={gotoPrev}
        >
          <ChevronLeft />
        </IconButton>
        <span className="rsv-calendar-month-label">{monthLabelCap}</span>
        <IconButton
          kind="ghost"
          size="sm"
          label="Mese successivo"
          align="bottom-right"
          onClick={gotoNext}
        >
          <ChevronRight />
        </IconButton>
      </div>

      <div className="rsv-calendar-weekdays">
        {WEEKDAYS_IT.map((d) => (
          <div key={d} className="rsv-calendar-weekday">
            {d}
          </div>
        ))}
      </div>

      <div className="rsv-calendar-grid">
        {cells.map((c, i) => {
          if (c.iso === null) {
            return (
              <div
                key={`pad-${i}`}
                className="rsv-calendar-day rsv-calendar-day--pad"
              />
            );
          }
          const count = countByDate.get(c.iso) ?? 0;
          // "Esaurito" = ho almeno una prenotazione e ho coperto tutta la
          // capacity del filtro. Solo se totalCapacity è noto (>0) — se la
          // fetch capacity è fallita, niente --full.
          const isFull =
            totalCapacity != null && totalCapacity > 0 && count >= totalCapacity;
          const closureReason = closuresByDate?.get(c.iso) ?? null;
          const isClosed = closureReason !== null;
          const isToday = c.iso === todayIsoString;
          // Per le classi: se c'è una closure attiva, l'aspetto è "bloccato"
          // (grigio + strisce, classe condivisa con SpotsCalendar utente).
          // `--full` e `--has-items` perdono visibilità quando isClosed —
          // il manager ha già il count nel badge e il colore "bloccato" è il
          // segnale principale.
          const classes = [
            "rsv-calendar-day",
            "rsv-admin-calendar-day",
            isClosed && "rsv-calendar-day--closed",
            !isClosed && count > 0 && !isFull && "rsv-admin-calendar-day--has-items",
            !isClosed && isFull && "rsv-admin-calendar-day--full",
            isToday && "rsv-calendar-day--today",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={c.iso}
              type="button"
              className={classes}
              // NOTA: a differenza del calendar utente, qui il click resta
              // SEMPRE abilitato anche su giorni bloccati. Il manager potrebbe
              // dover gestire prenotazioni preesistenti su giorni bloccati
              // dopo la creazione (cancellazione, transfer).
              onClick={() => onDayClick(c.iso!)}
              aria-label={
                isClosed
                  ? `${c.day} ${monthLabelCap}, giorno bloccato: ${closureReason}${count > 0 ? `, ${count} prenotazion${count === 1 ? "e esistente" : "i esistenti"}` : ""}`
                  : isFull
                    ? `${c.day} ${monthLabelCap}, ${count} prenotazioni — esaurito`
                    : count > 0
                      ? `${c.day} ${monthLabelCap}, ${count} prenotazion${count === 1 ? "e" : "i"}`
                      : `${c.day} ${monthLabelCap}, nessuna prenotazione`
              }
              title={
                isClosed
                  ? `Giorno bloccato: ${closureReason}${count > 0 ? ` — ${count} prenotazion${count === 1 ? "e esistente" : "i esistenti"}` : ""}`
                  : isFull
                    ? `${count} prenotazioni su ${totalCapacity} posti — esaurito`
                    : count > 0
                      ? `${count} prenotazion${count === 1 ? "e" : "i"}${
                          totalCapacity ? ` su ${totalCapacity}` : ""
                        } — clicca per vedere`
                    : "Nessuna prenotazione — clicca per filtrare la lista su questo giorno"
              }
            >
              <span className="rsv-calendar-day-number">{c.day}</span>
              {count > 0 && (
                <span className="rsv-admin-calendar-day-count">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
