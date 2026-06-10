// Punto unico di lettura delle regole business configurabili via env. Mantiene
// gli altri service liberi da `process.env` direttamente e centralizza il
// fallback in un solo posto.

// Massimo numero di giorni nel futuro per cui si può prenotare (e per cui il
// calendario mostra disponibilità). Coerente con NEXT_PUBLIC_MAX_DAYS_AHEAD
// usato dal frontend. Fallback 30.
export const MAX_DAYS_AHEAD: number = process.env.MAX_DAYS_AHEAD
  ? Number(process.env.MAX_DAYS_AHEAD)
  : 30;
