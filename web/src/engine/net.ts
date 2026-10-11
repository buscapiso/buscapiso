// La red de cada fuente: por la extension, o directa si el portal admite
// CORS. Aplica las reglas del portal (pausa entre peticiones, como se
// reconoce un bloqueo) para que las fuentes solo pidan y lean.
import type { FetchPage } from './model';
import { NetError, type Net, type NetRequest, type Source } from './sources/base';

export interface DirectInit {
  method?: string;
  form?: Record<string, string>;
  json?: unknown;
  headers?: Record<string, string>;
}
/** fetch() desde la web: solo para portales y APIs con CORS. */
export type FetchDirect = (url: string, init?: DirectInit) => Promise<string>;

export interface NetDeps {
  /** La extension; null si no esta instalada. */
  fetchPage: FetchPage | null;
  fetchDirect: FetchDirect;
  sleep(ms: number): Promise<void>;
  random(): number;
  signal?: AbortSignal;
  /** El portal pide confirmar que eres humano en la pestaña que se abrio. */
  onCaptcha?(src: Source): void;
}
export interface NetOptions {
  /** Sin pausa entre peticiones (descubrir una ciudad prueba nombres, no pagina). */
  pause?: boolean;
  timeoutMs?: number;
  /** Abrir pestaña ante un captcha en paginas HTML (por defecto, si). */
  tabs?: boolean;
  /** Tratar una pagina corta o con marcas de captcha como bloqueo (por
   * defecto, si). Al descubrir no: un portal sin la ciudad responde corto. */
  checks?: boolean;
}

export const CAPTCHA_TIMEOUT_MS = 180_000;

export function makeNet(src: Source, deps: NetDeps, opts: NetOptions = {}): Net {
  let first = true;
  const rules = src.net;

  async function wait() {
    if (!first && opts.pause !== false) {
      await deps.sleep((rules.pause[0] + deps.random() * (rules.pause[1] - rules.pause[0])) * 1000);
    }
    first = false;
  }

  async function fetchBody(req: NetRequest, html: boolean): Promise<{ body: string; finalUrl: string }> {
    if (deps.signal?.aborted) throw new NetError('cancelled');
    await wait();
    if (deps.signal?.aborted) throw new NetError('cancelled');
    const method = req.method ?? (req.form || req.json !== undefined ? 'POST' : 'GET');
    const plain = method === 'GET' && !req.headers;
    if (req.direct ?? rules.direct) {
      try {
        const body = await deps.fetchDirect(req.url,
          plain ? undefined : { method, form: req.form, json: req.json, headers: req.headers });
        return { body, finalUrl: req.url };
      } catch (e) {
        throw new NetError(`network: ${(e as Error).message}`);
      }
    }
    if (!deps.fetchPage) throw new NetError('no-extension');
    const type = req.json !== undefined ? 'application/json' : req.form ? 'application/x-www-form-urlencoded' : null;
    const init = plain ? undefined : {
      method,
      headers: { ...(type ? { 'Content-Type': type } : {}), ...req.headers },
      body: req.json !== undefined ? JSON.stringify(req.json) : req.form ? new URLSearchParams(req.form).toString() : undefined,
    };
    const r = await deps.fetchPage({
      url: req.url, portal: src.name, blockedMarkers: rules.blockedMarkers, fatalMarkers: rules.fatalMarkers,
      readyMarkers: rules.readyMarkers, allowTab: req.tab ?? (html && opts.tabs !== false),
      timeoutMs: opts.timeoutMs ?? CAPTCHA_TIMEOUT_MS, ...(init ? { init } : {}),
    }, () => deps.onCaptcha?.(src));
    if (!r.ok) throw new NetError(r.reason);
    // Una extension anterior no conoce fatalMarkers: se mira tambien aqui.
    if ((rules.fatalMarkers ?? []).some((m) => r.html.includes(m))) throw new NetError('banned');
    if (html && opts.checks !== false && (r.html.length < rules.minLength || rules.blockedMarkers.some((m) => r.html.includes(m)))) {
      throw new NetError('blocked');
    }
    return { body: r.html, finalUrl: r.finalUrl };
  }

  const asReq = (r: string | NetRequest): NetRequest => (typeof r === 'string' ? { url: r } : r);
  return {
    page: (r) => fetchBody(asReq(r), true),
    async json<T>(r: string | NetRequest): Promise<T> {
      const { body } = await fetchBody(asReq(r), false);
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new NetError('not JSON (blocked?)');
      }
    },
  };
}
