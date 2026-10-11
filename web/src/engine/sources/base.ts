import type { Gender, ListingType, RawListing } from '../model';
import type { City } from '../coverage';
import type { CityCandidate } from '../geocode';
import type { Province } from '../cities/names';
import type { SearchProfile } from '../profiles';

// Solo idealista y roomgo publican el genero del piso como dato. En el resto
// hay que leerlo del texto libre, con dos reglas: exigir senales explicitas,
// y marcarlo como no confirmado.
const WOMEN = new RegExp(
  // Castellano y catalan, con numeros por medio: "Busquem nomes 3 Noies".
  String.raw`(?:piso|pis)\s+(?:de|solo|s[oó]lo|nom[eé]s|only)\s+(?:\d+\s+)?` +
  String.raw`(?:chicas|noi[ae]s?|dones|mujeres|girls)|` +
  String.raw`(?:solo|s[oó]lo|nom[eé]s|only|unicament|[uú]nicamente)\s+(?:\d+\s+)?` +
  String.raw`(?:chicas|noi[ae]s?|dones|mujeres|girls)|` +
  String.raw`(?:busco|buscamos|busquem|se\s+busca|es\s+busca)\s+` +
  String.raw`(?:nom[eé]s\s+|solo\s+|s[oó]lo\s+)?(?:\d+\s+)?` +
  String.raw`(?:una\s+)?(?:chicas?|compa[nñ]eras?|noi[ae]s?|companyes?)\b|` +
  String.raw`som\s+\d*\s*noi[ae]s?|somos\s+\d*\s*chicas|` +
  String.raw`piso\s+femenino|convivencia\s+femenina|pis\s+de\s+noi[ae]s?`, 'i');
const MEN = new RegExp(String.raw`solo\s+chicos|s[oó]lo\s+chicos|only\s+boys|` +
  String.raw`nom[eé]s\s+(?:\d+\s+)?nois\b|piso\s+de\s+chicos|somos\s+\d*\s*chicos`, 'i');
// Va ANTES que los demas: "Somos 2 chicas" es cierto dentro de "Somos 2 chicas
// y 1 chico". Si el texto nombra los dos generos, el piso es mixto.
const MIXED = new RegExp(String.raw`\bmixto\b|\bmixte\b|chicos?/as|` +
  String.raw`chic[ao]s?\s+y\s+(?:\d+\s+|un[ao]?\s+)?chic[ao]s?|` +
  String.raw`noi[aes]*\s+i\s+(?:\d+\s+|un[ae]?\s+)?noi[aes]*|` +
  String.raw`compa[nñ]er[oa]\s*/\s*a\b|noi\s*/\s*a\b|chic[oa]\s*/\s*a\b`, 'i');

/** Genero del piso deducido del texto. Siempre sin confirmar. */
export function inferGender(text: string): Gender {
  if (MIXED.test(text)) return 'mixed';
  if (WOMEN.test(text)) return 'female_only';
  if (MEN.test(text)) return 'male_only';
  return 'unknown';
}

/** Metros cuadrados, o null. Muchos anunciantes rellenan "1" para no dar el
 * dato; leerlo como 1 m2 descartaria esos pisos por pequenos. */
export function surface(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? Math.trunc(value) : /^\s*[+-]?\d+\s*$/.test(String(value)) ? parseInt(String(value), 10) : NaN;
  return Number.isFinite(n) && n > 1 ? n : null;
}

/** Zona de busqueda (un distrito, un pueblo de alrededor). `portals` guarda,
 * por fuente, como la llama ese portal; solo lo lee la fuente que lo escribio. */
export interface Area {
  name: string;
  lat: number;
  lon: number;
  portals: Record<string, string | null>;
}

// --- La red ---------------------------------------------------------------
/** Como trata la red a un portal: pausas, y como se reconoce un bloqueo. */
export interface NetRules {
  pause: [number, number];          // segundos entre peticiones al portal
  blockedMarkers: string[];
  /** Pagina de veto (no de captcha): se deja de pedir a ese portal. */
  fatalMarkers?: string[];
  readyMarkers?: string[];
  minLength: number;                 // un HTML mas corto es un bloqueo
  /** El portal admite CORS: la web lo pide sin la extension (vale en iPad). */
  direct?: boolean;
}

export interface NetRequest {
  url: string;
  method?: 'GET' | 'POST';
  /** Cuerpo de formulario o JSON; con uno de los dos, POST. */
  form?: Record<string, string>;
  json?: unknown;
  headers?: Record<string, string>;
  /** Por fetch directo aunque la fuente vaya por la extension (APIs con CORS). */
  direct?: boolean;
  /** Si el portal pide captcha, abrir una pestaña para resolverlo. Por defecto,
   * si en paginas HTML de busqueda; no en APIs ni al descubrir ciudades. */
  tab?: boolean;
}

/** Por que no llego una respuesta: 'blocked', 'banned', 'timeout',
 * 'cancelled', 'no-extension', 'not-allowed' (extension antigua) u otro. */
export class NetError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

/** Lo unico que una fuente sabe de la red. Respeta la pausa del portal entre
 * peticiones y lanza NetError si no hay respuesta util. */
export interface Net {
  page(req: string | NetRequest): Promise<{ body: string; finalUrl: string }>;
  json<T = unknown>(req: string | NetRequest): Promise<T>;
}

// --- El contrato de una fuente ----------------------------------------------
export interface SearchQuery {
  profile: SearchProfile;
  type: ListingType;
  city: City;
  /** Las zonas elegidas por tiempo de trayecto. */
  areas: Area[];
  /** Paginas como mucho por zona. */
  pages: number;
  /** Avisos y progreso que la busqueda enseña. */
  emit(kind: 'info' | 'warning' | 'progress', message: string, data?: Record<string, unknown>): void;
}

/** Un trozo de resultados: los anuncios y de donde salieron ('Gràcia page 2'). */
export interface Batch { listings: RawListing[]; label: string }

/** Una zona que un portal dice tener al descubrir una ciudad. */
export interface Zone { label: string; town: boolean; ref: string; count: number }
export interface Coverage {
  /** Como llama el portal a la ciudad entera. */
  ref: string;
  /** Sus distritos y pueblos de alrededor, si busca por zonas. */
  zones?: Zone[];
  /** Que encontro: '14 districts'. */
  note?: string;
}
export interface DiscoverCtx {
  city: CityCandidate;
  province: Province;
  /** El nombre como trozo de URL, y sus variantes: 'donostia-san-sebastian', 'donostia'. */
  slugs: string[];
  /** Lo que dejaron las fuentes anteriores (Habitaclia usa el codigo INE de Fotocasa). */
  facts: Record<string, unknown>;
  /** Segunda vuelta, con los hechos de todas las demas (ver retryDiscover). */
  retry: boolean;
  /** La pagina, o null si no existe o no se pudo leer. */
  page(url: string, opts?: { tab?: boolean }): Promise<{ html: string; finalUrl: string } | null>;
  /** JSON por la red de la fuente (con su pausa), o null. */
  json<T = unknown>(req: string | NetRequest): Promise<T | null>;
  log(message: string): void;
}

export const zonesNote = (n: number) => (n ? `${n} districts` : 'the whole city');

/** Un portal. Todo lo suyo vive en su archivo: como se pide, como se lee y
 * como se descubre una ciudad. El resto del motor solo ve anuncios. */
export interface Source {
  name: string;
  label: string;
  types: ListingType[];
  net: NetRules;
  /** Entrega lotes hasta acabar; decide como pedir, cuando paginar y cuando parar. */
  search(q: SearchQuery, net: Net): AsyncIterable<Batch>;
  /** Peticiones previstas como mucho, para la barra de progreso. */
  planned?(q: SearchQuery): number;
  /** La ficha completa de un anuncio. */
  detail?(l: RawListing, net: Net): Promise<Partial<RawListing>>;
  /** 'all': sin la ficha el anuncio no sirve; 'best': se leen las de los mejores. */
  details?: 'all' | 'best';
  /** Si tiene la ciudad, como la llama (y sus zonas); si no, null. */
  discover?(ctx: DiscoverCtx): Promise<Coverage | null>;
  /** Se vuelve a probar cuando las demas fuentes han dejado sus hechos. */
  retryDiscover?: boolean;
  /** Como llama a una zona que otro portal encontro, o null. */
  fillZone?(zone: { label: string; town: boolean; portals: Record<string, string | null> }): string | null;
}

// --- Paginas HTML numeradas -------------------------------------------------
export interface DetailRequest { url: string; form?: Record<string, string> }

/** Lo que basta para un portal de paginas numeradas: el bucle de siempre. */
export interface PagedSpec extends Omit<Source, 'search' | 'planned' | 'detail'> {
  /** true si recorre zonas; false si tiene una sola lista por ciudad. */
  perArea: boolean;
  /** Una pagina con menos anuncios que esto es la ultima. */
  pageSize: number;
  /** URL de la pagina `page` (1..) para esa zona (null: la ciudad entera), o
   * null si el portal no la cubre. */
  listUrl(area: Area | null, profile: SearchProfile, page: number, city: City): string | null;
  parseList(html: string, type: ListingType, city: City): RawListing[];
  totalPages?(html: string): number;
  /** Corta la paginacion de una zona tras este lote (p. ej. ya supera el techo). */
  shouldStop?(batch: RawListing[], profile: SearchProfile): boolean;
  detailRequest?(l: RawListing): DetailRequest;
  parseDetail?(body: string): Partial<RawListing>;
}
export type PagedSource = Source & PagedSpec;

/** Errores que paran el portal entero; con los demas se salta a la zona siguiente. */
export const FATAL = new Set(['blocked', 'banned', 'timeout', 'cancelled', 'no-extension', 'not-allowed']);

/** Despues de leer la ficha, el genero inferido puede cambiar con la descripcion. */
export function mergeDetail(l: RawListing, d: Partial<RawListing>): void {
  Object.assign(l, d);
  if (!l.genderConfirmed) l.gender = inferGender(`${l.title} ${l.description}`);
}

/** Zonas con URL propia; varias zonas pueden compartir una (Fotocasa: toda la ciudad). */
function startUrls(spec: PagedSpec, q: SearchQuery): Map<string, Area | null> {
  const starts = new Map<string, Area | null>();
  for (const a of spec.perArea ? q.areas : []) {
    const u = spec.listUrl(a, q.profile, 1, q.city);
    if (u && !starts.has(u)) starts.set(u, a);
  }
  if (!starts.size) {
    const u = spec.listUrl(null, q.profile, 1, q.city);
    if (u) starts.set(u, null);
  }
  return starts;
}

export function pagedHtml(spec: PagedSpec): PagedSource {
  const detail = spec.detailRequest && spec.parseDetail
    ? async (l: RawListing, net: Net) => {
      const req = spec.detailRequest!(l);
      return spec.parseDetail!((await net.page({ url: req.url, form: req.form })).body);
    }
    : undefined;
  return {
    ...spec,
    detail,
    planned: (q) => startUrls(spec, q).size * q.pages,
    async *search(q, net) {
      const seen = new Set<string>();
      for (const area of startUrls(spec, q).values()) {
        for (let page = 1; page <= q.pages; page++) {
          const url = spec.listUrl(area, q.profile, page, q.city);
          if (!url) break;
          let body: string;
          try {
            body = (await net.page(url)).body;
          } catch (e) {
            if (!(e instanceof NetError) || FATAL.has(e.reason)) throw e;
            q.emit('warning', `  ${spec.name} ${area?.name ?? ''} page ${page} failed (${e.reason.slice(0, 60)}); going on`);
            break;
          }
          const batch = spec.parseList(body, q.type, q.city).filter((l) => !seen.has(l.sourceId));
          batch.forEach((l) => seen.add(l.sourceId));
          if (spec.details === 'all' && detail) await readAll(spec.name, batch, net, q, detail);
          yield { listings: batch, label: `${area ? area.name.split(',')[0] + ' ' : ''}page ${page}` };
          if (batch.length < spec.pageSize) break;
          if (spec.totalPages && page >= spec.totalPages(body)) break;
          if (spec.shouldStop?.(batch, q.profile)) break;
        }
      }
    },
  };
}

/** Sin la ficha, algunos portales no dicen quien vive en el piso. */
async function readAll(name: string, ls: RawListing[], net: Net, q: SearchQuery,
  detail: (l: RawListing, net: Net) => Promise<Partial<RawListing>>): Promise<void> {
  if (!ls.length) return;
  q.emit('info', `  ${name}: ${ls.length} listings, reading them in full...`);
  let i = 0;
  for (const l of ls) {
    if (++i % 5 === 0) q.emit('progress', `    ${name} ${i}/${ls.length}`, { done: i, total: ls.length });
    try {
      mergeDetail(l, await detail(l, net));
    } catch (e) {
      if (e instanceof NetError && e.reason === 'cancelled') throw e;
      // una ficha ilegible no tumba el resto
    }
  }
}

/** DOMParser en el navegador y en jsdom. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

/** Como get_text(sep, strip=True) de BeautifulSoup: cada trozo de texto
 * recortado, sin vacios, sin script ni style, unidos con `sep`. */
export function getText(node: Node | null | undefined, sep = ' '): string {
  if (!node) return '';
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const t = (n.nodeValue ?? '').trim();
      if (t) parts.push(t);
    } else if (n.nodeType === 1 || n.nodeType === 9 || n.nodeType === 11) {
      if (n.nodeType === 1 && SKIP.has((n as Element).tagName)) return;
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
    }
  };
  walk(node);
  return parts.join(sep);
}

/** Entero de un texto como "1.250 €" o null. */
export function intFrom(s: string | null | undefined): number | null {
  const m = (s ?? '').replace(/\./g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}
