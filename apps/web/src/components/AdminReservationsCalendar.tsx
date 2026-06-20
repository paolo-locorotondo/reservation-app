"use client";

import { useMemo, useState } from "react";
import { IconButton } from "@carbon/react";
import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import type { AdminReservation } from "@/lib/api";

// Calendar admin: una griglia mensile dove ogni cella mostra il numero del
// giorno e (se ≥ 1 prenotazione coi filtri attuali) un badge col count.
//
// Differenze chiave rispetto a `SpotsCalendar` usato in /parking-/desks-
// /my-reservations:
//  - Niente bound `MAX_DAYS_AHEAD`: l'admin naviga liberamente passato/futuro.
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

export function AdminReservationsCalendar({
  items,
  totalCapacity,
  onDayClick,
}: Props) {
  const [currentMonth, setCurrentMonth] = useState(() =>
    startOfMonthUtc(todayUtc()),
  );

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
          const isToday = c.iso === todayIsoString;
          const classes = [
            "rsv-calendar-day",
            "rsv-admin-calendar-day",
            count > 0 && !isFull && "rsv-admin-calendar-day--has-items",
            isFull && "rsv-admin-calendar-day--full",
            isToday && "rsv-calendar-day--today",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={c.iso}
              type="button"
              className={classes}
              onClick={() => onDayClick(c.iso!)}
              aria-label={
                isFull
                  ? `${c.day} ${monthLabelCap}, ${count} prenotazioni — esaurito`
                  : count > 0
                    ? `${c.day} ${monthLabelCap}, ${count} prenotazion${count === 1 ? "e" : "i"}`
                    : `${c.day} ${monthLabelCap}, nessuna prenotazione`
              }
              title={
                isFull
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
