// Habitaclia: pisos enteros. Ya no tiene seccion de habitaciones.
// La pagina trae window.__INITIAL_PROPS__ = JSON.parse("..."), con precio,
// habitaciones, baños, metros construidos, planta, caracteristicas,
// coordenadas, fecha de actualizacion y contacto.
import { emptyListing, type RawListing } from '../model';
import type { City } from '../coverage';
import type { SearchProfile } from '../profiles';
import { sameName, slug } from '../cities/names';
import { pagedHtml, surface, zonesNote, type Area, type Coverage, type DiscoverCtx } from './base';
import type { FotocasaFacts } from './fotocasa';

const BASE = 'https://www.habitaclia.com';
const MARK = '__INITIAL_PROPS__ = JSON.parse(';
const FLOORS: Record<string, string> = {
  BASEMENT: '-1', SEMI_BASEMENT: '-1', GROUND: '0', MEZZANINE: '0', FIRST: '1', SECOND: '2',
  THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', SEVENTH: '7', EIGHTH: '8', NINTH: '9',
  TENTH: '10', PENTHOUSE: 'penthouse',
};

/** `zone` lleva la provincia delante: 'barcelona-provincia/barcelona-capital/gracia'. */
export function buildUrl(zone: string, page = 1, filters: Record<string, unknown> = {}): string {
  let url = `${BASE}/alquiler/viviendas/${zone}/s`;
  if (page > 1) url += `/${page}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, String(v));
  const qs = q.toString();
  return url + (qs ? `?${qs}` : '');
}

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any

/** El argumento de JSON.parse es una cadena JSON que contiene JSON. */
export function props(html: string): Json | null {
  const i = html.indexOf(MARK);
  if (i < 0) return null;
  const start = i + MARK.length;
  if (html[start] !== '"') return null;
  let k = start + 1;
  for (; k < html.length; k++) {
    if (html[k] === '\\') { k++; continue; }
    if (html[k] === '"') break;
  }
  try {
    return JSON.parse(JSON.parse(html.slice(start, k + 1)));
  } catch {
    return null;
  }
}

function context(html: string): Json {
  return props(html)?.initialSearchResultsPage?.initialSearchContext ?? {};
}

export function totalPages(html: string): number {
  return Number(context(html).results?.pagination?.totalPages ?? 0) || 0;
}

/** Dias desde la ultima actualizacion: Habitaclia no publica la fecha de alta. */
function daysSince(date: string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(date.replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

function toListing(it: Json, now: Date): RawListing | null {
  const id = it.id;
  const path: string | undefined = it.urls?.canonical || it.navigationUrl;
  if (!id || !path) return null;
  const summary: Json = it.summary ?? {};
  const loc: Json = summary.location ?? {};
  const prop: Json = it.property ?? {};
  const has = new Set(prop.features?.has ?? []);
  const hasNot = new Set(prop.features?.hasNot ?? []);
  const dynamic = new Set(prop.dynamicFeatures ?? []);
  const street: Json = loc.address ?? {};
  const neighbourhood = (loc.layers ?? []).find((c: Json) => c?.type === 'neighbourhood')?.value
    || loc.district || '';
  const yesNo = (k: string) => (has.has(k) ? true : hasNot.has(k) ? false : null);
  const l = emptyListing('habitaclia', String(id), path.startsWith('/') ? BASE + path : path);
  return Object.assign(l, {
    type: 'flat',
    title: summary.title || neighbourhood || 'Piso',
    price: it.transaction?.price?.amount || null,
    address: [street.streetName, street.streetNumber].filter(Boolean).join(' '),
    neighbourhood,
    municipality: String(loc.municipality ?? '').replace(/ Capital$/, ''),
    lat: loc.coordinates?.latitude ?? null,
    lon: loc.coordinates?.longitude ?? null,
    // ZONE y STREET son posiciones de la zona o de la calle, no del portal.
    approximateLocation: loc.visibility !== 'EXACT',
    bedrooms: prop.rooms ?? null,
    bathrooms: prop.bathrooms ?? null,
    surfaceM2: surface(prop.builtSurface),
    floor: FLOORS[prop.floor ?? ''] ?? '',
    elevator: yesNo('ELEVATOR'),
    furnished: yesNo('FURNISHED'),
    exterior: dynamic.has('IS_EXTERIOR') ? true : null,
    description: String(summary.description ?? '').trim(),
    extraNotes: dynamic.has('IS_TEMPORARY') ? 'Alquiler temporal según el portal' : '',
    photo: (summary.multimedia?.images ?? []).find((f: Json) => f?.url)?.url ?? '',
    ageDays: daysSince(summary.updatedAt, now),
  } satisfies Partial<RawListing>);
}

export function parseList(html: string, now = new Date()): RawListing[] {
  const items: Json[] = context(html).results?.items ?? [];
  return items.map((it) => toListing(it, now)).filter((l): l is RawListing => l !== null);
}

// --- Descubrir una ciudad ----------------------------------------------------
/** Una zona hija o hermana: su nombre, su trozo de URL y cuantos anuncios tiene. */
export interface PortalZone { name: string; path: string; count: number }

export interface HabitacliaPage {
  name: string;
  /** Como se llama a si misma: 'bizkaia-provincia/bilbao'. */
  path: string;
  /** 'province', 'region', 'municipality'... */
  layer: string;
  code: string;
  lat: number | null;
  lon: number | null;
  /** Zonas de dentro (distritos de un municipio) y vecinas del mismo nivel. */
  sons: PortalZone[];
  same: PortalZone[];
}

export function habitacliaPage(html: string): HabitacliaPage | null {
  const c = props(html)?.initialSearchResultsPage?.initialSearchContext;
  const g = c?.geography;
  if (!g) return null;
  const section = (type: string): PortalZone[] => ((c.internalLinks?.sections ?? []) as Json[])
    .filter((s) => s.type === type).flatMap((s) => s.items ?? [])
    .map((it: Json) => ({ name: String(it.locationLabel ?? ''), count: Number(it.count ?? 0),
      path: String(it.href ?? '').match(/^\/alquiler\/viviendas\/(.+)\/s$/)?.[1] ?? '' }))
    .filter((z: PortalZone) => z.name && z.path);
  const slug = String(g.slug ?? ''), parent = String(g.parentSlug ?? '');
  return { name: String(g.name ?? ''), path: parent && parent !== slug ? `${parent}/${slug}` : slug,
    layer: String(g.layer ?? ''), code: String(g.code ?? ''),
    lat: Number(g.latitude) || null, lon: Number(g.longitude) || null,
    sons: section('GEOGRAPHY_SONS'), same: section('GEOGRAPHY_SAME_LEVEL') };
}

/** Pueblos de alrededor como mucho, y comarcas que se miran al buscar el
 * municipio desde la provincia. */
const NEIGHBOURS = 12;
const COMARCAS = 8;

/** El municipio con la provincia delante: 'granada-provincia/granada-capital'.
 * Primero lo que dicta la regla (con el trozo de Fotocasa si lo encontro); si
 * no, se baja por el arbol: provincia -> comarcas -> municipios. */
async function discover(ctx: DiscoverCtx): Promise<Coverage | null> {
  const foto = ctx.facts.fotocasa as FotocasaFacts | undefined;
  const prov = ctx.province;
  const provSlugs = [...new Set([prov.name, ...prov.aliases, prov.idealista].map((p) => `${slug(p)}-provincia`))];
  const read = async (path: string) => {
    const r = await ctx.page(`https://www.habitaclia.com/alquiler/viviendas/${path}/s`);
    return r && habitacliaPage(r.html);
  };
  const isTheCity = (p: HabitacliaPage | null): p is HabitacliaPage => !!p && p.layer === 'municipality'
    && (foto ? p.code === foto.ine : sameName(p.name, ctx.city.name));
  let hab: { path: string; page: HabitacliaPage } | null = null;
  const muniGuesses = foto ? [foto.slug] : ctx.slugs.flatMap((s) => [`${s}-capital`, s]);
  for (const p of provSlugs) {
    for (const m of muniGuesses) {
      if (hab) break;
      const page = await read(`${p}/${m}`);
      if (isTheCity(page)) hab = { path: page.path || `${p}/${m}`, page };
    }
  }
  for (const p of hab ? [] : provSlugs) {
    const top = await read(p);
    if (!top || top.layer !== 'province') continue;
    for (const comarca of [...top.sons].sort((a, b) => b.count - a.count).slice(0, COMARCAS)) {
      if (hab) break;
      const son = (await read(comarca.path))?.sons.find((z) => sameName(z.name, ctx.city.name));
      if (!son) continue;
      const page = await read(son.path);
      if (isTheCity(page)) hab = { path: page.path || son.path, page };
    }
    if (hab) break;
  }
  if (!hab) return null;
  ctx.facts.habitaclia = { path: hab.path };
  const depth = hab.path.split('/').length + 1;
  const districts = hab.page.sons.filter((z) => z.path.split('/').length === depth);
  const towns = [...hab.page.same].sort((a, b) => b.count - a.count).slice(0, NEIGHBOURS)
    .filter((z) => !sameName(z.name, ctx.city.name));
  return {
    ref: hab.path,
    note: zonesNote(districts.length),
    zones: [...districts.map((z) => ({ label: z.name, town: false, ref: z.path, count: z.count })),
      ...towns.map((z) => ({ label: z.name, town: true, ref: z.path, count: z.count }))],
  };
}

export const habitaclia = pagedHtml({
  name: 'habitaclia',
  label: 'Habitaclia',
  types: ['flat'],
  net: {
    pause: [3, 6],
    blockedMarkers: ['captcha-delivery'],
    readyMarkers: [MARK],
    minLength: 5000,
  },
  perArea: true,
  pageSize: 1,
  listUrl(area: Area | null, p: SearchProfile, page: number, city: City) {
    const zone = area ? area.portals.habitaclia : city.portals.habitaclia;
    if (!zone) return null;
    return buildUrl(zone, page, {
      maxPrice: p.flat.max_rent,
      minRooms: p.flat.min_bedrooms || null,
      minSurface: p.flat.min_surface_m2,
      ...(p.crawl.fotocasa_sort === 'cheapest' ? { sortBy: 'PRICE_ASC' } : {}),
    });
  },
  parseList: (html) => parseList(html),
  totalPages,
  discover,
});
