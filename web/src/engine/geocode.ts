// Direccion -> coordenadas con Nominatim (OpenStreetMap) y cache.
// Idealista no trae coordenadas en sus listados. Nominatim pide como maximo
// una peticion por segundo, asi que la cache es lo que hace viable buscar
// muchas veces. Nominatim no permite autocompletar: `search` se llama al
// pulsar, no letra a letra.
import type { RawListing } from './model';

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const PAUSE_MS = 1100;
/** [oeste, norte, este, sur] del area de Barcelona. */
export const BARCELONA_BOX: [number, number, number, number] = [1.90, 41.60, 2.35, 41.25];

export interface GeoCache {
  get(query: string): Promise<{ lat: number | null; lon: number | null } | undefined>;
  put(query: string, value: { lat: number | null; lon: number | null }): Promise<void>;
}
export interface Place { name: string; lat: number; lon: number }

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any

export class Geocoder {
  private last = -Infinity;
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
    const tries: [string, boolean][] = [];
    if (l.address && l.municipality) tries.push([`${l.address}, ${l.municipality}, España`, false]);
    if (l.neighbourhood && l.municipality) tries.push([`${l.neighbourhood}, ${l.municipality}, España`, true]);
    if (l.municipality) tries.push([`${l.municipality}, España`, true]);
    for (const [q, approximate] of tries) {
      const r = await this.geocode(q);
      if (r) { [l.lat, l.lon] = r; l.approximateLocation = approximate; return; }
    }
  }

  /** Varios resultados para elegir un sitio, dentro de la caja de la ciudad. */
  async search(query: string, box = BARCELONA_BOX, limit = 5): Promise<Place[]> {
    const data = await this.ask({ q: query, limit: String(limit), viewbox: box.join(','), bounded: '1' });
    return data.map((d) => ({ name: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon) }));
  }
}

async function defaultGet(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
