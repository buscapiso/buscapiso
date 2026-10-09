// Busquedas automaticas cada pocas horas, mientras haya una pestaña de
// buscapiso abierta, solo dentro de la franja elegida y nunca encima de otra
// busqueda (el Web Lock de startSearch cubre tambien otras pestañas). Un fallo
// al lanzar no para el programador: se reintenta cuando vuelva a tocar.
export interface Schedule { hours: number; from: string; to: string; last_run: string | null }
export type Tick = 'off' | 'outside_hours' | 'not_due' | 'busy' | 'started' | 'failed';

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function insideWindow(now: Date, from: string, to: string): boolean {
  const t = now.getHours() * 60 + now.getMinutes(), a = minutes(from), b = minutes(to);
  return a <= b ? a <= t && t <= b : t >= a || t <= b;   // franja que cruza medianoche
}

export async function tick(now: Date, read: () => Promise<Schedule>, isRunning: () => boolean,
  markRun: (iso: string) => Promise<void>, start: () => Promise<unknown>): Promise<Tick> {
  const s = await read();
  if (!s.hours) return 'off';
  if (!insideWindow(now, s.from, s.to)) return 'outside_hours';
  if (s.last_run && now.getTime() - Date.parse(s.last_run) < s.hours * 3_600_000) return 'not_due';
  if (isRunning()) return 'busy';
  // Se apunta antes de lanzar: si falla, no se reintenta cada minuto.
  await markRun(now.toISOString());
  try {
    await start();
  } catch {
    return 'failed';
  }
  return 'started';
}

export function startScheduler(run: () => Promise<Tick>, everyMs = 60_000): () => void {
  const id = setInterval(() => { run().catch(() => {}); }, everyMs);
  return () => clearInterval(id);
}
