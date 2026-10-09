// Fotocasa: habitaciones ("compartir pisos") y pisos enteros ("alquiler viviendas").
//
// No pinta los anuncios en el HTML: los entrega en un JSON incrustado. Se
// localiza por su CLAVE ("realEstates"), no por la variable de JavaScript, que
// el framework renombra en cada despliegue. Trae coordenadas, antiguedad en
// dias e isTemporaryRental.
//
// accuracy=false: la posicion es del barrio, no del portal.
import { emptyListing, type ListingType, type RawListing } from '../model';
import type { SearchProfile } from '../profiles';
import { inferGender, surface, type Area, type Source } from './base';

const BASE = 'https://www.fotocasa.es';
const SORTS: Record<string, string> = {
  cheapest: '?sortType=price&sortOrderDesc=false',
  newest: '?sortType=publicationDate&sortOrderDesc=true',
  relevance: '',
};
const SECTION: Record<ListingType, string> = { room: 'compartir/pisos', flat: 'alquiler/viviendas' };
const RENT = 3;   // transactionTypeId: 5 es compartir, 3 es alquiler
export const CITY_AREA = 'barcelona-capital/todas-las-zonas';

export function buildUrl(zone: string, page = 1, sort = 'relevance', type: ListingType = 'room'): string {
  let url = `${BASE}/es/${SECTION[type]}/${zone}/l`;
  if (page > 1) url += `/${page}`;
  return url + (SORTS[sort] ?? '');
}

/** El array JSON que sigue a "clave":[...]. Cuenta corchetes respetando
 * cadenas y escapes: el blob mide cientos de miles de caracteres. */
export function extractJson(html: string, key: string): unknown[] | null {
  const mark = `"${key}":[`;
  let start = html.indexOf(mark);
  while (start >= 0) {
    const j = start + mark.length - 1;
    let depth = 0, inString = false, escaped = false;
    for (let k = j; k < html.length; k++) {
      const c = html[k];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '[') depth++;
      else if (c === ']' && --depth === 0) {
        try {
          const data = JSON.parse(html.slice(j, k + 1));
          if (Array.isArray(data) && data.length) return data;
        } catch { /* sigue con la siguiente aparicion */ }
        break;
      }
    }
    start = html.indexOf(mark, start + 1);
  }
  return null;
}

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
const UNITS: Record<string, [string, string]> = {
  DAYS: ['día', 'días'], HOURS: ['hora', 'horas'], MONTHS: ['mes', 'meses'], MINUTES: ['minuto', 'minutos'],
};
const TO_DAYS: Record<string, number> = { DAYS: 1, HOURS: 1 / 24, MINUTES: 1 / 1440, MONTHS: 30 };

function age(date: Json | null | undefined): string {
  if (!date || date.diff == null) return '';
  const [one, many] = UNITS[date.unit ?? 'DAYS'] ?? ['día', 'días'];
  return `hace ${date.diff} ${date.diff === 1 ? one : many}`;
}
function days(date: Json | null | undefined): number | null {
  if (!date || date.diff == null) return null;
  const f = TO_DAYS[date.unit ?? 'DAYS'];
  return f === undefined ? null : Math.trunc(date.diff * f);
}
function feature(raw: Json, key: string): unknown {
  for (const f of raw.features ?? []) if (f?.key === key) return f.value;
  return null;
}

function toListing(raw: Json): RawListing | null {
  const id = raw.id;
  if (!id) return null;
  const detail: Json = raw.detail ?? {};
  const path: string = detail['es-ES'] || Object.values(detail)[0] || '';
  if (!path) return null;
  const addr: Json = raw.address ?? {};
  const coords: Json = raw.coordinates ?? {};
  const photo = (raw.multimedia ?? []).find((m: Json) => m?.type === 'image' && m.src)?.src ?? '';
  const description = String(raw.description ?? '').trim();
  const flat = raw.transactionTypeId === RENT;
  const keys = new Set((raw.features ?? []).map((f: Json) => f?.key));
  const floor = feature(raw, 'floor');
  const l = emptyListing('fotocasa', String(id), path.startsWith('/') ? BASE + path : path);
  return Object.assign(l, {
    type: flat ? 'flat' : 'room',
    title: addr.upperLevel || addr.neighborhood || (flat ? 'Piso' : 'Habitación'),
    price: raw.rawPrice || null,
    address: addr.upperLevel ?? '',
    neighbourhood: addr.neighborhood || addr.district || '',
    municipality: addr.municipality ?? '',
    lat: coords.latitude ?? null,
    lon: coords.longitude ?? null,
    approximateLocation: !(raw.accuracy ?? false),
    // En un piso entero no hay convivencia que inferir.
    gender: flat ? 'unknown' : inferGender(description),
    genderConfirmed: false,
    bedrooms: (feature(raw, 'rooms') as number | null) ?? null,
    bathrooms: (feature(raw, 'bathrooms') as number | null) ?? null,
    surfaceM2: surface(feature(raw, 'surface')),
    floor: floor == null ? '' : String(floor),
    // Solo pone la caracteristica cuando la hay: su ausencia no dice nada.
    elevator: keys.has('elevator') ? true : null,
    furnished: keys.has('furnished') ? true : keys.has('not_furnished') ? false : null,
    description,
    extraNotes: raw.isTemporaryRental ? 'Alquiler temporal según el portal' : '',
    photo,
    publishedText: age(raw.date),
    ageDays: days(raw.date),
  } satisfies Partial<RawListing>);
}

export function parseList(html: string): RawListing[] {
  const raws = extractJson(html, 'realEstates');
  return (raws ?? []).map((r) => toListing(r as Json)).filter((l): l is RawListing => l !== null);
}

export const fotocasa: Source = {
  name: 'fotocasa',
  types: ['room', 'flat'],
  pause: [3, 7],
  blockedMarkers: ['captcha-delivery', 'Please enable JS'],
  readyMarkers: ['"realEstates"'],
  minLength: 20000,
  perArea: true,
  pageSize: 1,
  listUrl(area: Area | null, p: SearchProfile, page: number) {
    const zone = area ? area.fotocasa : CITY_AREA;
    return zone ? buildUrl(zone, page, p.crawl.fotocasa_sort, p.listing_type) : null;
  },
  parseList: (html, type) => parseList(html).filter((l) => l.type === type),
  // Ordenado de barato a caro: si toda la pagina supera el techo, las
  // siguientes solo traen cosas mas caras.
  shouldStop(batch, p) {
    if (p.crawl.fotocasa_sort !== 'cheapest') return false;
    const ceiling = p.listing_type === 'flat' ? p.flat.max_rent : p.budget.max_total;
    const prices = batch.map((l) => l.price).filter((x): x is number => !!x);
    return prices.length > 0 && Math.min(...prices) > ceiling;
  },
};
