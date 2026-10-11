// Una ciudad cualquiera, a partir de lo que cada portal dice de si mismo. Cada
// fuente sabe como la llama su portal (su `discover`); aqui solo se juntan
// las zonas que encuentran, se situan en el mapa y se guarda todo como una
// City, igual que barcelona.json.
import type { City } from '../coverage';
import type { CityCandidate } from '../geocode';
import type { FetchPage } from '../model';
import { makeNet, type FetchDirect } from '../net';
import { NetError, type Area, type Coverage, type DiscoverCtx, type Source } from '../sources/base';
import { SOURCES } from '../sources';
import { norm, province as provinceOf, slug, variants } from './names';

export interface DiscoverDeps {
  fetchPage: FetchPage;
  fetchDirect: FetchDirect;
  geocode(query: string): Promise<[number, number] | null>;
  log(message: string): void;
  signal?: AbortSignal;
}
export interface PortalNote { portal: string; found: boolean; detail: string }
export interface Discovered { city: City; notes: PortalNote[] }

/** Pueblos de alrededor: a esta distancia del centro como mucho. */
export const RADIUS_KM = 15;

export class DiscoveryError extends Error {}

/** Clave de la ciudad en el perfil y en los anuncios: 'granada-granada'. */
export const cityKey = (c: Pick<CityCandidate, 'name' | 'province'>) =>
  `${slug(variants(c.name)[0] ?? c.name)}-${slug(provinceOf(c.province).name)}`;

function km(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Lo que cada fuente necesita para preguntar a su portal. Sin pausas: se
 * prueban nombres, no se pagina. Sin pestaña salvo que la fuente la pida:
 * un 404 abriria una por cada nombre probado. */
function contextFor(src: Source, c: CityCandidate, facts: Record<string, unknown>, retry: boolean,
  deps: DiscoverDeps): DiscoverCtx {
  const net = makeNet(src, { fetchPage: deps.fetchPage, fetchDirect: deps.fetchDirect, sleep: async () => {},
    random: () => 0, signal: deps.signal }, { pause: false, timeoutMs: 120_000, tabs: false, checks: false });
  const orNull = async <T>(get: () => Promise<T>): Promise<T | null> => {
    if (deps.signal?.aborted) throw new DiscoveryError('Stopped');
    try {
      return await get();
    } catch (e) {
      if (e instanceof NetError && e.reason === 'cancelled') throw new DiscoveryError('Stopped');
      return null;
    }
  };
  return {
    city: c,
    province: provinceOf(c.province),
    // El nombre entero ('donostia-san-sebastian') y cada variante ('donostia').
    slugs: [...new Set([slug(c.name), ...variants(c.name).map((v) => v.replace(/ /g, '-'))])],
    facts,
    retry,
    page: (url, opts) => orNull(async () => {
      const r = await net.page({ url, tab: !!opts?.tab });
      return { html: r.body, finalUrl: r.finalUrl };
    }),
    json: (req) => orNull(() => net.json(req)),
    log: deps.log,
  };
}

/** Pregunta a cada fuente, en el orden del registro; las que lo piden, otra
 * vez al final con lo que dejaron las demas. */
async function askSources(sources: Source[], c: CityCandidate, deps: DiscoverDeps): Promise<Map<string, Coverage>> {
  const facts: Record<string, unknown> = {};
  const found = new Map<string, Coverage>();
  for (const retry of [false, true]) {
    for (const src of sources) {
      if (found.has(src.name) || (retry && !src.retryDiscover)) continue;
      const cov = await src.discover!(contextFor(src, c, facts, retry, deps));
      if (cov) found.set(src.name, cov);
    }
  }
  return found;
}

export async function discoverCity(c: CityCandidate, deps: DiscoverDeps): Promise<Discovered> {
  const prov = provinceOf(c.province);
  deps.log(`Looking for ${c.name} (${prov.name}) on each portal...`);
  const sources = Object.values(SOURCES).filter((s) => s.discover);
  const found = await askSources(sources, c, deps);
  const portals = Object.fromEntries(sources.map((s) => [s.name, found.get(s.name)?.ref ?? null]));
  if (!found.size) {
    throw new DiscoveryError(`No portal has listings for ${c.name}. Check the name, or try the nearest bigger town.`);
  }

  // --- Zonas: distritos de la ciudad y pueblos de alrededor -----------------
  type Draft = { label: string; town: boolean; count: number; portals: Record<string, string | null> };
  const drafts = new Map<string, Draft>();
  for (const [name, cov] of found) {
    for (const z of cov.zones ?? []) {
      const k = norm(z.label);
      const d = drafts.get(k) ?? { label: z.label, town: z.town, count: 0, portals: {} };
      d.portals[name] ??= z.ref;
      d.count = Math.max(d.count, z.count);
      drafts.set(k, d);
    }
  }
  for (const d of drafts.values()) {
    for (const src of sources) if (src.fillZone && !d.portals[src.name]) d.portals[src.name] = src.fillZone(d);
  }
  // Las fuentes que buscan por zonas; las demas buscan siempre en la ciudad entera.
  const zoned = sources.filter((s) => found.get(s.name)?.zones || s.fillZone).map((s) => s.name);

  deps.log(`Placing ${drafts.size} areas on the map...`);
  const center: [number, number] = [c.lat, c.lon];
  const areas: Area[] = [];
  let towns = 0;
  for (const d of drafts.values()) {
    if (deps.signal?.aborted) throw new DiscoveryError('Stopped');
    const at = await deps.geocode(d.town ? `${d.label}, ${prov.name}, España` : `${d.label}, ${c.name}, España`);
    if (!at || km(center, at) > (d.town ? RADIUS_KM : RADIUS_KM * 2)) continue;
    // Un distrito que un portal no nombra igual se busca en toda la ciudad.
    areas.push({ name: d.town ? d.label : `${d.label}, ${c.name}`, lat: at[0], lon: at[1],
      portals: Object.fromEntries(zoned.map((n) => [n, d.portals[n] ?? (d.town ? null : portals[n])])) });
    if (d.town) towns++;
  }
  // Sin distritos (o sin situarlos), la ciudad entera es una zona.
  if (areas.length === towns) areas.unshift({ name: c.name, lat: c.lat, lon: c.lon, portals: { ...portals } });

  const lats = [...areas.map((a) => a.lat), c.box[1], c.box[3]], lons = [...areas.map((a) => a.lon), c.box[0], c.box[2]];
  const m = 0.03;
  const notes: PortalNote[] = sources.map((s) => {
    const cov = found.get(s.name);
    return { portal: s.name, found: !!cov, detail: cov ? cov.note ?? 'has this city' : 'not found' };
  });
  for (const n of notes) deps.log(`${n.portal}: ${n.detail}`);
  deps.log(`${areas.length} areas ready: ${areas.length - towns} in ${c.name} and ${towns} towns around it`);
  return {
    city: { city: cityKey(c), name: c.name, province: prov.name, center, catalanStreets: prov.catalan, portals, areas,
      box: [Math.min(...lons) - m, Math.max(...lats) + m, Math.max(...lons) + m, Math.min(...lats) - m] },
    notes,
  };
}

/** Una ciudad guardada antes de que existiera un portal no lo tiene: se le
 * pregunta solo a ese, sin tocar las zonas. Devuelve la ciudad completada. */
export async function discoverMissing(city: City, deps: DiscoverDeps): Promise<City> {
  const missing = Object.values(SOURCES).filter((s) => s.discover && !(s.name in city.portals));
  if (!missing.length) return city;
  const c: CityCandidate = { name: city.name, province: city.province, lat: city.center[0], lon: city.center[1], box: city.box };
  const found = await askSources(missing, c, deps);
  const portals = { ...city.portals };
  for (const s of missing) {
    portals[s.name] = found.get(s.name)?.ref ?? null;
    deps.log(`${s.name}: ${found.has(s.name) ? 'has this city' : 'not found'}`);
  }
  return { ...city, portals };
}
