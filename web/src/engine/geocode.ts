// Direccion -> coordenadas con Nominatim (OpenStreetMap) y cache.
// Idealista no trae coordenadas en sus listados. Nominatim pide como maximo
// una peticion por segundo, asi que la cache es lo que hace viable buscar
// muchas veces. Nominatim no permite autocompletar: `search` se llama al
// pulsar, no letra a letra.
import { provinceOfAddress, sameName } from './cities/names';
import type { RawListing } from './model';

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const PAUSE_MS = 1100;

/** `exact`: Nominatim dio el portal (con numero), no solo la calle. */
export interface GeoValue { lat: number | null; lon: number | null; exact?: boolean }
export interface GeoCache {
  get(query: string): Promise<GeoValue | undefined>;
  put(query: string, value: GeoValue): Promise<void>;
}
export interface Place { name: string; lat: number; lon: number }
export interface CityCandidate { name: string; province: string; lat: number; lon: number; box: [number, number, number, number] }

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any

export class Geocoder {
  private last = -Infinity;
  /** Lo pone la busqueda segun la ciudad: en Cataluña, "Calle" se busca como "Carrer". */
  catalanStreets = true;
  /** La caja de la ciudad: las calles se buscan dentro, no en toda la provincia. */
  private box: [number, number, number, number] | null = null;
  constructor(private cache: GeoCache, private getJson: (url: string) => Promise<unknown> = defaultGet,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private clock: () => number = () => Date.now(), private offline = false) {}

  private async ask(params: Record<string, string>): Promise<Json[]> {
    const wait = PAUSE_MS - (this.clock() - this.last);
    if (wait > 0) await this.sleep(wait);
    try {
      const data = await this.getJson(`${NOMINATIM}?${new URLSearchParams({ format: 'json', countrycodes: 'es', ...params })}`);
      return Array.isArray(data) ? data : [];
    } finally {
      this.last = this.clock();
    }
  }

  async geocode(query: string): Promise<[number, number] | null> {
    const hit = await this.cache.get(query);
    if (hit) return hit.lat === null ? null : [hit.lat, hit.lon!];
    if (this.offline) return null;
    let found: Json | undefined;
    try {
      found = (await this.ask({ q: query, limit: '1' }))[0];
    } catch {
      return null;   // un fallo de red no se guarda: se reintenta la proxima vez
    }
    const value = found ? { lat: parseFloat(found.lat), lon: parseFloat(found.lon) } : { lat: null, lon: null };
    await this.cache.put(query, value);
    return value.lat === null ? null : [value.lat, value.lon!];
  }

  /** De lo concreto a lo general. La posicion solo es exacta si se acierta
   * la calle: el ranking necesita saber si el trayecto es fiable. */
  async place(l: RawListing): Promise<void> {
    if (!(await this.pinpoint(l))) await this.placeRoughly(l);
  }

  useCity(c: { box: [number, number, number, number]; catalanStreets: boolean }) {
    this.box = c.box;
    this.catalanStreets = c.catalanStreets;
  }

  /** La calle exacta, si Nominatim la encuentra en ese municipio. Exacta solo
   * con numero de portal; la calle sola es mejor que el barrio, pero sigue
   * siendo aproximada. Un resultado de otro municipio (la calle Menorca de
   * Alcala para un piso de Madrid) se descarta: un trayecto aproximado es
   * mejor que uno exacto y falso. */
  async pinpoint(l: RawListing): Promise<boolean> {
    if (!l.address || !l.municipality) return false;
    const street = streetName(cleanAddress(l.address), this.catalanStreets);
    const bare = street.replace(/,?\s*\d+\w?\s*$/, '');
    // Dentro de la caja Nominatim ya casa "Calle Menorca" con "Calle de Menorca";
    // sin caja hace falta la variante. Cada intento es un segundo de espera.
    const variants = (x: string) => (this.box ? [x] : [...new Set([x, withDe(x)])]);
    const tries = [...variants(street), ...(bare !== street ? variants(bare) : [])];
    for (const q of tries) {
      const hit = await this.street(`${q}, ${l.municipality}`, l.municipality);
      if (!hit) continue;
      [l.lat, l.lon] = [hit.lat, hit.lon];
      l.approximateLocation = !hit.exact;
      return hit.exact;
    }
    return false;
  }

  /** Busca en la caja de la ciudad y se queda con el primer resultado del municipio. */
  private async street(query: string, town: string): Promise<{ lat: number; lon: number; exact: boolean } | null> {
    const key = `street|${this.box?.join(',') ?? ''}|${query}`;
    const hit = await this.cache.get(key);
    if (hit) return hit.lat === null ? null : { lat: hit.lat, lon: hit.lon!, exact: !!hit.exact };
    if (this.offline) return null;
    let data: Json[];
    try {
      data = await this.ask({ q: query, limit: '5', addressdetails: '1',
        ...(this.box ? { viewbox: this.box.join(','), bounded: '1' } : {}) });
    } catch {
      return null;
    }
    const found = data.find((d) => sameName(townOf(d.address ?? {}), town));
    const value: GeoValue = found
      ? { lat: parseFloat(found.lat), lon: parseFloat(found.lon), exact: !!found.address?.house_number }
      : { lat: null, lon: null };
    await this.cache.put(key, value);
    return value.lat === null ? null : { lat: value.lat, lon: value.lon!, exact: !!value.exact };
  }

  /** El barrio, o el municipio. Hay pocos distintos y la cache los recuerda:
   * sirve para todos los anuncios sin apenas peticiones. */
  async placeRoughly(l: RawListing): Promise<void> {
    const tries: string[] = [];
    if (l.neighbourhood && l.municipality) tries.push(`${l.neighbourhood}, ${l.municipality}, España`);
    if (l.municipality) tries.push(`${l.municipality}, España`);
    for (const q of tries) {
      const r = await this.geocode(q);
      if (r) { [l.lat, l.lon] = r; l.approximateLocation = true; return; }
    }
  }

  /** Varios resultados para elegir un sitio, dentro de la caja de la ciudad. */
  async search(query: string, box: [number, number, number, number] | null, limit = 5): Promise<Place[]> {
    const data = await this.ask({ q: query, limit: String(limit), ...(box ? { viewbox: box.join(','), bounded: '1' } : {}) });
    return data.map((d) => ({ name: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon) }));
  }

  /** Ciudades, pueblos y municipios que se llaman asi, con su provincia. */
  async cities(query: string): Promise<CityCandidate[]> {
    const data = await this.ask({ q: query, limit: '8', addressdetails: '1', featureType: 'settlement' });
    const out: CityCandidate[] = [];
    for (const d of data) {
      const a: Json = d.address ?? {};
      const name = a.city ?? a.town ?? a.village ?? a.municipality ?? d.name;
      const province = provinceOfAddress(a);
      const [s, n, w, e] = (d.boundingbox ?? []).map(Number);
      if (!name || !province || out.some((c) => c.name === name && c.province === province)) continue;
      out.push({ name, province, lat: parseFloat(d.lat), lon: parseFloat(d.lon),
        box: [w, n, e, s].every(Number.isFinite) ? [w, n, e, s] : [0, 0, 0, 0] });
    }
    return out;
  }
}

const townOf = (a: Json): string => a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? '';

// Abreviaturas de los portales y de quien escribe el anuncio.
const ABBREV: [RegExp, string][] = [
  [/^(?:c\/|c\.|cl\.?|cll\.?)\s*/i, 'Calle '], [/^(?:avda\.?|avd\.?|av\.)\s*/i, 'Avenida '],
  [/^(?:p\.?\s?[º°]|pso\.?)\s*/i, 'Paseo '], [/^(?:pza\.?|plza\.?|pl\.)\s*/i, 'Plaza '],
  [/^ctra\.?\s*/i, 'Carretera '], [/^rda\.?\s*/i, 'Ronda '], [/^trav\.?\s*/i, 'Travesía '],
  [/^cno\.?\s*/i, 'Camino '], [/^gta\.?\s*/i, 'Glorieta '], [/^urb\.?\s*/i, 'Urbanización '],
];

/** La direccion como la entiende el mapa: sin abreviaturas, sin "nº" ni
 * "s/n", y sin piso, puerta ni escalera detras del numero. */
export function cleanAddress(address: string): string {
  let s = address.trim().replace(/\s+/g, ' ');
  for (const [re, to] of ABBREV) if (re.test(s)) { s = s.replace(re, to); break; }
  s = s.replace(/\b(?:n\.?\s?[º°]|num\.?|núm\.?|número)\s*(\d)/gi, '$1');
  s = s.replace(/,?\s*\bs\/n\b/gi, '');
  s = s.replace(/(\d+[a-z]?)\s*,?\s*(?:\d+\s*[º°ª]|bajos?|bj|[áa]tico|entresuelo|entlo|pral|principal|esc(?:alera)?|puerta|pta|piso|planta|local)\b.*$/i, '$1');
  s = s.replace(/(\d+[a-z]?)\s*,?\s*\d+\s*[º°ª].*$/i, '$1');
  return s.replace(/[\s,]+$/, '');
}

/** "Calle Menorca" en OpenStreetMap es "Calle de Menorca": la variante con "de". */
function withDe(street: string): string {
  return street.replace(/^(Calle|Avenida|Plaza|Paseo|Camino|Ronda|Carretera|Travesía|Carrer|Avinguda|Plaça|Passeig|Camí)\s+(?!(?:de|del|dels|d'|la|el|les|los|las)\b)/i, '$1 de ');
}

/** Idealista quita el tipo de via: "de Pons i Gallarza, 3" es "Carrer de
 * Pons i Gallarza, 3". Sin el, Nominatim casi nunca la encuentra. */
export function streetName(address: string, catalan = true): string {
  if (!catalan) return /^(de|del|de la|de los|de las)\s/i.test(address) ? `Calle ${address}` : address;
  if (/^(de|del|dels|de la|de les)\s/i.test(address) || /^d'/i.test(address)) return `Carrer ${address}`;
  // OpenStreetMap nombra las calles de Barcelona en catalan; Idealista, en castellano.
  return address.replace(/^(\p{L}+)(?=\s)/u, (w) => CATALAN_STREET[w.toLowerCase()] ?? w);
}
const CATALAN_STREET: Record<string, string> = {
  calle: 'Carrer', avenida: 'Avinguda', plaza: 'Plaça', paseo: 'Passeig', pasaje: 'Passatge', travesía: 'Travessera',
  travesia: 'Travessera', camino: 'Camí', bajada: 'Baixada', subida: 'Pujada', vía: 'Via', callejón: 'Carreró',
};

async function defaultGet(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
