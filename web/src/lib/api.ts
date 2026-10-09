export type Status =
  | 'new' | 'liked' | 'hidden' | 'contacted' | 'visit_scheduled'
  | 'visited' | 'applied' | 'got_it' | 'rejected' | 'discarded';

export type ListingType = 'room' | 'flat';

export interface Listing {
  id: string; portal: string; url: string; title: string; type: ListingType;
  price: number | null; expenses: number | null; total_cost: number | null;
  neighbourhood: string; municipality: string;
  lat: number | null; lon: number | null; approximate_location: boolean;
  photo: string; description: string;
  travel: Record<string, number>; routes: Record<string, string>; travel_source: string;
  summary: string; pros: string[]; cons: string[]; red_flags: string[];
  /** Lo que la IA leyo, en palabras; `used` si cambio la puntuacion. */
  ai_facts?: { label: string; value: string; used: boolean }[];
  /** Por que la IA no lo leyo; '' si lo leyo. */
  ai_note?: string;
  /** Ya se leyo la ficha completa (no solo el listado). */
  detail_read?: boolean;
  score: number; reasons: string[];
  gender: 'female_only' | 'male_only' | 'mixed' | 'unknown'; gender_confirmed: boolean;
  roommates: number | null;
  bedrooms: number | null; surface_m2: number | null; bathrooms: number | null;
  floor: string; elevator: boolean | null; furnished: boolean | null;
  available_from: string; published: string; also_on: string[];
  status: Status; note: string; group: 'accepted' | 'possible';
  first_seen: string; last_seen: string; missing_since?: string | null;
}

export interface HistoryEntry { status: Status; note: string; at: string }
export interface ListingDetail extends Listing { history: HistoryEntry[] }

export interface Destination {
  name: string; lat: number; lon: number;
  max_minutes: number | null; minute_weight: number;
  mode: 'transit' | 'walk' | 'bike'; depart_at: string;
}

export interface FlatPrefs {
  ideal_rent: number; max_rent: number; assumed_bills: number;
  min_bedrooms: number; min_surface_m2: number | null;
  elevator_required: boolean; furnished: 'any' | 'yes' | 'no';
}

export interface SearchProfile {
  name: string;
  listing_type: ListingType;
  sources: string[];
  flat_sources: string[];
  flat: FlatPrefs;
  destinations: Destination[];
  budget: { ideal_total: number; max_total: number; assumed_expenses: number };
  household: {
    gender: 'female_only' | 'male_only' | 'mixed' | 'any';
    ask_if_gender_unknown: boolean; min_score_to_ask: number;
    no_live_in_owner: boolean; visits: 'strict' | 'preferred' | 'indifferent';
  };
  zones: { exclude: string[]; penalize: string[]; prefer: string[] };
  idealista: Record<string, number | boolean | null>;
  crawl: { sort: string; fotocasa_sort: string; max_pages: number; details_to_read: number;
           real_travel_times: number };
  weights: Record<string, number>;
}

export interface ProfileSummary { name: string; active: boolean }
export interface Meta { statuses: Status[]; sources: string[]; flat_sources: string[]; genders: string[] }

export interface SearchEvent {
  kind: 'stage' | 'progress' | 'info' | 'warning' | 'captcha' | 'done' | 'error';
  message: string;
  data: Record<string, unknown>;
}

export interface SearchState {
  running: boolean; id: string | null; events: SearchEvent[];
  summary: { accepted: number; possible: number; new: number; crawled: number } | null;
}

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
}

export type Transport = (method: string, url: string, body?: unknown) => Promise<unknown>;

/** Por HTTP, como en la app de escritorio. Lo usan los tests de componentes. */
export const fetchTransport: Transport = async (method, url, body) => {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const r = await fetch(url, init);
  if (r.status === 204) return undefined;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.detail ?? r.statusText);
  return data;
};

let transport: Transport = fetchTransport;
let subscribe: ((f: (e: SearchEvent) => void) => () => void) | null = null;

/** La web real: el backend vive en el navegador, sobre IndexedDB. */
export function useLocalBackend(b: { handle: Transport; subscribe: (f: (e: SearchEvent) => void) => () => void }) {
  transport = async (method, url, body) => {
    try {
      return await b.handle(method, url, body);
    } catch (e) {
      const err = e as { status?: number; detail?: string };
      if (typeof err.status === 'number') throw new ApiError(err.status, err.detail ?? String(e));
      throw new ApiError(500, (e as Error).message ?? String(e));
    }
  };
  subscribe = b.subscribe;
}

const call = <T>(method: string, url: string, body?: unknown) => transport(method, url, body) as Promise<T>;

export const listListings = (q: { status?: Status[]; group?: 'accepted' | 'possible' } = {}) => {
  const p = new URLSearchParams();
  if (q.status?.length) p.set('status', q.status.join(','));
  if (q.group) p.set('group', q.group);
  const qs = p.toString();
  return call<Listing[]>('GET', `/api/listings${qs ? `?${qs}` : ''}`);
};
export const getListing = (id: string) =>
  call<ListingDetail>('GET', `/api/listings/${encodeURIComponent(id)}`);
export const setStatus = (id: string, status: Status, note?: string) =>
  call<ListingDetail>('POST', `/api/listings/${encodeURIComponent(id)}/status`,
    note === undefined ? { status } : { status, note });
/** Lee la ficha completa por la extension y la vuelve a puntuar. */
export const loadFull = (id: string) =>
  call<ListingDetail>('POST', `/api/listings/${encodeURIComponent(id)}/full`);
export const setNote = (id: string, note: string) =>
  call<ListingDetail>('PUT', `/api/listings/${encodeURIComponent(id)}/note`, { note });
export type { Leg, Route } from '../engine/travel';
export const getRoutes = (id: string) =>
  call<{ name: string; route: import('../engine/travel').Route | null }[]>('GET', `/api/listings/${encodeURIComponent(id)}/routes`);
export const getMeta = () => call<Meta>('GET', '/api/meta');
export const listProfiles = () => call<ProfileSummary[]>('GET', '/api/profiles');
export const getActiveProfile = () => call<SearchProfile>('GET', '/api/profiles/active');
export const saveProfile = (p: SearchProfile) =>
  call<SearchProfile>('PUT', `/api/profiles/${encodeURIComponent(p.name)}`, p);
export const activateProfile = (name: string) =>
  call<ProfileSummary[]>('POST', `/api/profiles/${encodeURIComponent(name)}/activate`);
export const deleteProfile = (name: string) =>
  call<void>('DELETE', `/api/profiles/${encodeURIComponent(name)}`);
export const startSearch = (o: { skip_details?: boolean; from_cache?: boolean }) =>
  call<{ id: string }>('POST', '/api/searches', o);
export const searchState = () => call<SearchState>('GET', '/api/searches/current');

export function streamSearch(onEvent: (e: SearchEvent) => void): () => void {
  if (subscribe) {
    let stop = () => {};
    stop = subscribe((e) => {
      onEvent(e);
      if (e.kind === 'done' || e.kind === 'error') queueMicrotask(() => stop());
    });
    return () => stop();
  }
  const source = new EventSource('/api/searches/current/stream');
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as SearchEvent;
    onEvent(e);
    if (e.kind === 'done' || e.kind === 'error') source.close();
  };
  return () => source.close();
}
export const stopSearch = () => call<{ stopping: boolean }>('POST', '/api/searches/current/stop');

export interface TravelSettings {
  travel_provider: 'transitous' | 'google';
  has_google_key: boolean;
  motis_url: string;
}
export interface RouteTest {
  estimate: { minutes: number; detail: string } | null;
  provider: { name: string; minutes: number; detail: string } | null;
  error: string | null;
}
export interface Place { name: string; lat: number; lon: number }

export const getSettings = () => call<TravelSettings>('GET', '/api/settings');
export const saveSettings = (s: Partial<TravelSettings> & { google_key?: string }) =>
  call<TravelSettings>('PUT', '/api/settings', s);
export const testRoute = () => call<RouteTest>('POST', '/api/settings/test-route');
export const geocode = (q: string) =>
  call<Place[]>('GET', `/api/geocode?q=${encodeURIComponent(q)}`);

export interface AISettings {
  provider: 'none' | 'anthropic' | 'openai_compat';
  model: string; base_url: string; has_key: boolean; about_me: string;
}
export interface ProfileSuggestion {
  budget_ideal: number | null; budget_max: number | null;
  household_gender: 'female_only' | 'male_only' | 'mixed' | 'any' | null;
  owner_must_not_live_in: boolean | null;
  visits: 'strict' | 'preferred' | 'indifferent' | null;
  places: { name: string; address: string; max_minutes: number | null; mode: 'transit' | 'walk' | 'bike' }[];
}

export const getAI = () => call<AISettings>('GET', '/api/ai');
export const saveAI = (s: Partial<AISettings> & { key?: string }) => call<AISettings>('PUT', '/api/ai', s);
export const testAI = () => call<{ ok: boolean; model: string; message: string }>('POST', '/api/ai/test');
export const draftMessage = (id: string) =>
  call<{ text: string }>('POST', `/api/listings/${encodeURIComponent(id)}/draft`);
export const suggestProfile = (text: string) =>
  call<ProfileSuggestion>('POST', '/api/profiles/suggest', { text });

export interface Schedule { hours: number; from: string; to: string; last_run: string | null }
export interface NotifySettings { server: string; topic: string; min_score: number }

export const getSchedule = () => call<Schedule>('GET', '/api/schedule');
export const saveSchedule = (s: { hours: number; from: string; to: string }) =>
  call<Schedule>('PUT', '/api/schedule', s);
export const getNotify = () => call<NotifySettings>('GET', '/api/notify');
export const saveNotify = (s: { enabled?: boolean; server?: string; min_score?: number }) =>
  call<NotifySettings>('PUT', '/api/notify', s);
export const testNotify = () => call<{ ok: boolean }>('POST', '/api/notify/test');

export const getNeighbourhoods = () => call<{ names: string[] }>('GET', '/api/neighbourhoods');
export const listModels = (base_url: string, key?: string) =>
  call<{ models: string[] }>('POST', '/api/ai/models', key ? { base_url, key } : { base_url });

// --- datos de este navegador -------------------------------------------------
export interface ImportPreview {
  token: string; kind: 'share' | 'backup'; city: string; types: ListingType[];
  searchedFrom: string | null; searchedTo: string | null;
  total: number; newToYou: number; skipped: number; states: number; profiles: number;
}
export interface ImportResult { added: number; updated: number; missing: number; states: number; profiles: number }
export interface DataStatus { listings: number; bytes: number | null; persisted: boolean }
export const exportData = (kind: 'share' | 'backup') => call<Record<string, unknown>>('GET', `/api/data/export?kind=${kind}`);
export const previewImport = (text: string) => call<ImportPreview>('POST', '/api/data/import/preview', { text });
export const applyImport = (token: string) => call<ImportResult>('POST', '/api/data/import/apply', { token });
export const dataStatus = () => call<DataStatus>('GET', '/api/data/status');
export const clearData = () => call<{ ok: boolean }>('POST', '/api/data/clear');
