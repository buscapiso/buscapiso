// La web habla con la extension por window.postMessage; el content script
// "puente" de la extension pasa los mensajes a su fondo. Sin respuesta al
// "hello" en un segundo, no hay extension.
import type { FetchPage, FetchRequest, FetchResult } from '../engine/model';

export const PROTOCOL = 1;
export interface ExtensionStatus { installed: boolean; outdated: boolean; version: string | null; browser: string | null }

type Pending = { resolve: (m: Record<string, unknown>) => void; onNeedsUser?: () => void };
const pending = new Map<string, Pending>();
let counter = 0;
let status: ExtensionStatus = { installed: false, outdated: false, version: null, browser: null };

function listen() {
  window.addEventListener('message', (e) => {
    if (e.source && e.source !== window) return;   // jsdom deja source a null
    const d = e.data as Record<string, unknown> | null;
    if (!d || d.buscapiso !== 'response' || typeof d.id !== 'string') return;
    const p = pending.get(d.id);
    if (!p) return;
    if (d.type === 'progress' && d.state === 'needs-user') { p.onNeedsUser?.(); return; }
    pending.delete(d.id);
    p.resolve(d);
  });
}
if (typeof window !== 'undefined') listen();

function send(msg: Record<string, unknown>, onNeedsUser?: () => void, timeoutMs?: number): Promise<Record<string, unknown> | null> {
  const id = `m${++counter}`;
  return new Promise((resolve) => {
    pending.set(id, { resolve, onNeedsUser });
    window.postMessage({ buscapiso: 'request', id, ...msg }, window.location.origin);
    if (timeoutMs) setTimeout(() => { if (pending.delete(id)) resolve(null); }, timeoutMs);
  });
}

/** Pregunta a la extension si esta. Se repite al abrir la web y antes de buscar. */
export async function detectExtension(timeoutMs = 1000): Promise<ExtensionStatus> {
  const r = await send({ type: 'hello', protocol: PROTOCOL }, undefined, timeoutMs);
  status = r ? { installed: true, outdated: Number(r.protocol) < PROTOCOL, version: String(r.version ?? ''),
    browser: String(r.browser ?? '') } : { installed: false, outdated: false, version: null, browser: null };
  return status;
}
export const extensionStatus = () => status;

const fetchPage: FetchPage = async (req: FetchRequest, onNeedsUser) => {
  // Margen sobre el plazo de la extension, por si su fondo se duerme.
  const r = await send({ type: 'fetch', ...req }, onNeedsUser, (req.timeoutMs ?? 180_000) + 30_000);
  if (!r) return { ok: false, reason: 'timeout' };
  const { buscapiso: _t, id: _i, type: _ty, ...rest } = r;
  return rest as unknown as FetchResult;
};

/** El fetcher de la extension, o null si no esta instalada o es antigua. */
export const extensionFetchPage = (): FetchPage | null => (status.installed && !status.outdated ? fetchPage : null);

/** Parar: la extension cierra sus pestañas y falla lo pendiente. */
export async function cancelExtension(): Promise<void> {
  if (status.installed) await send({ type: 'cancel' }, undefined, 5000);
}
