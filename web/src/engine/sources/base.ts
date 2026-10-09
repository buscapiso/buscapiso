import type { Gender, ListingType, RawListing } from '../model';
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

/** Zona de busqueda de un portal (un distrito, un municipio). */
export interface Area {
  name: string;
  lat: number;
  lon: number;
  idealista: string | null;
  fotocasa: string | null;
  habitaclia: string | null;
}

/** Contrato de cada portal. Ninguna fuente pide nada por su cuenta: dice que
 * URLs leer y como interpretar el HTML. */
export interface Source {
  name: string;
  types: ListingType[];
  pause: [number, number];          // segundos entre peticiones al portal
  blockedMarkers: string[];
  /** Pagina de veto (no de captcha): se deja de pedir a ese portal. */
  fatalMarkers?: string[];
  readyMarkers?: string[];
  minLength: number;                 // un HTML mas corto es un bloqueo
  /** URL de la pagina `page` (1..) para esa zona, o null si el portal no la cubre. */
  listUrl(area: Area | null, profile: SearchProfile, page: number): string | null;
  /** true si la fuente recorre zonas; false si tiene una sola lista por ciudad. */
  perArea: boolean;
  /** Una pagina con menos anuncios que esto es la ultima. */
  pageSize: number;
  parseList(html: string, type: ListingType): RawListing[];
  totalPages?(html: string): number;
  /** Corta la paginacion de una zona tras este lote (p. ej. ya supera el techo). */
  shouldStop?(batch: RawListing[], profile: SearchProfile): boolean;
  /** Como pedir la ficha de un anuncio. */
  detailRequest?(l: RawListing): DetailRequest;
  parseDetail?(body: string): Partial<RawListing>;
  /** Sin la ficha el anuncio no sirve (no dice quien vive): leerlas todas. */
  detailsForAll?: boolean;
  /** El portal admite CORS: la web lo pide sin la extension (vale en iPad). */
  direct?: boolean;
}

export interface DetailRequest { url: string; form?: Record<string, string> }

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
