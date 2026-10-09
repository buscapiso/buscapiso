// Esquema normalizado: toda fuente devuelve RawListing y nada mas del motor
// necesita saber de que portal vino cada anuncio.

export type ListingType = 'room' | 'flat';
export type Gender = 'female_only' | 'male_only' | 'mixed' | 'unknown';
export type Group = 'accepted' | 'possible' | 'rejected';
export type Status =
  | 'new' | 'liked' | 'hidden' | 'contacted' | 'visit_scheduled' | 'visited'
  | 'applied' | 'got_it' | 'rejected' | 'discarded';
export const STATUSES: Status[] = ['new', 'liked', 'hidden', 'contacted', 'visit_scheduled',
  'visited', 'applied', 'got_it', 'rejected', 'discarded'];

/** Lo que dijo el portal. Ni puntuacion, ni trayectos, ni nada de la usuaria. */
export interface RawListing {
  source: string;
  sourceId: string;
  url: string;
  type: ListingType;
  title: string;
  price: number | null;
  expenses: number | null;          // null = el anuncio no lo dice
  address: string;
  neighbourhood: string;
  municipality: string;
  lat: number | null;
  lon: number | null;
  approximateLocation: boolean;
  gender: Gender;
  genderConfirmed: boolean;         // false = inferido del texto libre
  bedrooms: number | null;
  roommates: number | null;
  smokingAllowed: boolean | null;
  ownerLivesIn: boolean | null;
  visitsAllowed: boolean | null;
  publishedText: string;
  ageDays: number | null;
  roommateAges: string;
  roommateOccupation: string;
  atmosphere: string;
  couplesAllowed: boolean | null;
  exterior: boolean | null;
  minStayMonths: number | null;
  availableFrom: string;            // dd-mm-aaaa, como lo escriben los portales
  description: string;
  photo: string;
  detailRead: boolean;
  extraNotes: string;
  surfaceM2: number | null;
  bathrooms: number | null;
  floor: string;
  elevator: boolean | null;
  furnished: boolean | null;
}

/** Un anuncio guardado: lo del portal mas cuando y donde se vio. */
export interface StoredListing extends RawListing {
  id: string;
  city: string;
  firstSeen: string;
  lastSeen: string;
  missingSince?: string;
  /** Otros portales donde se vio el mismo piso (deduplicado). */
  alsoOn?: string[];
}

/** Lo que el motor calcula; se rehace al cambiar el perfil. */
export interface Derived {
  id: string;
  group: Group;
  rejectReason: string;
  score: number;
  reasons: string[];
  travel: Record<string, number>;
  routes: Record<string, string>;
  travelSource: string;
  summary: string;
  pros: string[];
  cons: string[];
  redFlags: string[];
  aiTemporary: boolean | null;
  /** Lo que la IA leyo en el texto, en palabras. */
  aiFacts?: { label: string; value: string; used: boolean }[];
  /** Por que la IA no lo leyo, o '' si lo leyo (o no habia IA). */
  aiNote?: string;
  alsoOn: string[];
}

export interface HistoryEntry { status: Status; note: string; at: string }
/** Lo que solo escribe la usuaria. */
export interface UserState { id: string; status: Status; note: string; history: HistoryEntry[] }

/** Peticion de una pagina a la extension (o a un doble en los tests). */
export interface FetchRequest {
  url: string;
  portal: string;
  blockedMarkers: string[];
  /** El portal ha vetado la conexion: no hay captcha que resolver. */
  fatalMarkers?: string[];
  readyMarkers?: string[];
  allowTab: boolean;
  timeoutMs?: number;
}
export type FetchResult =
  | { ok: true; html: string; finalUrl: string; via: 'fetch' | 'tab' }
  | { ok: false; reason: 'blocked' | 'banned' | 'timeout' | 'network' | 'not-allowed' | 'cancelled' };
export type FetchPage = (req: FetchRequest, onNeedsUser?: () => void) => Promise<FetchResult>;

export function emptyListing(source: string, sourceId: string, url: string): RawListing {
  return {
    source, sourceId, url, type: 'room', title: '', price: null, expenses: null, address: '',
    neighbourhood: '', municipality: '', lat: null, lon: null, approximateLocation: true,
    gender: 'unknown', genderConfirmed: false, bedrooms: null, roommates: null,
    smokingAllowed: null, ownerLivesIn: null, visitsAllowed: null, publishedText: '',
    ageDays: null, roommateAges: '', roommateOccupation: '', atmosphere: '',
    couplesAllowed: null, exterior: null, minStayMonths: null, availableFrom: '',
    description: '', photo: '', detailRead: false, extraNotes: '', surfaceM2: null,
    bathrooms: null, floor: '', elevator: null, furnished: null,
  };
}

export function emptyDerived(id: string): Derived {
  return { id, group: 'rejected', rejectReason: '', score: 0, reasons: [], travel: {},
    routes: {}, travelSource: '', summary: '', pros: [], cons: [], redFlags: [],
    aiTemporary: null, aiFacts: [], aiNote: '', alsoOn: [] };
}

/** Identificador estable entre ejecuciones, dispositivos y la version Python. */
export function listingId(source: string, sourceId: string): string {
  return sha1(`${source}:${sourceId}`).slice(0, 12);
}

// Gastos escritos en la descripcion: "gastos a parte (50-100€/mes)" cuenta la
// media. Solo cifras DESPUES de "gastos": la de delante suele ser el alquiler.
const BILLS = String.raw`(?:gastos|despeses|bills)[^.\n\d€]{0,40}?`;
const BILLS_RANGE = new RegExp(String.raw`${BILLS}(\d{2,3})\s*(?:€|eur\w*)?\s*(?:-|–|a|y|i)\s*(\d{2,3})\s*(?:€|eur)`, 'i');
const BILLS_ONE = new RegExp(String.raw`${BILLS}(\d{2,3})\s*(?:€|eur)`, 'i');
const BILLS_INCLUDED = /gastos\s+(?:est[aá]n\s+)?inclu[ií]d|incluye\s+(?:los\s+)?gastos|despeses\s+incloses|bills\s+included/i;

/** Gastos al mes segun el texto: 0 si estan incluidos, null si no lo dice. */
export function billsFromText(text: string): number | null {
  const r = text.match(BILLS_RANGE);
  if (r) return Math.round((+r[1] + +r[2]) / 2);
  const one = text.match(BILLS_ONE);
  if (one) return +one[1];
  return BILLS_INCLUDED.test(text) ? 0 : null;
}

/** Lo que pagas de verdad al mes con los gastos declarados. */
export function totalCost(l: Pick<RawListing, 'price' | 'expenses'>): number | null {
  return l.price === null ? null : l.price + (l.expenses ?? 0);
}

/** Lo que pagarias suponiendo gastos cuando no se declaran: callarlos no
 * debe dar ventaja frente al anuncio que si los dice. */
export function estimatedCost(l: Pick<RawListing, 'price' | 'expenses'>, assumed: number): number | null {
  return l.price === null ? null : l.price + (l.expenses ?? assumed);
}

/** Cuantos campos utiles trae. Decide cual gana al deduplicar. */
export function richness(l: RawListing): number {
  const fields = [l.lat, l.description, l.photo, l.roommates, l.bedrooms, l.expenses,
    l.roommateAges, l.availableFrom, l.couplesAllowed, l.surfaceM2];
  return fields.filter((f) => f !== null && f !== '').length + (l.genderConfirmed ? 3 : 0);
}

/** SHA-1 sincrono (crypto.subtle es asincrono y el id se usa en bucles). */
export function sha1(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  let [a, b, c, d, e] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 80; t++) {
      w[t] = t < 16 ? words[block + t] : rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    }
    let [A, B, C, D, E] = [a, b, c, d, e];
    for (let t = 0; t < 80; t++) {
      const [f, k] = t < 20 ? [(B & C) | (~B & D), 0x5a827999]
        : t < 40 ? [B ^ C ^ D, 0x6ed9eba1]
        : t < 60 ? [(B & C) | (B & D) | (C & D), 0x8f1bbcdc]
        : [B ^ C ^ D, 0xca62c1d6];
      const tmp = (rotl(A, 5) + f + E + k + w[t]) >>> 0;
      [E, D, C, B, A] = [D, C, rotl(B, 30) >>> 0, A, tmp];
    }
    a = (a + A) >>> 0; b = (b + B) >>> 0; c = (c + C) >>> 0; d = (d + D) >>> 0; e = (e + E) >>> 0;
  }
  return [a, b, c, d, e].map((x) => x.toString(16).padStart(8, '0')).join('');
}
