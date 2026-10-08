export type Status =
  | 'new' | 'liked' | 'hidden' | 'contacted' | 'visit_scheduled'
  | 'visited' | 'applied' | 'got_it' | 'rejected' | 'discarded';

export interface Listing {
  id: string; portal: string; url: string; title: string;
  price: number | null; expenses: number | null; total_cost: number | null;
  neighbourhood: string; municipality: string;
  lat: number | null; lon: number | null; approximate_location: boolean;
  photo: string; description: string;
  travel: Record<string, number>; routes: Record<string, string>;
  score: number; reasons: string[];
  gender: 'female_only' | 'male_only' | 'mixed' | 'unknown'; gender_confirmed: boolean;
  roommates: number | null; available_from: string; published: string; also_on: string[];
  status: Status; note: string; group: 'accepted' | 'possible';
  first_seen: string; last_seen: string;
}

export interface HistoryEntry { status: Status; note: string; at: string }
export interface ListingDetail extends Listing { history: HistoryEntry[] }

export interface Destination {
  name: string; lat: number; lon: number;
  max_minutes: number | null; minute_weight: number;
}

export interface SearchProfile {
  name: string;
  sources: string[];
  destinations: Destination[];
  budget: { ideal_total: number; max_total: number; assumed_expenses: number };
  household: {
    gender: 'female_only' | 'male_only' | 'mixed' | 'any';
    ask_if_gender_unknown: boolean; min_score_to_ask: number;
    no_live_in_owner: boolean; visits: 'strict' | 'preferred' | 'indifferent';
  };
  zones: { exclude: string[]; penalize: string[]; prefer: string[] };
  idealista: Record<string, number | boolean | null>;
  crawl: { sort: string; fotocasa_sort: string; max_pages: number; details_to_read: number };
  weights: Record<string, number>;
}

export interface ProfileSummary { name: string; active: boolean }
export interface Meta { statuses: Status[]; sources: string[]; genders: string[] }

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

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const r = await fetch(url, init);
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.detail ?? r.statusText);
  return data as T;
}

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
export const setNote = (id: string, note: string) =>
  call<ListingDetail>('PUT', `/api/listings/${encodeURIComponent(id)}/note`, { note });
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
  const source = new EventSource('/api/searches/current/stream');
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as SearchEvent;
    onEvent(e);
    if (e.kind === 'done' || e.kind === 'error') source.close();
  };
  return () => source.close();
}
