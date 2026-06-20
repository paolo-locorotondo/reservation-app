"use client";

import { useEffect, useMemo, useState } from "react";
import { IconButton, InlineLoading, InlineNotification } from "@carbon/react";
import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import type { SpotType } from "@reservation/shared";
import { api, ApiError } from "@/lib/api";

// Letto a build-time dalla env var del frontend (Next richiede prefisso
// NEXT_PUBLIC_ per le var esposte al client). Da tenere in pari con
// MAX_DAYS_AHEAD lato API (.env: stessa coppia di valori). Fallback 30.
const MAX_DAYS_AHEAD = process.env.NEXT_PUBLIC_MAX_DAYS_AHEAD
  ? Number(process.env.NEXT_PUBLIC_MAX_DAYS_AHEAD)
  : 30;

// Lunedì primo (it-IT). Coerente con flatpickr italiano usato negli altri
// DatePicker dell'app.
const WEEKDAYS_IT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", {
  month: "long",
  year: "numeric",
});

interface Props {
  type: SpotType;
  siteId: string;
  // "" = tutti i piani
  floorId: string;
  // Text search libera sul nome zona (ILIKE backend). "" = nessun filtro zona.
  // Coerente col filtro Zona della vista Lista, così i pallini riflettono
  // esattamente lo stesso conteggio.
  zoneName?: string;
  // YYYY-MM-DD delle proprie prenotazioni ACTIVE per `type`. Usato come
  // overlay (bordo) sulle celle.
  myReservedDates: Set<string>;
  // Etichetta opzionale da mostrare nelle celle dei giorni-mio (es. "Bari ·
  // P-01"). Visibile solo quando `showAvailability=false` — sennò i pallini
  // di disponibilità si scontrano col testo. In /my-reservations è la
  // sostituzione naturale dei pallini, in /parking|/desks resta vuota.
  myReservationLabels?: Map<string, string>;
  onDayClick: (iso: string) => void;
  // Default true: la pagina /parking|/desks vuole vedere i pallini availability.
  // false in /my-reservations: lì la calendar serve come panoramica delle
  // proprie prenotazioni + scorciatoia "vai a prenotare", senza fetch
  // disponibilità (sarebbe rumore informativo).
  showAvailability?: boolean;
  // Notifica al parent il mese attualmente visualizzato (Date al primo del
  // mese, UTC). Chiamato al mount + ad ogni navigazione prev/next.
  // /my-reservations lo usa per filtrare la fetch lista a "questo mese"
  // così il LIMIT vale per-mese e il banner truncated è meaningful.
  onMonthChange?: (firstOfMonthUtc: Date) => void;
  // Default false: prev disabled se l'intero mese precedente è < oggi, next
  // disabled se il mese successivo è > oggi+MAX_DAYS_AHEAD. Quando true
  // (usato in /my-reservations) prev/next sono sempre abilitati: la
  // navigazione è puramente di lettura, non vincolata ai limiti di prenotazione.
  unboundedNavigation?: boolean;
  // Mese iniziale. Letto solo al mount: serve a "ricordare" il mese tra
  // smontaggio/rimontaggio quando l'utente passa list→calendar→list. Default
  // = mese corrente. Tipicamente il padre passa il mese di `dateFrom` corrente
  // (se valorizzato) così il calendar si riallinea al filtro della lista.
  initialMonth?: Date;
  // Overlay closure passato dall'esterno. Quando `showAvailability=true` il
  // flag `closed` arriva già dalla response di `listAvailability`; questa
  // prop serve invece quando NON c'è fetch (es. /my-reservations vista
  // calendar con `showAvailability=false`) per popolare comunque l'overlay
  // grigio "giorno bloccato" via fetch separata lato parent (GET /closures).
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

function addDaysUtc(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

// Lun=0..Dom=6 (getUTCDay è Dom=0, Lun=1...).
function weekdayIndexLunDom(d: Date): number {
  const u = d.getUTCDay();
  return u === 0 ? 6 : u - 1;
}

export function SpotsCalendar({
  type,
  siteId,
  floorId,
  zoneName,
  myReservedDates,
  myReservationLabels,
  onDayClick,
  showAvailability = true,
  onMonthChange,
  unboundedNavigation = false,
  initialMonth,
  closuresByDate,
}: Props) {
  const [currentMonth, setCurrentMonth] = useState(() =>
    initialMonth ? startOfMonthUtc(initialMonth) : startOfMonthUtc(todayUtc()),
  );

  // Propaga al parent il mese visualizzato (al mount + ad ogni cambio).
  useEffect(() => {
    onMonthChange?.(currentMonth);
  }, [currentMonth, onMonthChange]);
  // Map iso → { available, total, closed?, closedReason? }. Il flag `closed`
  // viene popolato dal backend quando il giorno è bloccato per il filtro
  // (siteId, type) corrente: la cella diventa grigia "lucchetto" e
  // l'`onDayClick` viene disabilitato. Stesso shape di `SpotsAvailabilityDay`.
  const [data, setData] = useState<
    Map<string, { available: number; total: number; closed: boolean; closedReason: string | null }>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(todayUtc, []);
  const maxDate = useMemo(() => addDaysUtc(today, MAX_DAYS_AHEAD), [today]);

  // Range richiesto al backend: il mese visibile troncato a [oggi, oggi+30gg].
  // Le celle del mese fuori range vengono mostrate come disabled lato client.
  const monthStart = currentMonth;
  const monthEnd = useMemo(() => endOfMonthUtc(currentMonth), [currentMonth]);
  const fetchFrom = monthStart.getTime() < today.getTime() ? today : monthStart;
  const fetchTo = monthEnd.getTime() > maxDate.getTime() ? maxDate : monthEnd;

  useEffect(() => {
    // showAvailability=false: skip fetch (no pallini). Le celle sono comunque
    // cliccabili nelle date in range, come "vai a prenotare quel giorno".
    if (!showAvailability) {
      setData(new Map());
      return;
    }
    // SpotsBrowser monta con siteId="" e lo popola DOPO che listSites() ha
    // risposto. Senza questo skip, il primo fetch parte con siteId omesso →
    // backend ritorna la disponibilità sommata su tutte le sedi (numeri grossi
    // tipo 90), poi al cambio di siteId rifa il fetch e i numeri si correggono.
    // Se la prima risposta arriva dopo la seconda (race), l'utente vede i
    // numeri sbagliati finché non fa refresh.
    if (!siteId) {
      setData(new Map());
      return;
    }
    // Mese interamente fuori dal range valido: nessun fetch, calendar disabled.
    if (fetchFrom.getTime() > fetchTo.getTime()) {
      setData(new Map());
      return;
    }
    setLoading(true);
    setError(null);
    // Cleanup guard: se i filtri cambiano mentre questo fetch è in volo, la
    // sua risposta verrà ignorata. Evita di sovrascrivere `data` con il
    // risultato di una richiesta ormai obsoleta (race condition classica).
    let cancelled = false;
    api
      .listAvailability({
        type,
        from: isoFromUtc(fetchFrom),
        to: isoFromUtc(fetchTo),
        siteId,
        floorId: floorId || undefined,
        zoneName: zoneName || undefined,
      })
      .then((arr) => {
        if (cancelled) return;
        const m = new Map<
          string,
          { available: number; total: number; closed: boolean; closedReason: string | null }
        >();
        for (const d of arr) {
          m.set(d.date, {
            available: d.available,
            total: d.total,
            closed: d.closed,
            closedReason: d.closedReason,
          });
        }
        setData(m);
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setError(`Caricamento disponibilità: ${e.message}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // currentMonth.getTime() invece dell'oggetto Date per stabilizzare la dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAvailability, type, siteId, floorId, zoneName, currentMonth.getTime()]);

  // Costruisce le celle: pad iniziale (gg della settimana precedenti al 1°) +
  // giorni del mese + pad finale per arrotondare a 7.
  const cells = useMemo(() => {
    const pad = weekdayIndexLunDom(monthStart);
    const daysInMonth = monthEnd.getUTCDate();
    const totalCells = Math.ceil((pad + daysInMonth) / 7) * 7;
    const out: { iso: string | null; day: number | null; date: Date | null }[] = [];
    for (let i = 0; i < totalCells; i++) {
      const dayOfMonth = i - pad + 1;
      if (dayOfMonth < 1 || dayOfMonth > daysInMonth) {
        out.push({ iso: null, day: null, date: null });
      } else {
        const d = new Date(
          Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), dayOfMonth),
        );
        out.push({ iso: isoFromUtc(d), day: dayOfMonth, date: d });
      }
    }
    return out;
  }, [currentMonth, monthStart, monthEnd]);

  const monthLabel = MONTH_LABEL.format(currentMonth);
  // Intl restituisce "giugno 2026" minuscolo; capitalizzaiamo l'iniziale.
  const monthLabelCap = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

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

  // prev disabled quando l'intero mese precedente è prima di oggi.
  // next disabled quando il primo giorno del mese successivo è oltre oggi+30gg.
  // In modalità `unboundedNavigation` (es. /my-reservations) entrambi i
  // bound sono disabilitati: la lettura non è vincolata da MAX_DAYS_AHEAD.
  const prevMonthEnd = endOfMonthUtc(
    new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 1, 1)),
  );
  const prevDisabled = !unboundedNavigation && prevMonthEnd.getTime() < today.getTime();
  const nextMonthStart = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1),
  );
  const nextDisabled = !unboundedNavigation && nextMonthStart.getTime() > maxDate.getTime();

  return (
    <div className="rsv-calendar">
      <div className="rsv-calendar-header">
        <IconButton
          kind="ghost"
          size="sm"
          label="Mese precedente"
          align="bottom-left"
          disabled={prevDisabled}
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
          disabled={nextDisabled}
          onClick={gotoNext}
        >
          <ChevronRight />
        </IconButton>
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

      {loading ? (
        <InlineLoading description="Carico la disponibilità…" />
      ) : (
        <>
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
              const inRange =
                c.date!.getTime() >= today.getTime() &&
                c.date!.getTime() <= maxDate.getTime();
              const info = data.get(c.iso);
              // Closure rilevata da DUE fonti: `info.closed` (dalla fetch
              // listAvailability quando showAvailability=true) o
              // `closuresByDate` passata dal parent (overlay esterno usato
              // in /my-reservations dove non c'è fetch availability).
              // Le due fonti sono mutuamente esclusive in pratica ma
              // funzionano combinate (OR) per coprire entrambi i flussi.
              const externalClosureReason = closuresByDate?.get(c.iso) ?? null;
              const isClosed =
                info?.closed === true || externalClosureReason !== null;
              const closedReason =
                info?.closed === true ? info.closedReason : externalClosureReason;
              // Quando il giorno è bloccato, le info available/full perdono
              // significato: niente pallini, niente "esaurito". La sola
              // semantica visibile è "lucchetto + reason".
              const isFull = !isClosed && info !== undefined && info.available === 0;
              const isAvailable = !isClosed && info !== undefined && info.available > 0;
              const isMine = myReservedDates.has(c.iso);
              const isToday = c.date!.getTime() === today.getTime();
              // `unboundedNavigation` libera ANCHE il click sulle celle fuori
              // range — non solo la nav prev/next. Usato in /my-reservations
              // (lettura proprio storico) e in /admin/closures (selezione date
              // arbitrarie per i blocchi). Senza questo, il calendar
              // mostrerebbe `--disabled` su tutto ciò che non rientra in
              // [oggi, oggi+MAX_DAYS_AHEAD].
              const outOfRange = !unboundedNavigation && !inRange;
              // Click su giorno bloccato:
              //   - normalmente disabilitato (l'utente non può prenotare);
              //   - MA se ho una prenotazione esistente lì (`isMine`), abilitato
              //     così posso cancellarla. Caso reale: blocco aggiunto DOPO la
              //     mia prenotazione → vedo cella grigia + bordo blu, e devo
              //     poter cliccare per aprire il modal di cancel.
              const closedNotMine = isClosed && !isMine;
              const disabled =
                outOfRange || closedNotMine || (showAvailability && !info);

              const classes = [
                "rsv-calendar-day",
                disabled && !isClosed && "rsv-calendar-day--disabled",
                isClosed && "rsv-calendar-day--closed",
                isAvailable && "rsv-calendar-day--available",
                isFull && "rsv-calendar-day--full",
                isMine && "rsv-calendar-day--mine",
                isToday && "rsv-calendar-day--today",
              ]
                .filter(Boolean)
                .join(" ");

              // Label "sede · codice" da mostrare nei giorni-mio quando non
              // ci sono i pallini availability (in /my-reservations). Se
              // assente, la cella resta solo col bordo blu.
              const myLabel =
                !showAvailability && isMine ? myReservationLabels?.get(c.iso) : undefined;

              return (
                <button
                  key={c.iso}
                  type="button"
                  className={classes}
                  disabled={disabled}
                  onClick={() => !disabled && onDayClick(c.iso!)}
                  aria-label={
                    isClosed
                      ? `${c.day} ${monthLabelCap}, giorno bloccato: ${closedReason ?? ""}`
                      : isAvailable
                        ? `${c.day} ${monthLabelCap}, ${info!.available} posti disponibili${isMine ? ", hai una prenotazione" : ""}`
                        : isFull
                          ? `${c.day} ${monthLabelCap}, tutti i posti occupati${isMine ? ", hai una prenotazione" : ""}`
                          : myLabel
                            ? `${c.day} ${monthLabelCap}, prenotazione: ${myLabel}`
                            : `${c.day} ${monthLabelCap}`
                  }
                  title={
                    isClosed
                      ? `Giorno bloccato: ${closedReason ?? ""}`
                      : isAvailable
                        ? `${info!.available} disponibili su ${info!.total}`
                        : isFull
                          ? `Tutti i ${info!.total} posti occupati`
                          : myLabel ?? undefined
                  }
                >
                  <span className="rsv-calendar-day-number">{c.day}</span>
                  {isAvailable && (
                    <span className="rsv-calendar-pill rsv-calendar-pill--available">
                      {info!.available}
                    </span>
                  )}
                  {isFull && <span className="rsv-calendar-pill rsv-calendar-pill--full" />}
                  {myLabel && <span className="rsv-calendar-day-label">{myLabel}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
