// Roomgo (antes EasyPiso), especialista en habitaciones. Publica el genero
// del piso como dato ("2 compañeros de piso - mixto"). No usa filtros de URL:
// se pagina con ?page=N y se filtra en local.
import { emptyListing, type Gender, type RawListing } from '../model';
import { getText, inferGender, parseHtml, type Source } from './base';

const BASE = 'https://www.roomgo.es';
const GENDERS: [string, Gender][] = [
  ['mixto', 'mixed'], ['chicas', 'female_only'], ['mujeres', 'female_only'],
  ['femenino', 'female_only'], ['chicos', 'male_only'], ['hombres', 'male_only'],
  ['masculino', 'male_only'],
];

export function buildUrl(city = 'barcelona', page = 1): string {
  const url = `${BASE}/${city}/piso-compartido-${city}`;
  return page > 1 ? `${url}?page=${page}` : url;
}

/** '2 compañeros de piso - mixto' -> ['mixed', true, 2] */
function genderAndMates(text: string): [Gender, boolean, number | null] {
  const m = text.match(/(\d+)\s+compa[nñ]er/);
  const mates = m ? parseInt(m[1], 10) : null;
  const low = text.toLowerCase();
  for (const [word, g] of GENDERS) if (low.includes(word)) return [g, true, mates];
  return ['unknown', false, mates];
}

export function parseList(html: string): RawListing[] {
  const doc = parseHtml(html);
  const out: RawListing[] = [];
  for (const card of doc.querySelectorAll('.listing_item')) {
    let path = card.getAttribute('data-url') || '';
    if (!path) path = card.querySelector('a[href]')?.getAttribute('href') ?? '';
    if (!path) continue;
    const id = path.replace(/\/+$/, '').split('/').at(-1)!;
    const l = emptyListing('roomgo', id, path.startsWith('/') ? BASE + path : path);
    const priceEl = card.querySelector('.listing_item_price');
    if (priceEl) {
      // "1.050 € por mes": el punto es separador de miles.
      const m = getText(priceEl).match(/([\d.]+)\s*€/);
      if (m) l.price = parseInt(m[1].replace(/\./g, ''), 10);
    }
    l.title = getText(card.querySelector('.listing_item_details .heading'));
    for (const div of card.querySelectorAll('.listing_item_details > div')) {
      const t = getText(div);
      if (t && t !== l.title && !t.includes('Disponible') && t.length > 40) { l.description = t; break; }
    }
    const addr = card.querySelector('.listing_item_address');
    if (addr) {
      const parts = getText(addr).split(',').map((p) => p.trim());
      l.address = parts[0] ?? '';
      l.neighbourhood = parts.length > 1 ? parts.at(-1)! : '';
    }
    l.municipality = 'Barcelona';
    const mates = card.querySelector('.listing_item_nb_flatmates');
    if (mates) [l.gender, l.genderConfirmed, l.roommates] = genderAndMates(getText(mates));
    if (l.gender === 'unknown') { l.gender = inferGender(`${l.title} ${l.description}`); l.genderConfirmed = false; }
    const when = card.querySelector('.listing_item_when_available');
    if (when) {
      const t = getText(when);
      l.availableFrom = t.toLowerCase().includes('ahora') ? 'ahora' : t;
      l.publishedText = l.availableFrom;
    }
    // El src es un pixel base64 de carga diferida; la foto va en data-src.
    const photo = card.querySelector('img')?.getAttribute('data-src') ?? '';
    l.photo = photo.startsWith('data:') ? '' : photo;
    out.push(l);
  }
  return out;
}

export const roomgo: Source = {
  name: 'roomgo',
  types: ['room'],
  pause: [3, 7],
  blockedMarkers: ['captcha-delivery'],
  minLength: 5000,
  perArea: false,
  pageSize: 1,
  listUrl: (_area, _p, page) => buildUrl('barcelona', page),
  parseList: (html) => parseList(html),
};
