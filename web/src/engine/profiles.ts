import { z } from 'zod';
import { SOURCES, sourcesFor } from './sources';

// Perfiles de busqueda: lo que quiere la usuaria, validado. Mismos valores
// por defecto que profiles.py de la version de escritorio.

export const DEFAULT_WEIGHTS: Record<string, number> = {
  minutos_gratis: 10, euro_sobre_ideal: 0.12, gastos_incluidos: 8, novedad: 25,
  dias_para_ser_nuevo: 7, dias_para_estar_rancio: 90, rancio: 30, ambiente_joven: 8,
  temporal: 25, companeros_comodos: 3, por_companero_extra: 4, visitas: 10,
  no_admite_parejas: 6, edad_afin: 27, margen_edad: 8, dias_de_espera_tolerables: 21,
  por_dia_de_espera: 0.8, espera_maxima: 30, zona_preferida: 12, zona_penalizada: 20,
  ubicacion_estimada: 6, por_m2_extra: 0.25, tope_m2_extra: 15,
  deseo_cumplido: 4, deseo_incumplido: 10,
  // Preferencias con nivel: lo que el anuncio cumple, lo que incumple y lo
  // que calla cuando para ti es imprescindible.
  pref_cumple: 6, pref_incumple: 12, pref_desconocida: 3,
};

/** Imprescindible (descarta), mejor si (suma o resta), me da igual. */
export const LEVELS = ['required', 'preferred', 'any'] as const;
export type Level = (typeof LEVELS)[number];
const level = z.enum(LEVELS).default('any');
export const AMENITIES = ['air_conditioning', 'heating', 'balcony_or_terrace', 'washing_machine', 'dishwasher',
  'wifi_included', 'cleaning_included', 'lift'] as const;
export type Amenity = (typeof AMENITIES)[number];
const optInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable().default(null);

// Lo que cada cual necesita, con su nivel. Por defecto nada cambia la
// puntuacion de antes: "me da igual" y sin limites.
const prefs = z.object({
  max_deposit_months: z.number().min(0).max(12).nullable().default(null),
  agency_fee: level,
  registration: level,
  /** Fecha en que quieres entrar (aaaa-mm-dd): la espera se cuenta desde ahi. */
  move_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  /** Meses que te quedas: un anuncio que pide mas, fuera. */
  stay_months: optInt(1, 120),
  /** Alquiler de temporada: "mejor si no" es lo que hacia siempre el ranking. */
  seasonal: z.enum(LEVELS).default('preferred'),
  pets: level,
  smoking: level,
  no_smokers: level,
  couple: level,
  roommates_max: optInt(0, 20),
  age_min: optInt(16, 99),
  age_max: optInt(16, 99),
  occupation: z.enum(['any', 'students', 'workers']).default('any'),
  occupation_level: level,
  room_min_m2: optInt(1, 200),
  private_bathroom: level,
  double_bed: level,
  exterior: level,
  amenities: z.record(z.enum(AMENITIES), z.enum(['required', 'preferred'])).default({}),
}).refine((x) => x.age_min === null || x.age_max === null || x.age_min <= x.age_max, 'age_min cannot be above age_max');

/** Los portales de cada tipo salen del registro (se piden al validar: el
 * registro importa este modulo). */
export const roomSources = () => sourcesFor('room');
export const flatSources = () => sourcesFor('flat');
/** Los portales que habia antes de que los perfiles recordaran cuales conocian. */
const FIRST_SOURCES = ['idealista', 'fotocasa', 'habitaclia', 'roomgo', 'depisoenpiso'];
const sourceList = (type: 'room' | 'flat') => z.array(z.string()).min(1)
  .refine((ids) => ids.every((id) => SOURCES[id]?.types.includes(type)),
    (ids) => ({ message: `unknown portals: ${ids.filter((id) => !SOURCES[id]?.types.includes(type)).join(', ')}` }));
const sort = z.enum(['newest', 'cheapest', 'relevance']);

const destination = z.object({
  name: z.string().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  max_minutes: z.number().positive().nullable().default(null),
  minute_weight: z.number().min(0).default(1),
  mode: z.enum(['transit', 'walk', 'bike']).default('transit'),
  depart_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:30'),
});

const budget = z.object({
  ideal_total: z.number().int().positive().default(500),
  max_total: z.number().int().positive().default(650),
  assumed_expenses: z.number().int().min(0).default(55),
}).refine((b) => b.ideal_total <= b.max_total, 'ideal_total cannot be above max_total');

// Un piso entero tiene su propio presupuesto: cambiar de tipo no pisa el otro.
const flat = z.object({
  ideal_rent: z.number().int().positive().default(1100),
  max_rent: z.number().int().positive().default(1400),
  assumed_bills: z.number().int().min(0).default(120),
  min_bedrooms: z.number().int().min(0).max(10).default(1),
  min_surface_m2: z.number().int().positive().max(1000).nullable().default(null),
  elevator_required: z.boolean().default(false),
  furnished: z.enum(['any', 'yes', 'no']).default('any'),
}).refine((f) => f.ideal_rent <= f.max_rent, 'ideal_rent cannot be above max_rent');

const household = z.object({
  gender: z.enum(['female_only', 'male_only', 'mixed', 'any']).default('any'),
  ask_if_gender_unknown: z.boolean().default(true),
  min_score_to_ask: z.number().default(60),
  no_live_in_owner: z.boolean().default(true),
  visits: z.enum(['strict', 'preferred', 'indifferent']).default('preferred'),
});

const idealista = z.object({
  max_price: z.number().int().positive().nullable().default(null),
  no_live_in_owner: z.boolean().default(false),
  with_students: z.boolean().default(false),
  with_workers: z.boolean().default(false),
  exterior: z.boolean().default(false),
  non_smokers: z.boolean().default(false),
  last_48h: z.boolean().default(false),
});

const crawl = z.object({
  sort: sort.default('newest'),
  fotocasa_sort: sort.default('cheapest'),
  max_pages: z.number().int().min(1).max(20).default(3),
  details_to_read: z.number().int().min(0).max(100).default(12),
  real_travel_times: z.number().int().min(0).max(200).default(40),
  ai_listings: z.number().int().min(0).max(200).default(30),
});

export const searchProfile = z.object({
  name: z.string().min(1).max(60),
  city: z.string().min(1).default('barcelona'),
  /** Quien busca y que quiere, con sus palabras: lo lee la IA. */
  description: z.string().max(2000).default(''),
  listing_type: z.enum(['room', 'flat']).default('room'),
  sources: sourceList('room').default(roomSources),
  flat_sources: sourceList('flat').default(flatSources),
  /** Los portales que existian la ultima vez que se guardo: uno nuevo se
   * añade encendido, y uno que la persona apago sigue apagado. */
  known_sources: z.array(z.string()).default(FIRST_SOURCES),
  flat: flat.default({}),
  destinations: z.array(destination).default([])
    .refine((ds) => new Set(ds.map((d) => d.name)).size === ds.length,
      'destination names must be unique'),
  budget: budget.default({}),
  household: household.default({}),
  prefs: prefs.default({}),
  zones: z.object({
    exclude: z.array(z.string()).default([]),
    penalize: z.array(z.string()).default([]),
    prefer: z.array(z.string()).default([]),
  }).default({}),
  idealista: idealista.default({}),
  crawl: crawl.default({}),
  weights: z.record(z.number()).default({})
    .refine((w) => Object.keys(w).every((k) => k in DEFAULT_WEIGHTS),
      (w) => ({ message: `unknown weights: ${Object.keys(w).filter((k) => !(k in DEFAULT_WEIGHTS)).sort().join(', ')}` }))
    .transform((w) => ({ ...DEFAULT_WEIGHTS, ...w })),
}).transform((p) => {
  const known = new Set(p.known_sources);
  const fresh = Object.keys(SOURCES).filter((id) => !known.has(id));
  const add = (list: string[], type: 'room' | 'flat') =>
    [...list, ...fresh.filter((id) => SOURCES[id].types.includes(type) && !list.includes(id))];
  return { ...p, sources: add(p.sources, 'room'), flat_sources: add(p.flat_sources, 'flat'), known_sources: Object.keys(SOURCES) };
});

export type SearchProfile = z.output<typeof searchProfile>;
export type SearchProfileInput = z.input<typeof searchProfile>;
export type Destination = SearchProfile['destinations'][number];

/** Perfil validado con los valores por defecto rellenos. Lanza ZodError. */
export function parseProfile(input: unknown): SearchProfile {
  return searchProfile.parse(input);
}

export function defaultProfile(name = 'Default'): SearchProfile {
  return parseProfile({ name });
}

export { activeBudget } from './budget';

/** Fuentes que se recorren para el tipo de anuncio del perfil. */
export function activeSources(p: SearchProfile): string[] {
  return p.listing_type === 'flat' ? [...p.flat_sources] : [...p.sources];
}
