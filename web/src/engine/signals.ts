// Contexto de precio y señales de estafa, con reglas: funcionan sin IA y se
// pueden explicar. Se comparan los anuncios guardados de la ciudad entre si.
import { norm } from './cities/names';
import type { ListingType, StoredListing } from './model';

// Ojo: los portales solo dan lo que cabe en el presupuesto (se les pide con
// tope de precio), asi que esto NO es el precio de mercado de la zona: es como
// esta un anuncio entre los que te puedes permitir alli. Por eso se dice asi,
// y no hay "por encima de la zona": cerca del tope seria siempre "caro".
export interface PriceContext {
  /** Mediana de los anuncios dentro del presupuesto en la zona: euros al mes
   * o, en pisos con metros, euros por m². */
  median: number;
  /** Cuantos anuncios entran en la comparacion. */
  n: number;
  /** El barrio, o el municipio si el barrio tiene pocos. */
  place: string;
  /** Diferencia con esa mediana: -0.2 es un 20 % por debajo. */
  diff: number;
  /** Parte de esos anuncios que cuestan mas que este (0..1). */
  cheaperThan: number;
  perM2: boolean;
}

/** Menos anuncios que esto en una zona no dan una mediana de fiar. */
const MIN_SAMPLE = 6;
/** Un precio por debajo de esto no es un precio ("1 €", "consultar"). */
const MIN_PRICE = 50;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Por anuncio, como esta su precio entre los parecidos de su zona que caben
 * en el presupuesto (`maxPrice`, el alquiler: lo mismo que se pide a los
 * portales que lo admiten; los que no, traen de todo y se recortan aqui). */
export function priceContexts(ls: StoredListing[], type: ListingType, maxPrice: number): Map<string, PriceContext> {
  const value = (l: StoredListing): number | null => {
    if (l.type !== type || !l.price || l.price < MIN_PRICE || l.price > maxPrice) return null;
    if (type === 'flat') return l.surfaceM2 && l.surfaceM2 >= 15 ? l.price / l.surfaceM2 : null;
    return l.price;
  };
  const groups = new Map<string, { label: string; values: number[] }>();
  const add = (key: string, label: string, v: number) => {
    const g = groups.get(key) ?? { label, values: [] };
    g.values.push(v);
    groups.set(key, g);
  };
  for (const l of ls) {
    const v = value(l);
    if (v === null) continue;
    if (l.neighbourhood) add(`n:${norm(l.neighbourhood)}`, l.neighbourhood, v);
    if (l.municipality) add(`m:${norm(l.municipality)}`, l.municipality, v);
  }
  const out = new Map<string, PriceContext>();
  for (const l of ls) {
    const v = value(l);
    if (v === null) continue;
    const g = [l.neighbourhood ? groups.get(`n:${norm(l.neighbourhood)}`) : undefined,
      l.municipality ? groups.get(`m:${norm(l.municipality)}`) : undefined].find((x) => x && x.values.length >= MIN_SAMPLE);
    if (!g) continue;
    const m = median(g.values);
    out.set(l.id, { median: Math.round(m * 10) / 10, n: g.values.length, place: g.label, diff: v / m - 1,
      cheaperThan: g.values.filter((x) => x > v).length / g.values.length, perM2: type === 'flat' });
  }
  return out;
}

/** Que fotos aparecen en que zonas: la misma foto en dos sitios distintos es
 * una señal (en el mismo edificio, una agencia la repite y es normal). */
export function photoPlaces(ls: StoredListing[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of ls) {
    const place = norm(l.neighbourhood || l.municipality);
    if (!l.photo || !place) continue;
    if (!out.has(l.photo)) out.set(l.photo, new Set());
    out.get(l.photo)!.add(place);
  }
  return out;
}

// Las historias de siempre de las estafas de alquiler, en castellano, catalan
// e ingles. Una frase que no encaja aqui no se marca: mejor callar que acusar.
const STORIES: [string, RegExp][] = [
  ['Asks for payment before you visit', new RegExp(String.raw`(?:pag[oa]r?|transferencia|ingreso|fianza|dep[oó]sito|señal|reserva|pagament)`
    + String.raw`[^.]{0,40}(?:por (?:adelantado|anticipado)|antes de (?:ver|visitar)|sin (?:ver|visitar)|abans de veure)|`
    + String.raw`(?:pay|payment|deposit|transfer)[^.]{0,40}(?:in advance|before (?:seeing|viewing|visiting)|without (?:seeing|viewing))`, 'i')],
  ['Says the owner is abroad', new RegExp(String.raw`(?:estoy|vivo|me encuentro|resido|trabajo|soc|visc)(?: trabajando| viviendo)? `
    + String.raw`(?:en el extranjero|fuera de españa|a l'estranger|en (?:londres|inglaterra|reino unido|escocia|irlanda|francia|par[ií]s|`
    + String.raw`alemania|italia|estados unidos|ee\.?\s?uu\.?|canad[aá]))|(?:i am|i'm|i live|i work|currently)[^.]{0,20}`
    + String.raw`(?:abroad|out of the country|outside spain)`, 'i')],
  ['Keys sent by post or courier', /(?:llaves|claus|keys)[^.]{0,40}(?:correo|mensajer[ií]a|courier|by post|missatger|env[ií]o|te las env[ií]o)/i],
  ['Mentions a money transfer service', /western union|moneygram|\bria money\b|transferwise/i],
];

/** Lo que conviene comprobar antes de pagar nada, en frases cortas. */
export function scamSignals(l: StoredListing, ctx: PriceContext | undefined, photos: Map<string, Set<string>>): string[] {
  const text = `${l.title} ${l.description}`;
  const out = STORIES.filter(([, re]) => re.test(text)).map(([label]) => label);
  if (ctx && ctx.n >= 8 && ctx.diff <= -0.4) out.push(`Price is ${Math.round(-ctx.diff * 100)}% below other listings within your budget in ${ctx.place}`);
  if (l.photo && (photos.get(l.photo)?.size ?? 0) > 1) out.push('Same photo as a listing elsewhere');
  return out;
}
