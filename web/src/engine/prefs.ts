// Preferencias con nivel: imprescindible, mejor si, me da igual. Cada una
// mira un dato del anuncio que puede ser si, no o "no lo dice":
//   imprescindible + no  -> fuera (filter)
//   imprescindible + ?   -> resta un poco y dice que hay que preguntar
//   mejor si + si/no     -> suma o resta
//   mejor si + ?         -> solo lo dice
// Lo que se cumple siempre suma. Por defecto todo es "me da igual" y la
// puntuacion no cambia.
import { fmt0 } from './ranking';
import type { RawListing } from './model';
import { AMENITIES, type Amenity, type Level, type SearchProfile } from './profiles';

interface Check { level: Level; value: boolean | null; yes: string; no: string; ask: string }

const AMENITY_TEXT: Record<Amenity, string> = {
  air_conditioning: 'air conditioning', heating: 'heating', balcony_or_terrace: 'balcony or terrace',
  washing_machine: 'washing machine', dishwasher: 'dishwasher', wifi_included: 'wifi included',
  cleaning_included: 'cleaning included', lift: 'lift',
};

const bool = (x: boolean | null | undefined) => (x === undefined ? null : x);
const not = (x: boolean | null | undefined) => (x === null || x === undefined ? null : !x);

function amenity(l: RawListing, a: Amenity): boolean | null {
  if (a === 'lift' && l.elevator !== null) return l.elevator;
  if (l.amenities?.includes(a)) return true;
  if (l.amenitiesMissing?.includes(a)) return false;
  return null;
}

const STUDENTS = /student|estudiant|universit|erasmus/i;
const WORKERS = /worker|trabaj|profesional|work/i;
function occupation(l: RawListing, want: 'students' | 'workers'): boolean | null {
  const t = l.roommateOccupation ?? '';
  if (!t.trim()) return null;
  const students = STUDENTS.test(t), workers = WORKERS.test(t);
  if (!students && !workers) return null;
  return want === 'students' ? students : workers;
}

function checks(l: RawListing, p: SearchProfile): Check[] {
  const x = p.prefs;
  const room = l.type === 'room';
  const out: Check[] = [
    { level: x.pets, value: bool(l.petsAllowed), yes: 'pets allowed', no: 'no pets allowed', ask: 'pets' },
    { level: x.smoking, value: bool(l.smokingAllowed), yes: 'smoking allowed', no: 'no smoking', ask: 'smoking' },
    { level: x.no_smokers, value: not(l.smokingAllowed), yes: 'non-smoking flat', no: 'smoking allowed in the flat', ask: 'smoking' },
    { level: x.registration, value: bool(l.registrationAllowed), yes: 'you can register there (empadronarse)',
      no: "you can't register there (empadronarse)", ask: 'registration (empadronamiento)' },
    { level: x.agency_fee, value: not(l.agencyFee), yes: 'no agency fee', no: 'agency fee', ask: 'agency fee' },
    { level: x.exterior, value: bool(l.exterior), yes: 'exterior', no: 'interior', ask: 'exterior or interior' },
  ];
  if (room) {
    out.push(
      { level: x.couple, value: bool(l.couplesAllowed), yes: 'couples welcome', no: 'no couples', ask: 'couples' },
      { level: x.private_bathroom, value: bool(l.privateBathroom), yes: 'private bathroom', no: 'shared bathroom', ask: 'bathroom' },
      { level: x.double_bed, value: bool(l.doubleBed), yes: 'double bed', no: 'single bed', ask: 'bed size' },
    );
    if (x.occupation !== 'any') {
      out.push({ level: x.occupation_level, value: occupation(l, x.occupation), yes: `roommates are ${x.occupation}`,
        no: `roommates are not ${x.occupation}`, ask: 'who the roommates are' });
    }
  }
  for (const a of AMENITIES) {
    const lv = x.amenities[a];
    if (lv) out.push({ level: lv, value: amenity(l, a), yes: AMENITY_TEXT[a], no: `no ${AMENITY_TEXT[a]}`, ask: AMENITY_TEXT[a] });
  }
  return out.filter((c) => c.level !== 'any');
}

/** Fianza en meses: la que dice, o la de euros entre el alquiler. */
export function depositMonths(l: RawListing): number | null {
  if (l.depositMonths !== null && l.depositMonths !== undefined) return l.depositMonths;
  if (l.depositEur && l.price) return Math.round((l.depositEur / l.price) * 10) / 10;
  return null;
}

/** Motivo para dejar fuera el anuncio, o null. */
export function prefsReject(l: RawListing, p: SearchProfile): string | null {
  const x = p.prefs;
  const deposit = depositMonths(l);
  if (x.max_deposit_months !== null && deposit !== null && deposit > x.max_deposit_months) {
    return `deposit of ${fmt0(deposit)} months, above your ${fmt0(x.max_deposit_months)}`;
  }
  if (x.stay_months !== null && l.minStayMonths !== null && l.minStayMonths > x.stay_months) {
    return `minimum stay of ${l.minStayMonths} months, you stay ${x.stay_months}`;
  }
  if (l.type === 'room') {
    if (x.roommates_max !== null && l.roommates !== null && l.roommates > x.roommates_max) {
      return `${l.roommates} roommates, you want at most ${x.roommates_max}`;
    }
    const m2 = l.roomM2 ?? null;
    if (x.room_min_m2 !== null && m2 !== null && m2 < x.room_min_m2) return `room of ${m2} m², you want ${x.room_min_m2}+`;
  }
  const broken = checks(l, p).find((c) => c.level === 'required' && c.value === false);
  return broken ? broken.no : null;
}

/** Suma y resta de las preferencias, con un motivo por cada una. */
export function prefsScore(l: RawListing, p: SearchProfile, w: Record<string, number>, reasons: string[],
  ask: string[] = []): number {
  let total = 0;
  for (const c of checks(l, p)) {
    if (c.value === true) {
      total += w.pref_cumple;
      reasons.push(`${c.yes} (+${fmt0(w.pref_cumple)})`);
    } else if (c.value === false) {
      // Imprescindible e incumplido ya no llega aqui: lo descarto el filtro.
      total -= w.pref_incumple;
      reasons.push(`${c.no} (-${fmt0(w.pref_incumple)})`);
    } else if (c.level === 'required') {
      total -= w.pref_desconocida;
      reasons.push(`${c.ask} not stated: ask (-${fmt0(w.pref_desconocida)})`);
      if (!ask.includes(c.ask)) ask.push(c.ask);
    } else reasons.push(`${c.ask} not stated`);
  }
  if (p.prefs.max_deposit_months !== null && depositMonths(l) === null) {
    reasons.push('deposit not stated: ask');
    ask.push('deposit');
  }
  return total;
}
