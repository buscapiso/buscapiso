import type { Route } from '../engine/travel';
import type { Listing, Status } from './api';
import { t } from './i18n';

export function costLine(l: Listing): string {
  if (l.expenses === 0) return t('listing.allIncluded');
  if (l.expenses === null) return t('listing.expensesUnknown');
  return t('listing.plusExpenses', { price: l.price ?? '?', expenses: l.expenses });
}


export const STATUSES: Status[] = [
  'new', 'liked', 'contacted', 'visit_scheduled', 'visited', 'applied',
  'got_it', 'rejected', 'hidden', 'discarded',
];

// Colores de las lineas que conoce el grafo propio (TMB y FGC). Una linea
// sin color conocido se pinta neutra.
const LINE_COLOURS: Record<string, string> = {
  L1: '#e2231a', L2: '#93248f', L3: '#1eb53a', L4: '#f7a30e', L5: '#0078bd',
  L8: '#e46ba1', L9N: '#f68b1f', L9S: '#f68b1f', L10N: '#00a6d6', L10S: '#00a6d6',
  L11: '#91c83e',
};

export function lineChips(route: string | undefined): string[] {
  return route ? route.match(/\b(?:L\d+[NS]?|R\d+[NS]?|S\d+|T\d)\b/g) ?? [] : [];
}

export function lineColor(line: string): string | null {
  return LINE_COLOURS[line] ?? null;
}

export function scoreColor(score: number, best: number): string {
  return score >= best - Math.abs(best) / 3 ? 'var(--accent)' : 'var(--muted)';
}

const GMAPS_MODE = { transit: 'transit', walk: 'walking', bike: 'bicycling' } as const;

export function directionsUrl(from: { lat: number; lon: number }, to: { lat: number; lon: number },
                              mode: 'transit' | 'walk' | 'bike'): string {
  const q = new URLSearchParams({ api: '1', origin: `${from.lat},${from.lon}`,
    destination: `${to.lat},${to.lon}`, travelmode: GMAPS_MODE[mode] });
  return `https://www.google.com/maps/dir/?${q}`;
}

export type LegPart = { kind: 'walk' | 'bike'; text: string; color: null }
  | { kind: 'ride'; line: string; text: string; color: string | null };

/** Los tramos de un camino en pocas palabras; los paseos de 0 min sobran. */
export function legParts(route: Route): LegPart[] {
  return route.legs.filter((l) => l.mode === 'transit' || l.minutes > 0).map((l) => (l.mode === 'transit'
    ? { kind: 'ride', line: l.line, text: `${l.from} → ${l.to}, ${l.minutes} min`, color: l.color ?? lineColor(l.line) }
    : { kind: l.mode, text: `${l.mode} ${l.minutes} min`, color: null }));
}
