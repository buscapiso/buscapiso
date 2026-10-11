// Fotocasa: habitaciones ("compartir pisos") y pisos enteros ("alquiler viviendas").
//
// No pinta los anuncios en el HTML: los entrega en un JSON incrustado. Se
// localiza por su CLAVE ("realEstates"), no por la variable de JavaScript, que
// el framework renombra en cada despliegue. Trae coordenadas, antiguedad en
// dias e isTemporaryRental.
//
// accuracy=false: la posicion es del barrio, no del portal.
import { emptyListing, type ListingType, type RawListing } from '../model';
import type { City } from '../coverage';
import type { SearchProfile } from '../profiles';
import { sameName } from '../cities/names';
import { inferGender, pagedHtml, surface, zonesNote, type Area, type Coverage, type DiscoverCtx } from './base';

const BASE = 'https://www.fotocasa.es';
const SORTS: Record<string, string> = {
  cheapest: '?sortType=price&sortOrderDesc=false',
  newest: '?sortType=publicationDate&sortOrderDesc=true',
  relevance: '',
};
const SECTION: Record<ListingType, string> = { room: 'compartir/pisos', flat: 'alquiler/viviendas' };
const RENT = 3;   // transactionTypeId: 5 es compartir, 3 es alquiler

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

// --- Descubrir una ciudad ----------------------------------------------------
// combinedLocation tiene nueve niveles: pais, comunidad, provincia, comarca,
// subcomarca, municipio (codigo INE), -, distrito, barrio. "0" es vacio.
const MUNI = 5, DISTRICT = 7, HOOD = 8, COMARCA = 3;

/** Una zona hija o hermana: su nombre, su trozo de URL y cuantos anuncios tiene. */
export interface PortalZone { name: string; path: string; count: number }

export interface FotocasaPage {
  /** 'Granada' en la pagina del municipio. */
  name: string;
  level: string;
  ine: string;
  ids: string[];
  municipalities: PortalZone[];
  districts: PortalZone[];
  comarcas: (PortalZone & { ids: string[] })[];
}

export function fotocasaPage(html: string): FotocasaPage | null {
  const h = html.replace(/\\"/g, '"');
  const ids = h.match(/"combinedLocationIds":"([\d,]+)"/)?.[1]?.split(',');
  if (!ids || ids.length < 9) return null;
  const items = new Map<string, { ids: string[]; count: number; name: string; path: string }>();
  for (const m of h.matchAll(/\{"combinedLocation":"([\d,]+)","counter":(\d+),"literal":"([^"]+)","segments":"([^"]+)"/g)) {
    if (!items.has(m[4])) items.set(m[4], { ids: m[1].split(','), count: Number(m[2]), name: m[3].trim(), path: m[4] });
  }
  const all = [...items.values()];
  const zone = ({ name, path, count }: PortalZone) => ({ name, path, count });
  return {
    name: (h.match(/"locationLiteral":"([^"]*)"/)?.[1] ?? '').trim(),
    level: h.match(/"level":"([A-Z_]+)","locationCode"/)?.[1] ?? '',
    ine: ids[MUNI] !== '0' ? ids[MUNI] : '',
    ids,
    municipalities: all.filter((x) => x.ids[MUNI] !== '0' && x.ids[DISTRICT] === '0').map(zone),
    districts: all.filter((x) => x.ids[MUNI] === ids[MUNI] && x.ids[MUNI] !== '0' && x.ids[DISTRICT] !== '0' && x.ids[HOOD] === '0')
      .map(zone),
    comarcas: all.filter((x) => x.ids[COMARCA] !== '0' && x.ids[MUNI] === '0').map((x) => ({ ...zone(x), ids: x.ids })),
  };
}

/** Lo que Fotocasa deja a las demas fuentes al descubrir. */
export interface FotocasaFacts { slug: string; ine: string }

/** 'granada-capital' o 'armilla'. Si no acierta, en la segunda vuelta prueba
 * el trozo que encontro Habitaclia: son la misma empresa y lo comparten. */
async function discover(ctx: DiscoverCtx): Promise<Coverage | null> {
  const at = async (muni: string) => {
    const r = await ctx.page(`https://www.fotocasa.es/es/alquiler/viviendas/${muni}/todas-las-zonas/l`);
    const page = r && fotocasaPage(r.html);
    return page && page.level === 'MUNICIPALITY' && sameName(page.name, ctx.city.name) ? { slug: muni, page } : null;
  };
  let foto: { slug: string; page: FotocasaPage } | null = null;
  if (ctx.retry) {
    const hab = ctx.facts.habitaclia as { path: string } | undefined;
    if (hab) foto = await at(hab.path.split('/').at(-1)!);
  } else {
    for (const s of ctx.slugs) {
      for (const g of [`${s}-capital`, s]) if (!foto) foto = await at(g);
    }
  }
  if (!foto) return null;
  ctx.facts.fotocasa = { slug: foto.slug, ine: foto.page.ine } satisfies FotocasaFacts;
  return { ref: `${foto.slug}/todas-las-zonas`, note: zonesNote(foto.page.districts.length),
    zones: foto.page.districts.map((z) => ({ label: z.name, town: false, ref: z.path, count: z.count })) };
}

export const fotocasa = pagedHtml({
  name: 'fotocasa',
  label: 'Fotocasa',
  types: ['room', 'flat'],
  net: {
    pause: [3, 7],
    blockedMarkers: ['captcha-delivery', 'Please enable JS'],
    readyMarkers: ['"realEstates"'],
    minLength: 20000,
  },
  perArea: true,
  pageSize: 1,
  listUrl(area: Area | null, p: SearchProfile, page: number, city: City) {
    const zone = area ? area.portals.fotocasa : city.portals.fotocasa;
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
  discover,
  retryDiscover: true,
  // Los pueblos de alrededor los encuentra Habitaclia; Fotocasa usa el mismo trozo.
  fillZone: (z) => (z.town && z.portals.habitaclia ? `${z.portals.habitaclia.split('/').at(-1)}/todas-las-zonas` : null),
});
