// Habitaclia: pisos enteros. Ya no tiene seccion de habitaciones.
// La pagina trae window.__INITIAL_PROPS__ = JSON.parse("..."), con precio,
// habitaciones, baños, metros construidos, planta, caracteristicas,
// coordenadas, fecha de actualizacion y contacto.
import { emptyListing, type RawListing } from '../model';
import type { SearchProfile } from '../profiles';
import { surface, type Area, type Source } from './base';

const BASE = 'https://www.habitaclia.com';
const MARK = '__INITIAL_PROPS__ = JSON.parse(';
export const CITY_AREA = 'barcelona-capital';
const FLOORS: Record<string, string> = {
  BASEMENT: '-1', SEMI_BASEMENT: '-1', GROUND: '0', MEZZANINE: '0', FIRST: '1', SECOND: '2',
  THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', SEVENTH: '7', EIGHTH: '8', NINTH: '9',
  TENTH: '10', PENTHOUSE: 'penthouse',
};

export function buildUrl(zone: string, page = 1, filters: Record<string, unknown> = {}): string {
  let url = `${BASE}/alquiler/viviendas/barcelona-provincia/${zone}/s`;
  if (page > 1) url += `/${page}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, String(v));
  const qs = q.toString();
  return url + (qs ? `?${qs}` : '');
}

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any

/** El argumento de JSON.parse es una cadena JSON que contiene JSON. */
function props(html: string): Json | null {
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

export const habitaclia: Source = {
  name: 'habitaclia',
  types: ['flat'],
  pause: [3, 6],
  blockedMarkers: ['captcha-delivery'],
  readyMarkers: [MARK],
  minLength: 5000,
  perArea: true,
  pageSize: 1,
  listUrl(area: Area | null, p: SearchProfile, page: number) {
    const zone = area ? area.habitaclia : CITY_AREA;
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
};
