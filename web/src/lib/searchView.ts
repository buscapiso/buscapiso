import type { SearchEvent } from './api';

export interface PortalProgress {
  name: string;
  pages: number;
  /** Paginas como mucho; al acabar, las que hizo de verdad. */
  planned: number;
  found: number;
  state: 'reading' | 'captcha' | 'done' | 'warn';
  /** Fichas leidas de las encontradas, mientras se leen. */
  full: [number, number] | null;
}
export interface FoundSample { source: string; title: string; price: number | null; photo: string; url: string; place: string }

const RECENT = 8;

/** Lo que el panel enseña de una busqueda a partir de sus eventos. */
export function summarize(events: SearchEvent[]) {
  let step = 0, total = 5;
  // Portal con un captcha esperando a la persona; se limpia cuando ese
  // portal vuelve a dar noticias o cambia la etapa.
  let captcha: string | null = null;
  let done: SearchEvent | null = null, error: SearchEvent | null = null;
  let stageProgress = 0;
  const warnings: string[] = [];
  const portals = new Map<string, PortalProgress & { warned: boolean; finished: boolean }>();
  const recent: FoundSample[] = [];
  for (const e of events) {
    if (e.kind === 'stage') {
      step = Number(e.data.step ?? step); total = Number(e.data.total ?? total); captcha = null; stageProgress = 0;
    } else if (e.kind === 'captcha') captcha = String(e.data.portal ?? 'A portal');
    else if (captcha && e.data.source === captcha) captcha = null;
    if (e.kind === 'warning') warnings.push(e.message.trim());
    else if (e.kind === 'done') done = e;
    else if (e.kind === 'error') error = e;

    if (e.data.plan) {
      for (const [name, planned] of Object.entries(e.data.plan as Record<string, number>)) {
        portals.set(name, { name, pages: 0, planned, found: 0, state: 'reading', full: null, warned: false, finished: false });
      }
    }
    if (e.data.page) recent.push(...((e.data.sample as FoundSample[] | undefined) ?? []));
    const p = typeof e.data.source === 'string' ? portals.get(e.data.source) : undefined;
    if (p) {
      if (e.data.page) {
        p.pages++;
        p.found = Number(e.data.found ?? p.found);
      }
      if (e.kind === 'warning') p.warned = true;
      if (e.kind === 'progress') p.full = [Number(e.data.done), Number(e.data.total)];
      if (e.data.finished) { p.finished = true; p.found = Number(e.data.found ?? p.found); p.full = null; }
    } else if (e.kind === 'progress' && Number(e.data.total) > 0) stageProgress = Number(e.data.done) / Number(e.data.total);
  }
  const list: PortalProgress[] = [...portals.values()].map(({ warned, finished, ...p }) => ({ ...p,
    planned: finished ? p.pages : p.planned,
    state: finished ? (warned ? 'warn' : 'done') : captcha === p.name ? 'captcha' : 'reading' }));
  const planned = list.reduce((n, p) => n + p.planned, 0);
  const crawled = list.reduce((n, p) => n + Math.min(p.pages, p.planned), 0);
  const fraction = step <= 1 ? (planned ? crawled / planned : 0) : stageProgress;
  return { step, total, captcha, done, error, warnings, portals: list, fraction, recent: recent.reverse().slice(0, RECENT) };
}

/** "m:ss" desde el inicio de la busqueda, o '' si el evento no lo trae. */
export function clock(e: SearchEvent): string {
  const s = e.data.elapsed;
  if (typeof s !== 'number') return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
