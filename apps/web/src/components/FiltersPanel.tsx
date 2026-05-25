"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "@carbon/icons-react";
import { Tag } from "@carbon/react";

interface Props {
  summary: string;
  activeCount: number;
  children: ReactNode;
}

// Wrapper collassabile per il blocco filtri (Sede/Piano/Data + filtro Zona).
// Default: espanso su desktop, collassato su mobile (Carbon $breakpoint-md = 672px).
// SSR-safe: parto sempre espanso, poi al mount valuto matchMedia per evitare
// hydration mismatch.
export function FiltersPanel({ summary, activeCount, children }: Props) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 671px)");
    if (mq.matches) setExpanded(false);
  }, []);

  return (
    <div className="rsv-filters-panel">
      <button
        type="button"
        className="rsv-filters-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="rsv-filters-toggle-label">
          <span>Filtri</span>
          {activeCount > 0 && (
            <Tag type="blue" size="sm">
              {activeCount}
            </Tag>
          )}
        </span>
        {!expanded && (
          <span className="rsv-filters-summary" title={summary}>
            {summary}
          </span>
        )}
        <span className="rsv-filters-chevron" aria-hidden>
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </span>
      </button>
      <div
        className="rsv-filters-body"
        hidden={!expanded}
        aria-hidden={!expanded}
      >
        {children}
      </div>
    </div>
  );
}
