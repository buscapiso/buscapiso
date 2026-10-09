import type { SearchEvent } from './api';

/** Lo que el panel enseña de una busqueda a partir de sus eventos. */
export function summarize(events: SearchEvent[]) {
  let step = 0, total = 5;
  // Portal con un captcha esperando a la persona; se limpia cuando ese
  // portal vuelve a dar noticias o cambia la etapa.
  let captcha: string | null = null;
  let done: SearchEvent | null = null, error: SearchEvent | null = null;
  const warnings: string[] = [];
  for (const e of events) {
    if (e.kind === 'stage') {
      step = Number(e.data.step ?? step); total = Number(e.data.total ?? total); captcha = null;
    } else if (e.kind === 'captcha') captcha = String(e.data.portal ?? 'A portal');
    else if (captcha && e.data.source === captcha) captcha = null;
    if (e.kind === 'warning') warnings.push(e.message.trim());
    else if (e.kind === 'done') done = e;
    else if (e.kind === 'error') error = e;
  }
  return { step, total, captcha, done, error, warnings };
}

/** "m:ss" desde el inicio de la busqueda, o '' si el evento no lo trae. */
export function clock(e: SearchEvent): string {
  const s = e.data.elapsed;
  if (typeof s !== 'number') return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
