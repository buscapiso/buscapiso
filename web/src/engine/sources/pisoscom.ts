// pisos.com: habitaciones y pisos, en HTML hecho en el servidor y con CORS
// abierto, asi que la web lo lee sin la extension (vale en iPad).
//
// Hechos comprobados contra el sitio real (2026-10-11):
// 1. /alquiler/{habitaciones|pisos}-{ciudad}/hasta-{precio}/fecharecientedesde-desc/{pagina}/
//    El tope de precio admite un margen: 'hasta-500' trae alguna de 550.
// 2. La ciudad es 'barcelona_capital' para las capitales ('barcelona' es la
//    provincia) y 'armilla' para el resto. Granada redirige a un nombre largo.
// 3. Pasada la ultima pagina, repite la ultima: se para cuando no hay
//    "pagina siguiente".
// 4. Las tarjetas no traen coordenadas ni dicen quien vive en el piso.
import { emptyListing, type ListingType, type RawListing } from '../model';
import { sameName } from '../cities/names';
import { activeBudget } from '../budget';
import { getText, inferGender, intFrom, NetError, parseHtml, type DiscoverCtx, type Source } from './base';

const BASE = 'https://www.pisos.com';

export function buildUrl(city: string, type: ListingType, page = 1, maxPrice: number | null = null): string {
  let url = `${BASE}/alquiler/${type === 'room' ? 'habitaciones' : 'pisos'}-${city}/`;
  if (maxPrice) url += `hasta-${maxPrice}/`;
  url += 'fecharecientedesde-desc/';
  return page > 1 ? `${url}${page}/` : url;
}

/** 'El Putxet-El Farró (Distrito Sarrià-Sant Gervasi. Barcelona Capital)'
 * -> ['El Putxet-El Farró', 'Barcelona']; 'Mira-sol (Sant Cugat del Vallès)'
 * -> ['Mira-sol', 'Sant Cugat del Vallès']; 'Barcelona Capital' -> ['', 'Barcelona']. */
export function place(subtitle: string): [string, string] {
  const m = subtitle.match(/^(.*?)\s*\((.*)\)\s*$/);
  const clean = (s: string) => s.replace(/\s+Capital$/i, '').trim();
  if (!m) return ['', clean(subtitle)];
  const inside = m[2].split('.').map((x) => x.trim()).filter(Boolean);
  return [m[1].trim(), clean(inside.at(-1) ?? '')];
}

export function parseList(html: string, type: ListingType): RawListing[] {
  const doc = parseHtml(html);
  const out: RawListing[] = [];
  for (const card of doc.querySelectorAll('div.ad-preview[id][data-lnk-href]')) {
    const path = card.getAttribute('data-lnk-href') ?? '';
    const l = emptyListing('pisoscom', card.id, BASE + path);
    l.type = type;
    l.title = getText(card.querySelector('.ad-preview__title'));
    l.price = intFrom(card.querySelector('[data-ad-price]')?.getAttribute('data-ad-price'))
      ?? intFrom(getText(card.querySelector('.ad-preview__price')));
    [l.neighbourhood, l.municipality] = place(getText(card.querySelector('.ad-preview__subtitle')));
    // 'Habitación en Carrer de Calàbria, 103': la calle, si no es el barrio.
    const where = l.title.replace(/^[^,]*?\sen\s/i, '').trim();
    if (where && where !== l.title && !sameName(where, l.neighbourhood)) l.address = where;
    for (const c of card.querySelectorAll('.ad-preview__char')) {
      const t = getText(c);
      if (/hab/.test(t)) l.bedrooms = intFrom(t);
      else if (/ba[ñn]o/.test(t)) l.bathrooms = intFrom(t);
      else if (/m²|m2/.test(t)) l.surfaceM2 = intFrom(t);
      else if (/planta|bajo|[áa]tico/i.test(t)) l.floor = t;
    }
    l.description = getText(card.querySelector('.ad-preview__description'));
    const img = card.querySelector('.carousel__main-photo img');
    l.photo = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
    if (type === 'room') l.gender = inferGender(`${l.title} ${l.description}`);
    out.push(l);
  }
  return out;
}

const hasNext = (html: string) => html.includes('pagination__next');

export const pisoscom: Source = {
  name: 'pisoscom',
  label: 'pisos.com',
  types: ['room', 'flat'],
  net: { pause: [2, 5], blockedMarkers: ['captcha-delivery'], minLength: 5000, direct: true },
  planned: (q) => q.pages,
  async *search(q, net) {
    const city = q.city.portals.pisoscom;
    if (!city) return;
    // En escalones de 50, como su propio buscador.
    const max = Math.ceil(activeBudget(q.profile).max / 50) * 50;
    for (let page = 1; page <= q.pages; page++) {
      let html: string;
      try {
        html = (await net.page(buildUrl(city, q.type, page, max))).body;
      } catch (e) {
        if (page > 1 && e instanceof NetError && e.reason.startsWith('network')) return;
        throw e;
      }
      yield { listings: parseList(html, q.type), label: `page ${page}` };
      if (!hasNext(html)) return;
    }
  },
  /** 'granada_capital' o 'armilla': la pagina se llama "Alquiler de pisos en X". */
  async discover(ctx: DiscoverCtx) {
    for (const s of ctx.slugs.map((x) => x.replace(/-/g, '_'))) {
      for (const g of [`${s}_capital`, s]) {
        const r = await ctx.page(`${BASE}/alquiler/pisos-${g}/`);
        const h1 = r && getText(parseHtml(r.html).querySelector('h1'));
        const name = h1?.match(/Alquiler de pisos en\s+(.+)$/i)?.[1] ?? '';
        if (name && sameName(name, ctx.city.name)) return { ref: g };
      }
    }
    return null;
  },
};
