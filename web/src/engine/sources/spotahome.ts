// Spotahome: habitaciones y pisos amueblados por meses, visitados por el
// portal. Su web se pinta con JavaScript a partir de dos APIs publicas, sin
// CORS (van por la extension):
//   /api/public/listings/search/markers/{ciudad}?budget=0-N  -> todos los
//     anuncios de la ciudad bajo ese precio, con coordenadas (uno por punto)
//   /api/public/listings/search/homecards_ids?ids[]=..       -> sus fichas
// Hechos comprobados (2026-10-11): 6.600 puntos en Barcelona en una sola
// respuesta; las fichas, de 40 en 40 sin problema; 'type[]' (rooms,
// apartments, studios), 'move-in' y 'move-out' filtran.
import { emptyListing, type ListingType, type RawListing } from '../model';
import { activeBudget } from '../budget';
import { haversineM } from '../travel';
import type { Amenity } from '../profiles';
import { getText, inferGender, parseHtml, type DiscoverCtx, type SearchQuery, type Source } from './base';

const BASE = 'https://www.spotahome.com';
const API = `${BASE}/api/public/listings/search`;
/** Fichas por peticion, y fichas por "pagina" de las del perfil. */
const BATCH = 40;

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
interface Marker { id: number; coord: [number, number]; minimumPrice: number }

/** 'room_shared', 'room_private'... son habitaciones; 'apartment' y 'studio', pisos. */
export const kindOf = (type: string): ListingType => (/room|bed|residence/.test(type) ? 'room' : 'flat');

const dmy = (iso: string | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('-') : '');

/** Su filtro de tipo: 'rooms' (habitaciones y camas), o pisos y estudios. */
const TYPES: Record<ListingType, string[]> = { room: ['rooms'], flat: ['apartments', 'studios'] };

export function markersUrl(city: string, q: Pick<SearchQuery, 'profile' | 'type'>): string {
  const params = new URLSearchParams({ budget: `0-${activeBudget(q.profile).max}` });
  for (const t of TYPES[q.type]) params.append('type[]', t);
  const { move_in: from, stay_months: months } = q.profile.prefs;
  if (from) {
    params.set('move-in', from);
    if (months) {
      const to = new Date(`${from}T00:00:00Z`);
      to.setUTCMonth(to.getUTCMonth() + months);
      params.set('move-out', to.toISOString().slice(0, 10));
    }
  }
  return `${API}/markers/${encodeURIComponent(city)}?${params}`;
}

export const homecardsUrl = (ids: number[]) => `${API}/homecards_ids?${ids.map((id) => `ids%5B%5D=${id}`).join('&')}`;

export function toListing(c: Json): RawListing {
  const l = emptyListing('spotahome', String(c.id), `${BASE}/es${c.url}`);
  const [lon, lat] = (c.location?.coord ?? []) as number[];
  const rules: Json[] = c.instantBooking?.rules ?? [];
  const minStay = Object.values(rules.find((r) => r.type === 'minStay')?.params ?? {}).map(Number).filter(Number.isFinite);
  const deposit = c.bookingConditions?.securityDepositType === 'fixed' ? Number(c.bookingConditions.securityDepositValue) / 100 : null;
  const hood = String(c.neighborhoodName ?? '');
  Object.assign(l, {
    type: kindOf(String(c.type ?? '')),
    title: String(c.title ?? ''),
    price: Number(c.pricePerMonth) || null,
    address: String(c.location?.street ?? ''),
    neighbourhood: hood.startsWith('unsupported') ? '' : hood,
    municipality: String(c.location?.city ?? ''),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    approximateLocation: false,
    bedrooms: Number(c.numberOfBedrooms) || null,
    bathrooms: Number(c.numberOfBathrooms) || null,
    surfaceM2: Number(c.area) || null,
    roomM2: Number(c.roomArea) || null,
    couplesAllowed: rules.some((r) => r.type === 'couplesNotAllowed') ? false : null,
    minStayMonths: minStay.length ? Math.min(...minStay) : null,
    availableFrom: dmy(c.firstAvailableDate),
    description: String(c.description ?? '').trim(),
    photo: String(c.photoUrls?.homecardHidpi ?? c.mainPhotoUrl ?? ''),
    furnished: true,
    depositEur: deposit,
    // Spotahome cobra su comision a quien alquila.
    agencyFee: Number(c.bookingConditions?.adminFeeValue) > 0 ? true : null,
    extraNotes: 'Alquiler temporal (por meses) según el portal',
  } satisfies Partial<RawListing>);
  if (l.type === 'room') l.gender = inferGender(`${l.title} ${l.description}`);
  return l;
}

const AMENITIES: Record<string, Amenity> = { 'aire acondicionado': 'air_conditioning', 'calefacción': 'heating',
  lavadora: 'washing_machine', lavavajillas: 'dishwasher', 'balcón o terraza': 'balcony_or_terrace', ascensor: 'lift' };

/** La ficha: la descripcion entera en castellano (la del listado es un
 * resumen en ingles) y, de su JSON-LD, mascotas, fumar, ascensor y estancia. */
export function parseRoom(html: string): Partial<RawListing> {
  const doc = parseHtml(html);
  let ld: Json = {};
  for (const sc of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(sc.textContent ?? '');
      const items: Json[] = Array.isArray(j) ? j : j?.['@graph'] ?? [j];
      ld = items.find((x) => x && 'petsAllowed' in x) ?? ld;
    } catch { /* otro bloque */ }
  }
  // Dos bloques: lo que escribe el propietario y el resumen de Spotahome.
  const blocks = [...doc.querySelectorAll('.listing-overview__listing-description')].map((el) => {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll('.listing-title').forEach((h) => h.remove());
    return getText(copy);
  }).filter(Boolean);
  const text = blocks.join('\n\n') || String(ld.description ?? '');
  const features = new Map(((ld.amenityFeature ?? []) as Json[]).map((f) => [String(f.name).toLowerCase(), f.value === true]));
  const couples = /no (?:es )?adecuad[oa] para parejas|no (?:se )?admite[n]? parejas/i.test(text) ? false
    : /(?:adecuad[oa] para|se admiten) parejas/i.test(text) ? true : null;
  const yes = (k: string) => (features.has(k) ? features.get(k)! : null);
  return {
    detailRead: true,
    description: text,
    petsAllowed: typeof ld.petsAllowed === 'boolean' ? ld.petsAllowed : null,
    smokingAllowed: typeof ld.smokingAllowed === 'boolean' ? ld.smokingAllowed : null,
    ...(couples !== null ? { couplesAllowed: couples } : {}),
    minStayMonths: Number(ld.offers?.leaseLength?.minValue) || null,
    elevator: yes('ascensor'),
    furnished: yes('amueblado'),
    bedrooms: Number(ld.numberOfBedrooms) || null,
    bathrooms: Number(ld.numberOfBathroomsTotal) || null,
    surfaceM2: Number(ld.floorSize?.value) || null,
    amenities: [...features].filter(([k, v]) => v && AMENITIES[k]).map(([k]) => AMENITIES[k]),
  };
}

/** Los puntos mas cerca de las zonas elegidas primero: son las que se pueden pedir. */
function nearest(markers: Marker[], q: SearchQuery): Marker[] {
  const dist = (m: Marker) => Math.min(...q.areas.map((a) => haversineM(a.lat, a.lon, m.coord[1], m.coord[0])));
  return markers.map((m) => [dist(m), m] as const).sort((a, b) => a[0] - b[0]).map(([, m]) => m);
}

export const spotahome: Source = {
  name: 'spotahome',
  label: 'Spotahome',
  types: ['room', 'flat'],
  net: { pause: [2, 5], blockedMarkers: [], minLength: 2 },
  planned: (q) => q.pages,
  details: 'best',
  detail: async (l, net) => parseRoom((await net.page({ url: l.url })).body),
  async *search(q, net) {
    const city = q.city.portals.spotahome;
    if (!city) return;
    const res = await net.json<{ data?: Marker[] }>(markersUrl(city, q));
    // Un piso con varias habitaciones es un punto por habitacion: se piden
    // las mas cercanas hasta llenar las "paginas" del perfil.
    const wanted = nearest(res.data ?? [], q).slice(0, q.pages * BATCH);
    for (let i = 0; i < wanted.length; i += BATCH) {
      const ids = wanted.slice(i, i + BATCH).map((m) => m.id);
      const cards = await net.json<{ data?: { homecards?: Json[] } }>(homecardsUrl(ids));
      const listings = (cards.data?.homecards ?? []).map(toListing).filter((l) => l.type === q.type);
      yield { listings, label: `page ${i / BATCH + 1}` };
    }
  },
  async discover(ctx: DiscoverCtx) {
    for (const s of ctx.slugs) {
      const r = await ctx.json<{ data?: unknown[] }>(`${API}/markers/${s}?budget=0-100000`);
      if (r?.data?.length) return { ref: s };
    }
    return null;
  },
};
