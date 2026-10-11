// Una ciudad cualquiera, a partir de lo que cada portal dice de si mismo.
// Primero se prueba el nombre que dicta la regla de cada portal; si la pagina
// no es ese municipio, se baja por su arbol de zonas desde la provincia. Lo
// que se aprende (identificadores, distritos, pueblos de alrededor) se guarda
// como una City, igual que barcelona.json.
import type { City, CityPortals } from '../coverage';
import type { CityCandidate } from '../geocode';
import type { FetchPage } from '../model';
import type { Area } from '../sources/base';
import { buildUrl as dppUrl, parseList as dppList } from '../sources/depisoenpiso';
import { SOURCES } from '../sources';
import { norm, province as provinceOf, sameName, slug, variants, withoutArticle } from './names';
import { fotocasaPage, habitacliaPage, idealistaDistricts, idealistaPage, roomgoHasCity, type FotocasaPage,
  type HabitacliaPage, type IdealistaPage } from './portals';

export interface DiscoverDeps {
  fetchPage: FetchPage;
  fetchDirect(url: string): Promise<string>;
  geocode(query: string): Promise<[number, number] | null>;
  log(message: string): void;
  signal?: AbortSignal;
}
export interface PortalNote { portal: string; found: boolean; detail: string }
export interface Discovered { city: City; notes: PortalNote[] }

/** Pueblos de alrededor: como mucho tantos, y a esta distancia del centro. */
export const RADIUS_KM = 15;
const NEIGHBOURS = 12;
/** Comarcas que se miran al buscar el municipio desde la provincia. */
const COMARCAS = 8;

export class DiscoveryError extends Error {}

/** Clave de la ciudad en el perfil y en los anuncios: 'granada-granada'. */
export const cityKey = (c: Pick<CityCandidate, 'name' | 'province'>) =>
  `${slug(variants(c.name)[0] ?? c.name)}-${slug(provinceOf(c.province).name)}`;

const uniq = <T>(xs: T[]) => [...new Set(xs)];

function km(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export async function discoverCity(c: CityCandidate, deps: DiscoverDeps): Promise<Discovered> {
  const prov = provinceOf(c.province);
  // El nombre entero ('donostia-san-sebastian') y cada variante ('donostia').
  const slugs = uniq([slug(c.name), ...variants(c.name).map((v) => v.replace(/ /g, '-'))]);
  const provSlugs = uniq([prov.name, ...prov.aliases, prov.idealista].map((p) => `${slug(p)}-provincia`));
  const notes: PortalNote[] = [];
  const note = (portal: string, found: boolean, detail: string) => {
    notes.push({ portal, found, detail });
    deps.log(`${portal}: ${detail}`);
  };

  /** La pagina, o null si no existe o no se pudo leer. Sin pestaña salvo
   * Idealista: un 404 abriria una pestaña por cada nombre probado. */
  async function get(portal: string, url: string): Promise<{ html: string; finalUrl: string } | null> {
    if (deps.signal?.aborted) throw new DiscoveryError('Stopped');
    const src = SOURCES[portal];
    const r = await deps.fetchPage({ url, portal, blockedMarkers: src.blockedMarkers, fatalMarkers: src.fatalMarkers,
      allowTab: portal === 'idealista', timeoutMs: 120_000 });
    if (!r.ok && r.reason === 'cancelled') throw new DiscoveryError('Stopped');
    return r.ok ? { html: r.html, finalUrl: r.finalUrl } : null;
  }

  // --- Fotocasa: 'granada-capital' o 'armilla' ---------------------------
  deps.log(`Looking for ${c.name} (${prov.name}) on each portal...`);
  const fotoUrl = (s: string) => `https://www.fotocasa.es/es/alquiler/viviendas/${s}/todas-las-zonas/l`;
  async function fotocasaAt(muni: string): Promise<{ slug: string; page: FotocasaPage } | null> {
    const r = await get('fotocasa', fotoUrl(muni));
    const page = r && fotocasaPage(r.html);
    return page && page.level === 'MUNICIPALITY' && sameName(page.name, c.name) ? { slug: muni, page } : null;
  }
  let foto: { slug: string; page: FotocasaPage } | null = null;
  for (const s of slugs) {
    for (const g of [`${s}-capital`, s]) if (!foto) foto = await fotocasaAt(g);
  }

  // --- Habitaclia: los mismos trozos, con la provincia delante -----------
  const habUrl = (path: string) => `https://www.habitaclia.com/alquiler/viviendas/${path}/s`;
  const isTheCity = (p: HabitacliaPage | null) => !!p && p.layer === 'municipality'
    && (foto ? p.code === foto.page.ine : sameName(p.name, c.name));
  let hab: { path: string; page: HabitacliaPage } | null = null;
  const muniGuesses = foto ? [foto.slug] : slugs.flatMap((s) => [`${s}-capital`, s]);
  for (const p of provSlugs) {
    for (const m of muniGuesses) {
      if (hab) break;
      const r = await get('habitaclia', habUrl(`${p}/${m}`));
      const page = r && habitacliaPage(r.html);
      if (page && isTheCity(page)) hab = { path: page.path || `${p}/${m}`, page };
    }
  }
  // Por el arbol: provincia -> comarcas -> municipios.
  for (const p of hab ? [] : provSlugs) {
    const r = await get('habitaclia', habUrl(p));
    const top = r && habitacliaPage(r.html);
    if (!top || top.layer !== 'province') continue;
    for (const comarca of [...top.sons].sort((a, b) => b.count - a.count).slice(0, COMARCAS)) {
      if (hab) break;
      const rc = await get('habitaclia', habUrl(comarca.path));
      const son = rc && habitacliaPage(rc.html)?.sons.find((z) => sameName(z.name, c.name));
      if (!son) continue;
      const rm = await get('habitaclia', habUrl(son.path));
      const page = rm && habitacliaPage(rm.html);
      if (page && isTheCity(page)) hab = { path: page.path || son.path, page };
    }
    if (hab) break;
  }
  if (!foto && hab) foto = await fotocasaAt(hab.path.split('/').at(-1)!);

  // --- Idealista: 'granada-granada', 'hospitalet-de-llobregat-barcelona' ---
  let idl: { slug: string; page: IdealistaPage } | null = null;
  for (const g of uniq(slugs.flatMap((s) => [`${s}-${prov.idealista}`, `${withoutArticle(s)}-${prov.idealista}`])).slice(0, 3)) {
    const r = await get('idealista', `https://www.idealista.com/alquiler-viviendas/${g}/`);
    const page = r && idealistaPage(r.html);
    if (page && sameName(page.current, c.name)) { idl = { slug: g, page }; break; }
  }

  // --- Roomgo y De Piso en Piso: una lista por ciudad ---------------------
  let roomgo: string | null = null;
  for (const g of uniq(slugs.flatMap((s) => [`${prov.roomgo}/piso-compartido-${s}`, `${s}/piso-compartido-${s}`]))) {
    const r = await get('roomgo', `https://www.roomgo.es/${g}`);
    if (r && roomgoHasCity(r.finalUrl)) { roomgo = g; break; }
  }
  let dpp: string | null = null;
  try {
    if (dppList(await deps.fetchDirect(dppUrl(c.name))).length) dpp = c.name;
  } catch { /* sin red o sin la ciudad: no se usa */ }

  const portals: CityPortals = {
    idealista: idl?.slug ?? null,
    fotocasa: foto ? `${foto.slug}/todas-las-zonas` : null,
    habitaclia: hab?.path ?? null,
    roomgo,
    depisoenpiso: dpp,
  };
  if (!Object.values(portals).some(Boolean)) {
    throw new DiscoveryError(`No portal has listings for ${c.name}. Check the name, or try the nearest bigger town.`);
  }

  // --- Zonas: distritos de la ciudad y pueblos de alrededor -----------------
  type Draft = Omit<Area, 'lat' | 'lon'> & { label: string; town: boolean; count: number };
  const drafts = new Map<string, Draft>();
  const add = (label: string, town: boolean, portal: 'idealista' | 'fotocasa' | 'habitaclia', path: string, count: number) => {
    const k = norm(label);
    const d = drafts.get(k) ?? { label, town, name: town ? label : `${label}, ${c.name}`, idealista: null, fotocasa: null,
      habitaclia: null, count: 0 };
    d[portal] ??= path;
    d.count = Math.max(d.count, count);
    drafts.set(k, d);
  };
  for (const z of foto?.page.districts ?? []) add(z.name, false, 'fotocasa', z.path, z.count);
  const depth = (hab?.path.split('/').length ?? 0) + 1;
  for (const z of hab?.page.sons ?? []) if (z.path.split('/').length === depth) add(z.name, false, 'habitaclia', z.path, z.count);
  for (const z of idl ? idealistaDistricts(idl.page.links, idl.slug) : []) add(z.name, false, 'idealista', z.path, z.count);
  for (const z of [...(hab?.page.same ?? [])].sort((a, b) => b.count - a.count).slice(0, NEIGHBOURS)) {
    if (sameName(z.name, c.name)) continue;
    add(z.name, true, 'habitaclia', z.path, z.count);
    // Fotocasa y Habitaclia comparten el trozo del municipio.
    add(z.name, true, 'fotocasa', `${z.path.split('/').at(-1)}/todas-las-zonas`, z.count);
  }

  deps.log(`Placing ${drafts.size} areas on the map...`);
  const center: [number, number] = [c.lat, c.lon];
  const areas: Area[] = [];
  let towns = 0;
  for (const d of drafts.values()) {
    if (deps.signal?.aborted) throw new DiscoveryError('Stopped');
    const at = await deps.geocode(d.town ? `${d.label}, ${prov.name}, España` : `${d.label}, ${c.name}, España`);
    if (!at || km(center, at) > (d.town ? RADIUS_KM : RADIUS_KM * 2)) continue;
    // Un distrito que un portal no nombra igual se busca en toda la ciudad.
    areas.push({ name: d.name, lat: at[0], lon: at[1],
      idealista: d.idealista ?? (d.town ? null : portals.idealista),
      fotocasa: d.fotocasa ?? (d.town ? null : portals.fotocasa),
      habitaclia: d.habitaclia ?? (d.town ? null : portals.habitaclia) });
    if (d.town) towns++;
  }
  // Sin distritos (o sin situarlos), la ciudad entera es una zona.
  if (areas.length === towns) areas.unshift({ name: c.name, lat: c.lat, lon: c.lon, ...portals });

  const lats = [...areas.map((a) => a.lat), c.box[1], c.box[3]], lons = [...areas.map((a) => a.lon), c.box[0], c.box[2]];
  const m = 0.03;
  const found = (n: number) => (n ? `${n} districts` : 'the whole city');
  note('idealista', !!idl, idl ? found(idealistaDistricts(idl.page.links, idl.slug).length) : 'not found');
  note('fotocasa', !!foto, foto ? found(foto.page.districts.length) : 'not found');
  note('habitaclia', !!hab, hab ? found(hab.page.sons.filter((z) => z.path.split('/').length === depth).length) : 'not found');
  note('roomgo', !!roomgo, roomgo ? 'has this city' : 'not in this city');
  note('depisoenpiso', !!dpp, dpp ? 'has this city' : 'not in this city');
  deps.log(`${areas.length} areas ready: ${areas.length - towns} in ${c.name} and ${towns} towns around it`);
  return {
    city: { city: cityKey(c), name: c.name, province: prov.name, center, catalanStreets: prov.catalan, portals, areas,
      box: [Math.min(...lons) - m, Math.max(...lats) + m, Math.max(...lons) + m, Math.min(...lats) - m] },
    notes,
  };
}
