// Idealista: URL, parser de listado y parser de ficha.
//
// Hechos comprobados contra el sitio real:
// 1. Sin navegador real, DataDome devuelve geo.captcha-delivery.com. Desde la
//    extension, fetch() da 403 y hay que pasar por una pestaña donde la
//    persona resuelve el captcha.
// 2. "sexo_chica" significa "admite chicas", no "solo chicas": el filtro
//    estricto se aplica en local sobre el genero.
// 3. Los listados NO traen coordenadas: se geocodifica la direccion del titulo.
import { emptyListing, type Gender, type ListingType, type RawListing } from '../model';
import type { SearchProfile } from '../profiles';
import { getText, parseHtml, type Area, type Source } from './base';

const BASE = 'https://www.idealista.com';

// Vocabulario real de filtros. El orden importa: idealista lo normaliza asi y
// cambiarlo provoca redirecciones.
const FILTERS: [keyof SearchProfile['idealista'] | 'women', (v: unknown) => string | null][] = [
  ['max_price', (v) => `precio-hasta_${v}`],
  ['women', (v) => (v ? 'sexo_chica' : null)],
  ['no_live_in_owner', (v) => (v ? 'pisos-compartido-sin-propietario' : null)],
  ['with_students', (v) => (v ? 'compartidos_con-estudiantes' : null)],
  ['with_workers', (v) => (v ? 'compartidos_con-trabajadores' : null)],
  ['exterior', (v) => (v ? 'exterior' : null)],
  ['non_smokers', (v) => (v ? 'fumadores_no' : null)],
  ['last_48h', (v) => (v ? 'publicado_ultimas-48-horas' : null)],
];
const SORTS: Record<string, string | null> = {
  newest: 'fecha-publicacion-desc', cheapest: 'precios-asc', relevance: null,
};

/** URL de busqueda. Los filtros nativos solo existen para habitaciones. */
export function buildUrl(slug: string, page = 1, sort = 'relevance',
  filters: Record<string, unknown> = {}, type: ListingType = 'room'): string {
  const parts: string[] = [];
  if (type === 'room') {
    for (const [key, fn] of FILTERS) {
      const v = filters[key];
      if (v) {
        const slugPart = fn(v);
        if (slugPart) parts.push(slugPart);
      }
    }
  } else if (filters.max_price) {
    parts.push(`precio-hasta_${filters.max_price}`);
  }
  let url = `${BASE}/${type === 'room' ? 'alquiler-habitacion' : 'alquiler-viviendas'}/${slug}/`;
  if (parts.length) url += `con-${parts.join(',')}/`;
  if (page > 1) url += `pagina-${page}.htm`;
  const s = SORTS[sort];
  if (s) url += `?ordenado-por=${s}`;
  return url;
}

/** Idealista marca el genero con una clase en el icono: es dato publicado. */
function gender(art: Element): [Gender, boolean] {
  const icon = art.querySelector('.icon-sex-circle');
  if (!icon) return ['unknown', false];
  for (const [cls, g] of [['girl', 'female_only'], ['boy', 'male_only'], ['both', 'mixed']] as const) {
    if (icon.classList.contains(cls)) return [g, true];
  }
  return ['unknown', false];
}

const TITLE_PREFIX = /^\s*(?:Habitaci[oó]n|Piso|[ÁA]tico|Estudio|D[uú]plex|Chalet|Casa|Loft|Apartamento)\b[^,]*?\s+en\s+/i;

/** 'Habitacion en Calle de Casp, 110, El Fort Pienc, Barcelona'
 * -> ['Calle de Casp, 110', 'El Fort Pienc', 'Barcelona'] */
export function addressParts(title: string): [string, string, string] {
  const body = title.replace(TITLE_PREFIX, '').trim();
  const parts = body.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return [parts.slice(0, -2).join(', '), parts.at(-2)!, parts.at(-1)!];
  if (parts.length === 2) return ['', parts[0], parts[1]];
  return ['', '', parts[0] ?? ''];
}

export function parseList(html: string, type: ListingType = 'room'): RawListing[] {
  const doc = parseHtml(html);
  const out: RawListing[] = [];
  for (const art of doc.querySelectorAll('article.item')) {
    const id = art.getAttribute('data-element-id');
    const link = art.querySelector('a.item-link');
    if (!id || !link) continue;
    const title = (link.getAttribute('title') || getText(link)).trim();
    const [address, neighbourhood, municipality] = addressParts(title);
    const l = emptyListing('idealista', id, BASE + (link.getAttribute('href') ?? ''));
    Object.assign(l, { type, title, address, neighbourhood, municipality });

    const priceEl = art.querySelector('.item-price');
    if (priceEl) {
      const m = getText(priceEl).replace(/\./g, '').match(/(\d[\d.]*)/);
      if (m) l.price = parseInt(m[1], 10);
    }
    // Sin el texto de gastos, el anuncio no los declara (null), que no es lo
    // mismo que "gastos incluidos" (0).
    const extra = art.querySelector('.item-price-extra-charges');
    if (extra) {
      const m = getText(extra).match(/\+\s*(\d+)\s*€/);
      if (m) l.expenses = parseInt(m[1], 10);
    }
    for (const det of art.querySelectorAll('.item-detail-char .item-detail')) {
      const txt = getText(det).replace(/ /g, ' ');
      const low = txt.toLowerCase();
      let m: RegExpMatchArray | null;
      if ((m = txt.match(/(\d+)\s*hab/))) l.bedrooms = parseInt(m[1], 10);
      else if (txt.includes('chic')) {
        if ((m = txt.match(/^(\d+)\s/))) l.roommates = parseInt(m[1], 10);
      } else if (low.includes('fumar')) l.smokingAllowed = !low.includes('no se puede');
      else if (/^\d{1,2}\s+[\p{L}\p{N}_]{3}$/u.test(txt)) l.publishedText = txt;
      else if (type === 'flat') {
        // Formatos vistos en una pagina real (2026-10-09): "80 m²",
        // "3ª planta exterior con ascensor", "Entreplanta interior con
        // ascensor", "exterior con ascensor" (sin planta), "5 horas" y
        // "45 minutos" (publicado hoy).
        if ((m = txt.match(/^(\d+)\s*m²$/))) l.surfaceM2 = parseInt(m[1], 10);
        else if ((m = txt.match(/^(\d+)\s+(?:horas?|minutos?)$/))) { l.publishedText = txt; l.ageDays = 0; }
        else if (/ascensor|exterior|interior|planta|bajo/i.test(txt)) {
          const floor = txt.split(/\s*\b(?:exterior|interior|con|sin)\b/i)[0].trim();
          if (floor) l.floor = floor;
          if (/\bexterior\b/i.test(txt)) l.exterior = true;
          else if (/\binterior\b/i.test(txt)) l.exterior = false;
          if (/con ascensor/i.test(txt)) l.elevator = true;
          else if (/sin ascensor/i.test(txt)) l.elevator = false;
        }
      }
    }
    // Un estudio no dice "hab.": no tiene dormitorio aparte.
    if (type === 'flat' && l.bedrooms === null && /^\s*Estudio\b/i.test(title)) l.bedrooms = 0;
    [l.gender, l.genderConfirmed] = type === 'room' ? gender(art) : ['unknown', false];
    l.description = getText(art.querySelector('.item-description'));
    // La foto real vive en el CDN img*.idealista.com; los iconos, en st3.
    const img = [...art.querySelectorAll('img')].find((i) => (i.getAttribute('src') ?? '').includes('//img'));
    l.photo = img?.getAttribute('src') ?? '';
    out.push(l);
  }
  return out;
}

// --- ficha de detalle ---------------------------------------------------
// Idealista no tiene un campo "se permiten visitas"; lo mas cercano son las
// normas y la frase libre de "Ambiente". El castellano inclusivo
// ("propietario/a") rompe las palabras por la barra.
const W = String.raw`[\p{L}\p{N}_]`;
const OWNER_OUT = new RegExp(String.raw`propietari${W}*(?:/${W}+)?\s+no\s+vive`, 'iu');
const OWNER_IN = new RegExp(String.raw`propietari${W}*(?:/${W}+)?\s+(?:si\s+)?vive\s+en`, 'iu');
// Norma explicita, no costumbre: "no suelen tener visitas" va a `atmosphere`.
const NO_GUESTS = new RegExp(String.raw`no\s+se\s+(?:admiten|permiten)\s+visitas|prohibid${W}+\s+(?:las\s+)?visitas`, 'iu');
const GUESTS = /(?<!no\s)se\s+(?:admiten|permiten)\s+visitas/i;
const AGES = /[Ee]ntre\s+(\d{2})\s+y\s+(\d{2})\s+a[nñ]os/;
const MIN_STAY = /[Ee]stancia\s+m[ií]nima\s+de\s+(\d+)\s+mes/i;
const AVAILABLE = /[Dd]isponible\s+a\s+partir\s+de\s+(\d{2}-\d{2}-\d{4})/;

/** Items de una seccion de la ficha ('Normas de la casa', etc.). */
function section(doc: Document, title: string): string[] {
  for (const h of doc.querySelectorAll('h2, h3')) {
    if (getText(h, '').toLowerCase().startsWith(title.toLowerCase())) {
      const next = h.nextElementSibling;
      if (next) return getText(next, '|').split('|').map((x) => x.trim()).filter(Boolean);
    }
  }
  return [];
}

/** Solo lo que encuentra: lo ausente no pisa el anuncio. */
export function parseDetail(html: string): Partial<RawListing> {
  const doc = parseHtml(html);
  const pageText = getText(doc);
  const d: Partial<RawListing> = { detailRead: true };
  const mates = section(doc, 'Tus compa');
  const rules = section(doc, 'Normas de la casa');
  const room = [...section(doc, 'Caracter'), ...section(doc, 'Est')];
  const all = [...mates, ...rules, ...room].join(' ') + ' ' + pageText;

  if (OWNER_OUT.test(all)) d.ownerLivesIn = false;
  else if (OWNER_IN.test(all)) d.ownerLivesIn = true;
  if (NO_GUESTS.test(all)) d.visitsAllowed = false;
  else if (GUESTS.test(all)) d.visitsAllowed = true;
  if (rules.length) {
    d.couplesAllowed = !rules.some((n) => n.toLowerCase().includes('no se admiten parejas'));
    if (rules.some((n) => n.toLowerCase().includes('no se puede fumar'))) d.smokingAllowed = false;
  }
  for (const item of mates) {
    const m = item.match(AGES);
    if (m) d.roommateAges = `${m[1]}-${m[2]}`;
    else if (item.toLowerCase().includes('estudian') || item.toLowerCase().includes('trabajan')) d.roommateOccupation = item;
    else if (item.toLowerCase().startsWith('ambiente')) d.atmosphere = item;
  }
  if (room.some((x) => x.toLowerCase().includes('ventana a la calle') || x.toLowerCase().includes('exterior'))) d.exterior = true;
  let m = all.match(MIN_STAY);
  if (m) d.minStayMonths = parseInt(m[1], 10);
  m = all.match(AVAILABLE);
  if (m) d.availableFrom = m[1];
  // En orden de preferencia: ".detail-info" es la cabecera de navegacion.
  for (const sel of ['.adCommentsLanguage', '.comment']) {
    const body = doc.querySelector(sel);
    if (body) {
      const t = getText(body);
      if (t.length > 40) { d.description = t; break; }
    }
  }
  return d;
}

export const idealista: Source = {
  name: 'idealista',
  types: ['room', 'flat'],
  pause: [3, 8],
  blockedMarkers: ['geo.captcha-delivery.com', 'captcha-delivery'],
  // Visto el 2026-10-09 tras resolver un captcha desde un navegador
  // automatizado: "Se ha detectado un uso indebido. El acceso se ha
  // bloqueado". En el iframe de DataDome, t=bv es veto y t=fe, captcha.
  fatalMarkers: ['Se ha detectado un uso indebido', 'El acceso se ha bloqueado', '&t=bv&'],
  minLength: 5000,
  perArea: true,
  pageSize: 25,
  listUrl(area: Area | null, p: SearchProfile, page: number) {
    if (!area?.idealista) return null;
    const filters = { ...p.idealista, women: p.household.gender === 'female_only' };
    return buildUrl(area.idealista, page, p.crawl.sort, filters, p.listing_type);
  },
  parseList,
  detailRequest: (l) => ({ url: l.url }),
  parseDetail,
};
