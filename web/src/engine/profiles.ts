import { z } from 'zod';

// Perfiles de busqueda: lo que quiere la usuaria, validado. Mismos valores
// por defecto que profiles.py de la version de escritorio.

export const DEFAULT_WEIGHTS: Record<string, number> = {
  minutos_gratis: 10, euro_sobre_ideal: 0.12, gastos_incluidos: 8, novedad: 25,
  dias_para_ser_nuevo: 7, dias_para_estar_rancio: 90, rancio: 30, ambiente_joven: 8,
  temporal: 25, companeros_comodos: 3, por_companero_extra: 4, visitas: 10,
  no_admite_parejas: 6, edad_afin: 27, margen_edad: 8, dias_de_espera_tolerables: 21,
  por_dia_de_espera: 0.8, espera_maxima: 30, zona_preferida: 12, zona_penalizada: 20,
  ubicacion_estimada: 6, por_m2_extra: 0.25, tope_m2_extra: 15,
};

export const ROOM_SOURCES = ['idealista', 'fotocasa', 'roomgo', 'depisoenpiso'] as const;
export const FLAT_SOURCES = ['idealista', 'fotocasa', 'habitaclia'] as const;
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
  listing_type: z.enum(['room', 'flat']).default('room'),
  sources: z.array(z.enum(ROOM_SOURCES)).min(1).default([...ROOM_SOURCES]),
  flat_sources: z.array(z.enum(FLAT_SOURCES)).min(1).default([...FLAT_SOURCES]),
  flat: flat.default({}),
  destinations: z.array(destination).default([])
    .refine((ds) => new Set(ds.map((d) => d.name)).size === ds.length,
      'destination names must be unique'),
  budget: budget.default({}),
  household: household.default({}),
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

/** Presupuesto del tipo que se busca: el motor solo ve ese. */
export function activeBudget(p: SearchProfile): { ideal: number; max: number; assumed: number } {
  return p.listing_type === 'flat'
    ? { ideal: p.flat.ideal_rent, max: p.flat.max_rent, assumed: p.flat.assumed_bills }
    : { ideal: p.budget.ideal_total, max: p.budget.max_total, assumed: p.budget.assumed_expenses };
}

/** Fuentes que se recorren para el tipo de anuncio del perfil. */
export function activeSources(p: SearchProfile): string[] {
  return p.listing_type === 'flat' ? [...p.flat_sources] : [...p.sources];
}
