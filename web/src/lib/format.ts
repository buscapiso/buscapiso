import type { Listing, Status } from './api';
import type { ListName } from './router.svelte';
import { t } from './i18n';

export function costLine(l: Listing): string {
  if (l.expenses === 0) return t('listing.allIncluded');
  if (l.expenses === null) return t('listing.expensesUnknown');
  return t('listing.plusExpenses', { price: l.price ?? '?', expenses: l.expenses });
}

export const LISTS: Record<ListName, { status?: Status[]; group?: 'accepted' | 'possible' }> = {
  inbox: { status: ['new'], group: 'accepted' },
  liked: { status: ['liked'] },
  progress: { status: ['contacted', 'visit_scheduled', 'visited', 'applied'] },
  ask: { status: ['new'], group: 'possible' },
  hidden: { status: ['hidden', 'discarded'] },
};

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
