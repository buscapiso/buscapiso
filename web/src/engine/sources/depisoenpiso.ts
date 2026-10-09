// De Piso en Piso. Portal pequeño con coordenadas exactas.
//
// Su pagina de busqueda se pinta con JavaScript a partir de dos endpoints
// JSON que admiten CORS, asi que la web los pide directamente, sin la
// extension, y funciona tambien en iPad:
//   find-places.php?get_properties=true&city=X  -> todos los anuncios
//   alojamiento.php (POST id=...)                -> la ficha, con la descripcion
// El listado no dice quien vive en el piso: la señal esta en la descripcion
// ("Busquem només 2 Noies"), por eso se leen todas las fichas.
import { emptyListing, type RawListing } from '../model';
import { inferGender, type Source } from './base';

const BASE = 'https://www.depisoenpiso.com';
const DEFAULT_PHOTO = 'default_room.png';

export function buildUrl(city = 'Barcelona'): string {
  return `${BASE}/new-assets/php/find-places.php?get_properties=true&city=${encodeURIComponent(city)}`;
}

type Json = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any

/** '2026/11/01' o '2026-11-01 00:00:00' -> '01-11-2026', como los demas portales. */
function dmy(date: string | undefined): string {
  const m = (date ?? '').match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function ageDays(date: string | undefined, now: Date): number | null {
  const m = (date ?? '').match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export function parseList(body: string, now = new Date()): RawListing[] {
  let places: Json[];
  try {
    places = JSON.parse(body).places ?? [];
  } catch {
    return [];
  }
  return places.filter((p) => p?.id).map((p) => {
    const l = emptyListing('depisoenpiso', String(p.id), `${BASE}/alojamiento.html?prop=${p.id}`);
    const lat = num(p.lat), lon = num(p.lng);
    Object.assign(l, {
      type: String(p.what_rent ?? '').includes('all_house') ? 'flat' : 'room',
      title: p.street ? `Habitación en ${p.street}` : 'Habitación',
      price: num(p.monthly_rent) === null ? null : Math.trunc(num(p.monthly_rent)!),
      address: p.street ?? '',
      municipality: p.city ?? '',
      lat, lon, approximateLocation: lat === null,
      bedrooms: num(p.rooms),
      couplesAllowed: p.couples === 'yes' ? true : p.couples === 'no' ? false : null,
      availableFrom: dmy(p.available_from),
      ageDays: ageDays(p.recientes, now),
      photo: String(p.image ?? '').includes(DEFAULT_PHOTO) ? '' : (p.image ?? ''),
    } satisfies Partial<RawListing>);
    l.gender = inferGender(`${l.title} ${l.address}`);
    return l;
  });
}

/** La ficha: la descripcion es donde el anunciante dice si es piso de chicas. */
export function parseDetail(body: string): Partial<RawListing> {
  let d: Json;
  try {
    d = JSON.parse(body);
  } catch {
    return {};
  }
  if (String(d.status) !== '200') return {};
  const description = String(d.description || d.user_description || '').trim();
  return { detailRead: true, ...(description.length > 20 ? { description } : {}) };
}

export const depisoenpiso: Source = {
  name: 'depisoenpiso',
  types: ['room'],
  pause: [1, 2],
  blockedMarkers: [],
  minLength: 10,
  perArea: false,
  pageSize: Number.MAX_SAFE_INTEGER,   // una sola respuesta con todo
  direct: true,
  detailsForAll: true,
  listUrl: (_area, _p, page) => (page === 1 ? buildUrl('Barcelona') : null),
  parseList: (body, type) => parseList(body).filter((l) => l.type === type),
  detailRequest: (l) => ({ url: `${BASE}/new-assets/php/alojamiento.php`, form: { id: l.sourceId } }),
  parseDetail,
};
