// HousingAnywhere: habitaciones y pisos a medio plazo, muy usado por
// estudiantes. Su buscador pregunta a Algolia desde el navegador con una
// clave publica de solo lectura que lleva cada pagina; Algolia admite CORS,
// asi que la web le pregunta directamente. La clave se lee de la pagina en
// cada busqueda (por la extension), no se guarda aqui.
//
// Hechos comprobados (2026-10-11): 11.000 anuncios en Barcelona; el JSON trae
// el tipo (PRIVATE_ROOM, APARTMENT...), si se puede empadronar, gastos,
// genero, mascotas, estancia minima y coordenadas.
import { emptyListing, type Gender, type ListingType, type RawListing } from '../model';
import { activeBudget } from '../budget';
import { inferGender, NetError, type DiscoverCtx, type Net, type Source } from './base';

const BASE = 'https://housinganywhere.com';
const PER_PAGE = 40;

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
export interface AlgoliaConfig { appId: string; apiKey: string; index: string }

const KINDS: Record<ListingType, string[]> = {
  room: ['PRIVATE_ROOM', 'SHARED_ROOM'],
  flat: ['APARTMENT', 'STUDIO', 'HOUSE'],
};
const LABELS: Record<string, string> = {
  PRIVATE_ROOM: 'Habitación', SHARED_ROOM: 'Habitación compartida', APARTMENT: 'Piso', STUDIO: 'Estudio', HOUSE: 'Casa',
};

export const pageUrl = (city: string) => `${BASE}/s/${encodeURIComponent(city)}--Spain`;

/** La configuracion de Algolia que la pagina lleva dentro. */
export function algoliaConfig(html: string): AlgoliaConfig | null {
  const m = html.match(/"algolia":(\{[^}]*\})/);
  if (!m) return null;
  try {
    const c = JSON.parse(m[1]);
    const index = c.indexMostRecent || c.index;
    return c.appId && c.apiKey && index ? { appId: c.appId, apiKey: c.apiKey, index } : null;
  } catch {
    return null;
  }
}

export function queryBody(cfg: AlgoliaConfig, city: string, type: ListingType, maxPrice: number | null, page: number, perPage = PER_PAGE) {
  const facets = [[`city:${city}`], KINDS[type].map((k) => `propertyType:${k}`)];
  const params = new URLSearchParams({ hitsPerPage: String(perPage), page: String(page), facetFilters: JSON.stringify(facets) });
  // Sin precio fijo (precio 0) no hay nada que comparar.
  params.set('numericFilters', JSON.stringify(['priceEUR>0', ...(maxPrice ? [`priceEUR<=${maxPrice}`] : [])]));
  return { requests: [{ indexName: cfg.index, params: params.toString() }] };
}

const yesNo = (v: unknown) => (v === 'yes' ? true : v === 'no' ? false : null);
const num = (v: unknown) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const dmy = (iso: unknown) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('-') : '');
const GENDER: Record<string, Gender> = { female: 'female_only', male: 'male_only' };

export function toListing(h: Json, now = new Date()): RawListing {
  const kind = String(h.propertyType ?? '');
  const l = emptyListing('housinganywhere', `ut${h.unitTypeInternalID ?? h.internalID}`, BASE + String(h.unitTypePath ?? h.path ?? ''));
  const street = String(h.street ?? '');
  const published = Number(h.publishedDateTS);
  Object.assign(l, {
    type: KINDS.room.includes(kind) ? 'room' : 'flat',
    title: `${LABELS[kind] ?? 'Alquiler'}${street ? ` en ${street}` : ''}`,
    price: Number(h.priceEUR) || null,
    // I: gastos incluidos; E: aparte (con una estimacion, a veces); P: en parte.
    expenses: h.utilities === 'I' ? 0 : h.utilities === 'E' && Number(h.estimatedBillsEUR) > 0 ? Number(h.estimatedBillsEUR) : null,
    address: street,
    neighbourhood: String(h.neighborhood ?? ''),
    municipality: String(h.city ?? ''),
    lat: Number(h._geoloc?.lat) || null,
    lon: Number(h._geoloc?.lng) || null,
    approximateLocation: false,
    bedrooms: num(h.facility_bedroom_count),
    surfaceM2: num(h.facility_total_size),
    roomM2: num(h.facility_bedroom_size),
    smokingAllowed: h.facility_smoking_allowed === 'yes' ? true : h.facility_smoking_allowed ? false : null,
    petsAllowed: yesNo(h.facility_animal_allowed),
    registrationAllowed: yesNo(h.facility_registration_possible),
    couplesAllowed: yesNo(h.couplesAllowed),
    furnished: yesNo(h.facility_bedroom_furnished),
    minStayMonths: num(h.minimumStayMonths),
    availableFrom: dmy(h.firstDate),
    description: String(h.description ?? '').trim(),
    photo: String(h.thumbnailURL ?? h.photos?.[0] ?? ''),
    ageDays: published > 0 ? Math.max(0, Math.floor((now.getTime() / 1000 - published) / 86400)) : null,
  } satisfies Partial<RawListing>);
  if (l.type === 'room') {
    const g = GENDER[String(h.onlyForGender)];
    if (g) [l.gender, l.genderConfirmed] = [g, true];
    else l.gender = inferGender(`${l.title} ${l.description}`);
  }
  return l;
}

async function config(net: Net, city: string): Promise<{ cfg: AlgoliaConfig; html: string }> {
  const { body } = await net.page({ url: pageUrl(city), tab: false });
  const cfg = algoliaConfig(body);
  if (!cfg) throw new NetError('no search key in the page (it may have changed)');
  return { cfg, html: body };
}

function algolia(net: Net, cfg: AlgoliaConfig, body: unknown) {
  return net.json<{ results?: { hits?: Json[]; nbHits?: number; nbPages?: number }[] }>({
    url: `https://${cfg.appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`,
    direct: true,
    headers: { 'x-algolia-application-id': cfg.appId, 'x-algolia-api-key': cfg.apiKey },
    json: body,
  });
}

export const housinganywhere: Source = {
  name: 'housinganywhere',
  label: 'HousingAnywhere',
  types: ['room', 'flat'],
  net: { pause: [2, 4], blockedMarkers: ['captcha-delivery'], minLength: 2000 },
  planned: (q) => q.pages,
  async *search(q, net) {
    const city = q.city.portals.housinganywhere;
    if (!city) return;
    const { cfg } = await config(net, city);
    for (let page = 0; page < q.pages; page++) {
      const r = await algolia(net, cfg, queryBody(cfg, city, q.type, activeBudget(q.profile).max, page));
      const res = r.results?.[0];
      yield { listings: (res?.hits ?? []).map((h) => toListing(h)), label: `page ${page + 1}` };
      if (!res || page + 1 >= (res.nbPages ?? 0)) return;
    }
  },
  /** El nombre de la ciudad tal como lo guarda su buscador ('Barcelona'). */
  async discover(ctx: DiscoverCtx) {
    const r = await ctx.page(pageUrl(ctx.city.name));
    const cfg = r && algoliaConfig(r.html);
    if (!cfg) return null;
    const city = r.html.match(/"cityCanonical":"([^"]+)"/)?.[1] ?? ctx.city.name;
    const res = await ctx.json<{ results?: { nbHits?: number }[] }>({
      url: `https://${cfg.appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`, direct: true,
      headers: { 'x-algolia-application-id': cfg.appId, 'x-algolia-api-key': cfg.apiKey },
      json: queryBody(cfg, city, 'room', null, 0, 0),
    });
    return res?.results?.[0]?.nbHits ? { ref: city } : null;
  },
};
