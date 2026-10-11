// Badi: habitaciones (y algun piso entero) de particulares. Su web pide a su
// API con un token de invitado que badi.com da a cualquiera que entra sin
// cuenta (/api/auth, con CORS). La API solo admite peticiones de badi.com,
// asi que va por la extension, con el token en la cabecera.
//
// Hechos comprobados (2026-10-11): sin cuenta se ven dos paginas de 30 por
// busqueda (la tercera pide iniciar sesion). Por eso se busca zona a zona,
// como quien mueve el mapa: cada zona elegida es una busqueda. Las
// coordenadas son aproximadas.
import { emptyListing, type RawListing } from '../model';
import { activeBudget } from '../budget';
import { inferGender, intFrom, NetError, type Area, type DiscoverCtx, type Net, type Source } from './base';

const API = 'https://api.badiapp.com/v1/application/search/rooms';
const PER_PAGE = 30;
/** Medio lado del recuadro de cada zona, en grados de latitud (~1,3 km). */
const HALF = 0.012;

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
type Box = { n: number; s: number; e: number; w: number };

export function boxAround(lat: number, lon: number, half = HALF): Box {
  const dLon = half / Math.cos((lat * Math.PI) / 180);
  return { n: lat + half, s: lat - half, e: lon + dLon, w: lon - dLon };
}

export function searchUrl(b: Box, maxPrice: number | null, next: string | null = null, per = PER_PAGE): string {
  const p = new URLSearchParams({ per: String(per),
    'bounds[ne][lat]': String(b.n), 'bounds[ne][lng]': String(b.e), 'bounds[sw][lat]': String(b.s), 'bounds[sw][lng]': String(b.w) });
  if (maxPrice) p.set('max_price', String(maxPrice));
  if (next) p.set('next_token', next);
  return `${API}?${p}`;
}

const dmy = (iso: unknown) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('-') : '');
const text = (x: Json | undefined) => String(x?.content ?? '');

export function toListing(card: Json): RawListing | null {
  const a = card?.attributes;
  if (card?.type !== 'room_card' || !a?.room_id) return null;
  const l = emptyListing('badi', String(a.room_id), `https://badi.com/es/room/${a.room_id}`);
  // 'PRIVATE ROOM · 2 FLATMATES', 'ENTIRE PLACE · 2 BEDROOMS'
  const sub = text(a.subheading).toUpperCase();
  const info = Object.fromEntries(((a.extra_info ?? []) as Json[]).map((x) => [text(x.title).toLowerCase(), text(x.body)]));
  const bills = (info.bills ?? '').toLowerCase();
  Object.assign(l, {
    type: sub.startsWith('ENTIRE') ? 'flat' : 'room',
    title: text(a.headline),
    // '€1,200/month': la coma es separador de miles.
    price: intFrom((info.price || text(a.marker?.label)).replace(/,/g, '')),
    expenses: bills.startsWith('included') ? 0 : null,
    municipality: String(a.city ?? ''),
    lat: Number(a.marker?.lat) || null,
    lon: Number(a.marker?.lng) || null,
    approximateLocation: true,
    roommates: /FLATMATE/.test(sub) ? intFrom(sub.split('·')[1]) : null,
    bedrooms: /BEDROOM/.test(sub) ? intFrom(sub.split('·')[1]) : null,
    surfaceM2: /M²|M2/.test(sub) ? intFrom(sub.split('·')[1]) : null,
    availableFrom: dmy(a.available_from),
    photo: String(a.pictures?.items?.[0]?.url ?? ''),
  } satisfies Partial<RawListing>);
  if (l.type === 'room') l.gender = inferGender(l.title);
  return l;
}

/** El token de invitado de badi.com: el mismo que recibe quien entra sin cuenta. */
async function guestToken(json: Net['json']): Promise<string> {
  const r = await json<{ access_token?: string }>({ url: 'https://badi.com/api/auth', direct: true });
  if (!r.access_token) throw new NetError('no guest token');
  return r.access_token;
}

export const badi: Source = {
  name: 'badi',
  label: 'Badi',
  types: ['room', 'flat'],
  net: { pause: [2, 4], blockedMarkers: [], minLength: 2 },
  planned: (q) => Math.max(q.areas.length, 1) * Math.min(q.pages, 2),
  async *search(q, net) {
    if (!q.city.portals.badi) return;
    const token = await guestToken(net.json);
    const headers = { Authorization: `Bearer ${token}` };
    const max = activeBudget(q.profile).max;
    const areas: (Area | null)[] = q.areas.length ? q.areas : [null];
    for (const area of areas) {
      const box = area ? boxAround(area.lat, area.lon) : (([w, n, e, s]) => ({ n, s, e, w }))(q.city.box);
      let next: string | null = null;
      for (let page = 1; page <= Math.min(q.pages, 2); page++) {
        let r: Json;
        try {
          r = await net.json<Json>({ url: searchUrl(box, max, next), headers });
        } catch (e) {
          // Por la extension, un error HTTP llega como 'blocked': si es la
          // segunda pagina (sin cuenta puede pedir iniciar sesion), basta con
          // la primera.
          if (page === 1 || (e instanceof NetError && e.reason === 'cancelled')) throw e;
          break;
        }
        if (r.error) break;
        const listings = ((r.data?.results ?? []) as Json[]).map(toListing)
          .filter((l): l is RawListing => !!l && l.type === q.type);
        yield { listings, label: `${area ? area.name.split(',')[0] + ' ' : ''}page ${page}` };
        next = r.data?.next_token ?? null;
        if (!next || (r.data?.results ?? []).length < PER_PAGE) break;
      }
    }
  },
  /** Si su buscador tiene algo dentro de la caja de la ciudad. */
  async discover(ctx: DiscoverCtx) {
    const auth = await ctx.json<{ access_token?: string }>({ url: 'https://badi.com/api/auth', direct: true });
    if (!auth?.access_token) return null;
    const [w, n, e, s] = ctx.city.box;
    const r = await ctx.json<Json>({ url: searchUrl({ n, s, e, w }, null, null, 1),
      headers: { Authorization: `Bearer ${auth.access_token}` } });
    return r?.data?.results?.length ? { ref: ctx.city.name } : null;
  },
};
