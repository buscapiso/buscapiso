// Filtrado duro y puntuacion explicable. Ninguna puntuacion sin motivo: cada
// anuncio sale con la lista de por que suma y por que resta, para poder
// discutirle el criterio a la herramienta.
//
// Traduccion literal de ranking.py; los textos de los motivos son los mismos,
// con el mismo formato de numeros que Python (redondeo al par, "-0").
import { estimatedCost, type Gender, type RawListing } from './model';
import { activeBudget, DEFAULT_WEIGHTS, type SearchProfile } from './profiles';

export interface Scorable extends RawListing {
  id: string;
  travel: Record<string, number>;
  aiTemporary?: boolean | null;
  redFlags?: string[];
}
export interface Scored { score: number; reasons: string[] }

// --- numeros con el formato de Python ------------------------------------
/** Redondeo de Python: al par en los empates exactos. */
export function pyRound(x: number, digits = 0): number {
  // Sobre la expansion decimal exacta del valor binario (toFixed es exacto):
  // 87.35 es 87.34999... y baja, aunque 87.35 * 10 de 873.5 justo.
  const [ip, fp = ''] = Math.abs(x).toFixed(digits + 40).split('.');
  let n = BigInt(ip + fp.slice(0, digits));
  const rest = fp.slice(digits);
  if (rest[0] > '5' || (rest[0] === '5' && /[1-9]/.test(rest.slice(1)))) n += 1n;
  else if (rest[0] === '5' && n % 2n === 1n) n += 1n;
  const r = Number(n) / 10 ** digits;
  return x < 0 ? -r : r;
}
/** f"{x:.0f}", y f"{x:+.0f}" si signed. Python escribe "-0" para -0,4 y -0.0. */
export function fmt0(x: number, signed = false): string {
  const body = String(Math.abs(pyRound(x)));
  const neg = x < 0 || Object.is(x, -0);
  return neg ? `-${body}` : signed ? `+${body}` : body;
}

const YOUNG = /estudiant|j[oó]ven|joven|profesional|trabajador|erasmus|universitari/i;
const QUIET = /no\s+suelen\s+tener\s+visitas|abunda\s+el\s+silencio/i;
const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre';
// "de octubre a diciembre" es un alquiler temporal aunque no diga "temporada".
const SHORT_LET = new RegExp(String.raw`solo\s+temporada|turis|d[ií]as\s+sueltos|` +
  String.raw`de\s+(${MONTHS})\s+a\s+(${MONTHS})|` +
  String.raw`(?:solo|s[oó]lo|[uú]nicamente)\s+(?:hasta|por)\s+\d+\s+mes`, 'i');
const NO_GUESTS = /no\s+se\s+(permiten|admiten)\s+visitas|prohibid[\p{L}\p{N}_]+\s+(las\s+)?visitas/iu;
const GUESTS = /se\s+(permiten|admiten)\s+visitas/i;

const GENDER_TEXT: Record<string, string> = { female_only: 'women only', male_only: 'men only', mixed: 'mixed' };
const FLAT_GENDER: Record<string, string> = { female_only: 'women-only flat', male_only: 'men-only flat', mixed: 'mixed flat' };
const TYPE_TEXT = { room: 'a room in a shared flat', flat: 'a whole flat' };
const MIN_FLAT_SURFACE = 15;

const text = (l: RawListing) => `${l.title} ${l.description}`;

function published(l: RawListing): string {
  if (l.ageDays !== null) {
    return l.ageDays === 0 ? 'posted today' : l.ageDays === 1 ? 'posted 1 day ago' : `posted ${l.ageDays} days ago`;
  }
  return 'posted recently';
}

/** Motivo para dejar fuera un piso entero, o null. Lo que el anuncio no dice
 * no descarta: Fotocasa solo pone "ascensor" cuando lo hay. */
function flatFilter(l: RawListing, p: SearchProfile): string | null {
  // Habitaciones anunciadas como piso: 450 EUR y 9 m2 en "alquiler viviendas".
  if (l.surfaceM2 !== null && l.surfaceM2 < MIN_FLAT_SURFACE) return `${l.surfaceM2} m², looks like a single room`;
  const min = p.flat.min_bedrooms || 0;
  if (l.bedrooms !== null && l.bedrooms < min) return `${l.bedrooms} bedroom${l.bedrooms !== 1 ? 's' : ''}, you want ${min}+`;
  const m2 = p.flat.min_surface_m2;
  if (m2 && l.surfaceM2 !== null && l.surfaceM2 < m2) return `${l.surfaceM2} m², you want ${m2}+`;
  if (p.flat.elevator_required && l.elevator === false) return 'no lift';
  if (p.flat.furnished === 'yes' && l.furnished === false) return 'unfurnished';
  if (p.flat.furnished === 'no' && l.furnished === true) return 'furnished';
  return null;
}

export interface Filtered<T> { accepted: T[]; possible: T[]; rejected: [T, string][] }

/** "Posibles": cumplen todo menos que el portal no publica el genero. Se
 * resuelve con un mensaje; van aparte, y solo si puntuan bien. */
export function filter<T extends Scorable>(listings: T[], p: SearchProfile, discarded = new Set<string>()): Filtered<T> {
  const out: Filtered<T> = { accepted: [], possible: [], rejected: [] };
  const budget = activeBudget(p);
  const excluded = p.zones.exclude.map((z) => z.toLowerCase());
  const flat = p.listing_type === 'flat';
  const limited = p.destinations.filter((d) => d.max_minutes !== null);
  for (const l of listings) {
    const reject = (why: string) => out.rejected.push([l, why]);
    if (discarded.has(l.id)) { reject('you discarded it before'); continue; }
    if (l.type !== p.listing_type) { reject(`${TYPE_TEXT[l.type]}, not ${TYPE_TEXT[p.listing_type]}`); continue; }
    let doubtful = false;
    // En un piso entero no hay con quien convivir.
    const gender: Gender | 'any' = flat ? 'any' : p.household.gender;
    if (gender !== 'any' && l.gender !== gender) {
      if (l.gender === 'unknown' && p.household.ask_if_gender_unknown) doubtful = true;
      else {
        reject(l.gender === 'unknown' ? "the listing doesn't say who lives there"
          : `${FLAT_GENDER[l.gender] ?? l.gender}, not ${GENDER_TEXT[gender]}`);
        continue;
      }
    }
    const est = estimatedCost(l, budget.assumed);
    if (est === null) { reject('no price'); continue; }
    if (est > budget.max) { reject(`${est} € a month in total, above your maximum`); continue; }
    if (flat) {
      const why = flatFilter(l, p);
      if (why) { reject(why); continue; }
    } else if (p.household.no_live_in_owner && l.ownerLivesIn === true) {
      reject('the owner lives in the flat'); continue;
    } else if (p.household.visits === 'strict') {
      if (l.visitsAllowed === false || NO_GUESTS.test(text(l))) { reject('no guests allowed'); continue; }
    }
    if (limited.some((d) => !(d.name in l.travel))) { reject('no usable location'); continue; }
    const far = limited.find((d) => l.travel[d.name] > d.max_minutes!);
    if (far) { reject(`${fmt0(l.travel[far.name])} min to ${far.name}`); continue; }
    const zone = (l.neighbourhood || l.municipality).toLowerCase();
    if (excluded.some((e) => zone.includes(e))) { reject(`neighbourhood you excluded: ${l.neighbourhood || l.municipality}`); continue; }
    (doubtful ? out.possible : out.accepted).push(l);
  }
  return out;
}

const DMY = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
function parseDmy(s: string): Date | null {
  const m = s.match(DMY);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1 ? d : null;
}

/** Puntuacion y su desglose. `today` en formato aaaa-mm-dd. */
export function score(l: Scorable, p: SearchProfile, today: string): Scored {
  const w = { ...DEFAULT_WEIGHTS, ...p.weights };
  const budget = activeBudget(p);
  const reasons: string[] = [];
  let total = 100;

  // Trayectos: cada destino resta segun su propio peso por minuto.
  for (const d of p.destinations) {
    const minutes = l.travel[d.name];
    if (minutes === undefined) continue;
    const penalty = Math.max(0, minutes - w.minutos_gratis) * d.minute_weight;
    total -= penalty;
    reasons.push(`${fmt0(minutes)} min to ${d.name} (${fmt0(-penalty, true)})`);
  }
  // Dinero: penaliza lo que pasa del coste ideal, no el precio absoluto.
  const est = estimatedCost(l, budget.assumed);
  if (est !== null) {
    const penalty = Math.max(0, est - budget.ideal) * w.euro_sobre_ideal;
    total -= penalty;
    const label = l.expenses ? `${l.price} € + ${l.expenses} € bills = ${est} € a month`
      : l.expenses === 0 ? `${l.price} € bills included`
      : `${l.price} € + bills not stated (counting ~${budget.assumed} €) = ${est} € a month`;
    reasons.push(`${label} (${fmt0(-penalty, true)})`);
  }
  if (l.expenses === 0) {
    total += w.gastos_incluidos;
    reasons.push(`bills included (+${fmt0(w.gastos_incluidos)})`);
  }
  // Novedad: llegar el primero vale mas que el filtro perfecto. Si el portal
  // da la antiguedad, manda ella.
  if (l.ageDays !== null) {
    if (l.ageDays <= w.dias_para_ser_nuevo) {
      total += w.novedad;
      reasons.push(`${published(l)} (+${fmt0(w.novedad)})`);
    } else if (l.ageDays >= w.dias_para_estar_rancio) {
      total -= w.rancio;
      reasons.push(`${published(l)}, probably already let (-${fmt0(w.rancio)})`);
    }
  } else if (l.publishedText) {
    // Idealista solo muestra fecha en los anuncios recientes.
    total += w.novedad;
    reasons.push(`${published(l)} (+${fmt0(w.novedad)})`);
  }
  const flat = l.type === 'flat';
  if (!flat && YOUNG.test(text(l))) {
    total += w.ambiente_joven;
    reasons.push(`young people or students (+${fmt0(w.ambiente_joven)})`);
  }
  if (SHORT_LET.test(text(l))) {
    total -= w.temporal;
    reasons.push(`looks like a short or seasonal let (-${fmt0(w.temporal)})`);
  } else if (l.aiTemporary === true) {
    total -= w.temporal;
    reasons.push(`AI: looks like a short or seasonal let (-${fmt0(w.temporal)})`);
  }
  for (const flag of l.redFlags ?? []) reasons.push(`AI warning: ${flag}`);

  if (flat) total += flatScore(l, p, w, reasons);
  else if (l.roommates && l.roommates > w.companeros_comodos) {
    const penalty = (l.roommates - w.companeros_comodos) * w.por_companero_extra;
    total -= penalty;
    reasons.push(`${l.roommates} roommates (${fmt0(-penalty, true)})`);
  }
  if (!flat && (l.visitsAllowed === true || GUESTS.test(text(l)))) {
    total += w.visitas;
    reasons.push(`guests allowed (+${fmt0(w.visitas)})`);
  } else if (!flat && l.atmosphere && QUIET.test(l.atmosphere)) {
    // Costumbre de la casa, no norma: resta, pero no descarta.
    total -= w.visitas;
    reasons.push(`a quiet house that rarely has guests (-${fmt0(w.visitas)})`);
  }
  if (!flat && l.couplesAllowed === false) {
    total -= w.no_admite_parejas;
    reasons.push(`no couples (-${fmt0(w.no_admite_parejas)})`);
  }
  // Edad real de los compañeros: mejor señal que buscar "joven" en el texto.
  if (l.roommateAges && !flat) {
    const m = l.roommateAges.match(/^\s*([+-]?\d+)\s*-\s*([+-]?\d+)\s*$/);
    if (m && Math.abs((+m[1] + +m[2]) / 2 - w.edad_afin) <= w.margen_edad) {
      total += w.ambiente_joven;
      reasons.push(`roommates aged ${l.roommateAges} (+${fmt0(w.ambiente_joven)})`);
    }
  }
  // Entrar "ya": libre dentro de un mes vale menos que libre hoy.
  const free = l.availableFrom ? parseDmy(l.availableFrom) : null;
  if (free) {
    const days = Math.round((free.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (days > w.dias_de_espera_tolerables) {
      const penalty = Math.min((days - w.dias_de_espera_tolerables) * w.por_dia_de_espera, w.espera_maxima);
      total -= penalty;
      reasons.push(`free from ${l.availableFrom}, in ${days} days (${fmt0(-penalty, true)})`);
    }
  }
  const zone = (l.neighbourhood || l.municipality).toLowerCase();
  const preferred = p.zones.prefer.find((n) => zone.includes(n.toLowerCase()));
  if (preferred !== undefined) {
    total += w.zona_preferida;
    reasons.push(`preferred neighbourhood: ${l.neighbourhood} (+${fmt0(w.zona_preferida)})`);
  }
  const avoided = p.zones.penalize.find((n) => zone.includes(n.toLowerCase()));
  if (avoided !== undefined) {
    total -= w.zona_penalizada;
    reasons.push(`neighbourhood you'd rather avoid: ${l.neighbourhood} (-${fmt0(w.zona_penalizada)})`);
  }
  // Si solo sabemos el barrio, el trayecto es una estimacion: no debe
  // adelantar a otro con direccion exacta y tiempo parecido.
  if (l.approximateLocation) {
    total -= w.ubicacion_estimada;
    reasons.push(`approximate location, not exact (-${fmt0(w.ubicacion_estimada)})`);
  }
  return { score: pyRound(total, 1), reasons };
}

/** Lo propio de un piso entero: metros por encima del minimo, y avisar de
 * lo que el anuncio calla de lo que la persona exige. */
function flatScore(l: RawListing, p: SearchProfile, w: Record<string, number>, reasons: string[]): number {
  let sum = 0;
  if (l.surfaceM2) {
    const base = p.flat.min_surface_m2 || 0;
    const extra = base ? Math.min((l.surfaceM2 - base) * w.por_m2_extra, w.tope_m2_extra) : 0;
    if (extra > 0) {
      sum += extra;
      reasons.push(`${l.surfaceM2} m² (+${fmt0(extra)})`);
    } else reasons.push(`${l.surfaceM2} m²`);
  }
  if (p.flat.elevator_required && l.elevator === null) reasons.push('lift not stated: ask');
  if (p.flat.furnished !== 'any' && l.furnished === null) reasons.push('furnishing not stated: ask');
  return sum;
}
