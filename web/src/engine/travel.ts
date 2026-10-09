// Tiempos de trayecto desde el navegador. Transitous (MOTIS) por defecto, sin
// clave; Google Routes con la clave de cada persona; o un MOTIS propio. Si el
// proveedor no responde, una estimacion en linea recta, marcada como tal.
import type { Destination } from './profiles';

export interface Trip { minutes: number; detail: string; source: string }
export type Origin = [number, number];

export class TravelError extends Error {}

export interface Http {
  getJson(url: string): Promise<unknown>;
  postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown>;
}

export const browserHttp: Http = {
  async getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new TravelError(`HTTP ${r.status}`);
    return r.json();
  },
  async postJson(url, headers, body) {
    const r = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    if (!r.ok) throw new TravelError(`HTTP ${r.status}`);
    return r.json();
  },
};

export interface TravelProvider {
  name: string;
  trips(origins: Origin[], dest: Destination): Promise<(Trip | null)[]>;
}

const WALK_M_MIN = 75;        // 4,5 km/h
const DETOUR = 1.3;           // la calle no va en linea recta
const BIKE_M_MIN = 250;       // 15 km/h
const BIKE_EXTRA_MIN = 2;     // coger y dejar la bici
const TRANSIT_M_MIN = 330;    // ~20 km/h de media puerta a puerta
const TRANSIT_EXTRA_MIN = 8;  // andar a la parada y esperar
const STOP_RADIUS_M = 1200;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, rad = Math.PI / 180;
  const dp = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const walkMinutes = (m: number) => (m * DETOUR) / WALK_M_MIN;

/** Respaldo sin red: linea recta corregida por el rodeo de las calles. */
export function estimateTrip(lat: number, lon: number, d: Destination): Trip {
  const m = haversineM(lat, lon, d.lat, d.lon);
  if (d.mode === 'walk') return { minutes: walkMinutes(m), detail: 'walk', source: 'estimate' };
  if (d.mode === 'bike') return { minutes: (m * DETOUR) / BIKE_M_MIN + BIKE_EXTRA_MIN, detail: 'bike', source: 'estimate' };
  const transit = TRANSIT_EXTRA_MIN + (m * DETOUR) / TRANSIT_M_MIN;
  return { minutes: Math.min(walkMinutes(m), transit), detail: 'estimate', source: 'estimate' };
}

/** Desfase de Madrid respecto a UTC en ese instante, en minutos. */
function madridOffset(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Proximo dia laborable, a partir de mañana, a esa hora de Madrid. Los
 * horarios reales cambian con el dia: un martes a las 8:30 no es un domingo. */
export function nextDeparture(hhmm: string, now: Date): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const local = new Date(now.getTime() + madridOffset(now) * 60000);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1));
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m);
  return new Date(guess - madridOffset(new Date(guess)) * 60000);
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export const TRANSITOUS_URL = 'https://api.transitous.org';

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any

/** Transitous o cualquier MOTIS. Desde el navegador no se puede fijar el
 * User-Agent: Transitous acepta el Referer y el contacto en la web. */
export class TransitousProvider implements TravelProvider {
  name = 'transitous';
  constructor(private base = TRANSITOUS_URL, private http: Http = browserHttp,
    private now: () => Date = () => new Date()) {
    this.base = base.replace(/\/+$/, '');
  }

  async trips(origins: Origin[], d: Destination): Promise<(Trip | null)[]> {
    return d.mode === 'transit' ? this.allToOne(origins, d) : this.direct(origins, d);
  }

  /** Una sola consulta para todos los origenes: desde cada parada, cuanto
   * antes hay que salir para llegar al destino a la hora fijada. */
  private async allToOne(origins: Origin[], d: Destination) {
    const q = new URLSearchParams({ one: `${d.lat},${d.lon}`, time: iso(nextDeparture(d.depart_at, this.now())),
      arriveBy: 'true', maxTravelTime: '90' });
    let stops: Json[];
    try {
      stops = ((await this.http.getJson(`${this.base}/api/v1/one-to-all?${q}`)) as Json).all;
      if (!Array.isArray(stops)) throw new Error('no "all" in the answer');
    } catch (e) {
      throw new TravelError(`Transitous did not answer: ${(e as Error).message}`);
    }
    const cells = new Map<string, [number, number, number, string][]>();
    const cell = (lat: number, lon: number) => `${Math.trunc(lat * 100)},${Math.trunc(lon * 100)}`;
    for (const x of stops) {
      const p = x.place;
      const k = cell(p.lat, p.lon);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k)!.push([p.lat, p.lon, Number(x.duration), p.name ?? '']);
    }
    return origins.map(([lat, lon]) => {
      let best: [number, string] | null = null;
      const ci = Math.trunc(lat * 100), cj = Math.trunc(lon * 100);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        for (const [plat, plon, mins, name] of cells.get(`${ci + di},${cj + dj}`) ?? []) {
          const m = haversineM(lat, lon, plat, plon);
          if (m <= STOP_RADIUS_M) {
            const total = mins + walkMinutes(m);
            if (!best || total < best[0]) best = [total, name];
          }
        }
      }
      return best ? { minutes: best[0], detail: `via ${best[1]}`, source: this.name } : null;
    });
  }

  private async direct(origins: Origin[], d: Destination) {
    const out: (Trip | null)[] = [];
    let failures = 0;
    let last: unknown;
    for (const [lat, lon] of origins) {
      const q = new URLSearchParams({ fromPlace: `${lat},${lon}`, toPlace: `${d.lat},${d.lon}`,
        time: iso(nextDeparture(d.depart_at, this.now())),
        directModes: d.mode === 'walk' ? 'WALK' : 'BIKE', maxDirectTime: '7200' });
      try {
        const data = (await this.http.getJson(`${this.base}/api/v4/plan?${q}`)) as Json;
        const first = (data.direct ?? [])[0];
        out.push(first ? { minutes: first.duration / 60, detail: d.mode, source: this.name } : null);
      } catch (e) {
        failures++;
        last = e;
        out.push(null);
      }
    }
    if (origins.length && failures === origins.length) {
      throw new TravelError(`Transitous did not answer: ${(last as Error)?.message}`);
    }
    return out;
  }
}

export const GOOGLE_MATRIX = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const GOOGLE_MODE = { transit: 'TRANSIT', walk: 'WALK', bike: 'BICYCLE' } as const;
const GOOGLE_BATCH = 100;

/** Routes API de Google con la clave de la persona. Cobra por elemento. */
export class GoogleProvider implements TravelProvider {
  name = 'google';
  constructor(private key: string, private http: Http = browserHttp, private now: () => Date = () => new Date()) {}

  async trips(origins: Origin[], d: Destination): Promise<(Trip | null)[]> {
    const mode = GOOGLE_MODE[d.mode];
    const headers = { 'X-Goog-Api-Key': this.key,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition' };
    const out: (Trip | null)[] = origins.map(() => null);
    for (let start = 0; start < origins.length; start += GOOGLE_BATCH) {
      const batch = origins.slice(start, start + GOOGLE_BATCH);
      const body: Json = {
        origins: batch.map(([latitude, longitude]) => ({ waypoint: { location: { latLng: { latitude, longitude } } } })),
        destinations: [{ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lon } } } }],
        travelMode: mode,
      };
      if (mode === 'TRANSIT') body.arrivalTime = iso(nextDeparture(d.depart_at, this.now()));
      let elements: Json[];
      try {
        elements = (await this.http.postJson(GOOGLE_MATRIX, headers, body)) as Json[];
      } catch (e) {
        // Sin la clave en el mensaje: los errores se ven en pantalla.
        throw new TravelError(`Google Routes did not answer (${(e as Error).message.replace(this.key, '***')})`);
      }
      for (const el of elements) {
        if (el.condition === 'ROUTE_EXISTS' && el.duration) {
          out[start + el.originIndex] = { minutes: parseFloat(el.duration) / 60, detail: 'Google', source: this.name };
        }
      }
    }
    return out;
  }
}

export interface CachedTrip { minutes: number; detail: string; at: string }
export interface TravelCache {
  get(key: string): Promise<CachedTrip | undefined>;
  put(key: string, value: CachedTrip): Promise<void>;
}

/** Redondeo a 1/2000 de grado: unos 55 m de latitud y 40 de longitud. */
const roundCell = (x: number) => Math.round(x * 2000) / 2000;

/** Respuestas guardadas una semana: buscar dos veces no repite peticiones. */
export class CachedProvider implements TravelProvider {
  name: string;
  constructor(private inner: TravelProvider, private cache: TravelCache, private ttlDays = 7,
    private now: () => Date = () => new Date()) {
    this.name = inner.name;
  }

  private key(lat: number, lon: number, d: Destination) {
    return [this.name, d.mode, d.depart_at, roundCell(lat), roundCell(lon), roundCell(d.lat), roundCell(d.lon)].join('|');
  }

  async trips(origins: Origin[], d: Destination): Promise<(Trip | null)[]> {
    const limit = this.now().getTime() - this.ttlDays * 86_400_000;
    const out: (Trip | null)[] = [];
    const missing: number[] = [];
    for (const [i, [lat, lon]] of origins.entries()) {
      const hit = await this.cache.get(this.key(lat, lon, d));
      if (hit && Date.parse(hit.at) >= limit) out.push({ minutes: hit.minutes, detail: hit.detail, source: this.name });
      else { out.push(null); missing.push(i); }
    }
    if (missing.length) {
      const fresh = await this.inner.trips(missing.map((i) => origins[i]), d);
      for (const [j, i] of missing.entries()) {
        const t = fresh[j];
        out[i] = t;
        if (t) await this.cache.put(this.key(...origins[i], d), { minutes: t.minutes, detail: t.detail, at: this.now().toISOString() });
      }
    }
    return out;
  }
}
