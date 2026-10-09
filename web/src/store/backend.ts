// El "servidor" de buscapiso, dentro del navegador. Atiende las mismas rutas
// /api/... que servia FastAPI en la app de escritorio, sobre IndexedDB, para
// que la interfaz no cambie de contrato.
import { draftMessage, suggestProfile } from '../engine/ai/extract';
import { AIError, ClaudeProvider, listModels, OpenAICompatProvider, type AIProvider } from '../engine/ai/providers';
import { CITIES } from '../engine/coverage';
import { Geocoder } from '../engine/geocode';
import { emptyDerived, STATUSES, totalCost, type Derived, type FetchPage, type Status, type StoredListing,
  type UserState } from '../engine/model';
import { DEFAULT_SERVER, randomTopic, send as ntfySend, notifyNew } from '../engine/notify';
import { readFullListing, rescore, runSearch, type Deps, type SearchEvent } from '../engine/pipeline';
import { defaultProfile, FLAT_SOURCES, parseProfile, ROOM_SOURCES, searchProfile, type SearchProfile } from '../engine/profiles';
import { CachedProvider, estimateTrip, GoogleProvider, TRANSITOUS_URL, TransitousProvider, TravelError, type Route,
  type TravelProvider } from '../engine/travel';
import { setting, type Db } from './db';
import { applyImport, exportData, ImportError, previewImport, type ImportPreview } from './transfer';

export class HttpError extends Error {
  constructor(public status: number, public detail: string) { super(detail); }
}

const HIDDEN: Status[] = ['hidden', 'discarded'];
const GENDERS = ['female_only', 'male_only', 'mixed', 'any'];

export interface BackendDeps {
  db: Db;
  /** La extension, si esta instalada (se pregunta en cada busqueda). */
  fetchPage: () => FetchPage | null;
  fetchDirect?: Deps['fetchDirect'];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Para los tests: fetch de geocodificacion, trayectos e IA. */
  geoGet?: (url: string) => Promise<unknown>;
  travelFactory?: (s: TravelConfig) => TravelProvider | null;
  aiFactory?: (s: AIConfig, key: string) => AIProvider | null;
  locks?: LockManager | null;
  /** Antes de buscar (volver a mirar si hay extension) y al parar (cerrar sus pestañas). */
  beforeSearch?: () => Promise<unknown>;
  onStop?: () => Promise<unknown>;
}
interface TravelConfig { provider: 'transitous' | 'google'; motisUrl: string; googleKey: string }
interface AIConfig { provider: 'none' | 'anthropic' | 'openai_compat'; model: string; baseUrl: string }

const defaultFetchDirect: Deps['fetchDirect'] = async (url, form) => {
  const init: RequestInit = form ? { method: 'POST', body: new URLSearchParams(form) } : {};
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

export function createBackend(deps: BackendDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const geoCache = {
    get: (q: string) => db.get<{ lat: number | null; lon: number | null }>('geoCache', q),
    put: (q: string, v: { lat: number | null; lon: number | null }) => db.put('geoCache', v, q),
  };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const geocoder = new Geocoder(geoCache, deps.geoGet, sleep);
  const aiCache = { get: (k: string) => db.get<never>('aiCache', k), put: (k: string, f: unknown) => db.put('aiCache', f, k) };
  const travelCache = { get: (k: string) => db.get<never>('travelCache', k), put: (k: string, v: unknown) => db.put('travelCache', v, k) };

  // --- ajustes -----------------------------------------------------------
  const get = <T>(k: string, d: T) => setting(db, k, d);
  const set = (k: string, v: unknown) => db.put('settings', v, k);

  async function travelConfig(): Promise<TravelConfig> {
    return { provider: await get('travel_provider', 'transitous' as const), motisUrl: await get('motis_url', TRANSITOUS_URL),
      googleKey: await get('google_key', '') };
  }
  function makeTravel(c: TravelConfig): TravelProvider | null {
    if (deps.travelFactory) return deps.travelFactory(c);
    if (c.provider === 'google') return c.googleKey ? new GoogleProvider(c.googleKey) : null;
    return new TransitousProvider(c.motisUrl || TRANSITOUS_URL);
  }
  async function travel(cached = true): Promise<TravelProvider | null> {
    const p = makeTravel(await travelConfig());
    return p && cached ? new CachedProvider(p, travelCache) : p;
  }
  async function aiConfig(): Promise<AIConfig> {
    return { provider: await get('ai_provider', 'none' as const), model: await get('ai_model', ''), baseUrl: await get('ai_base_url', '') };
  }
  async function ai(required = false): Promise<AIProvider | null> {
    const c = await aiConfig();
    const key = await get(`ai_key:${c.provider}`, '');
    const fail = (m: string) => { if (required) throw new HttpError(422, m); return null; };
    if (c.provider === 'none') return fail('Set up an AI provider in the settings first');
    if (deps.aiFactory) return deps.aiFactory(c, key);
    if (c.provider === 'anthropic') return key ? new ClaudeProvider(key, c.model || 'claude-opus-5-5') : fail('AI: Claude needs an API key in the settings');
    if (!c.model) return fail('AI: Choose a model in Settings → AI (Load models), then test it');
    if (!c.baseUrl) return fail('AI: choose a provider again in Settings → AI');
    const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(c.baseUrl);
    if (!key && !local) return fail('AI: this provider needs an API key in the settings');
    return new OpenAICompatProvider(key, c.baseUrl, c.model);
  }

  // --- perfiles ------------------------------------------------------------
  async function activeProfile(): Promise<SearchProfile> {
    const name = await get<string | null>('active_profile', null);
    const p = name ? await db.get<SearchProfile>('profiles', name) : undefined;
    if (p) return parseProfile(p);
    const all = await db.all<SearchProfile>('profiles');
    const chosen = all[0] ? parseProfile(all[0]) : defaultProfile('Default');
    if (!all[0]) await db.put('profiles', chosen);
    await set('active_profile', chosen.name);
    return chosen;
  }
  async function profileList() {
    const active = (await activeProfile()).name;
    return (await db.all<SearchProfile>('profiles')).map((p) => ({ name: p.name, active: p.name === active }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- anuncios ------------------------------------------------------------
  async function state(id: string): Promise<UserState> {
    return (await db.get<UserState>('userState', id)) ?? { id, status: 'new', note: '', history: [] };
  }
  function toApi(l: StoredListing, d: Derived | undefined, u: UserState) {
    const dd = d ?? emptyDerived(l.id);
    const shown = dd.group === 'rejected' ? 'accepted' : dd.group;
    return {
      id: l.id, portal: l.source, url: /^https?:\/\//i.test(l.url) ? l.url : '', type: l.type, title: l.title,
      price: l.price, expenses: l.expenses, total_cost: totalCost(l), neighbourhood: l.neighbourhood,
      municipality: l.municipality, lat: l.lat, lon: l.lon, approximate_location: l.approximateLocation,
      photo: /^https?:\/\//i.test(l.photo) ? l.photo : '', description: l.description,
      travel: dd.travel, routes: dd.routes, travel_source: dd.travelSource,
      summary: dd.summary, pros: dd.pros, cons: dd.cons, red_flags: dd.redFlags,
      ai_facts: dd.aiFacts ?? [], ai_note: dd.aiNote ?? '', detail_read: l.detailRead,
      score: dd.score, reasons: dd.group === 'rejected' ? [`no longer fits: ${dd.rejectReason}`] : dd.reasons,
      gender: l.gender, gender_confirmed: l.genderConfirmed, roommates: l.roommates, bedrooms: l.bedrooms,
      surface_m2: l.surfaceM2, bathrooms: l.bathrooms, floor: l.floor, elevator: l.elevator, furnished: l.furnished,
      available_from: l.availableFrom, published: l.publishedText, also_on: dd.alsoOn,
      status: u.status, note: u.note, group: shown, first_seen: l.firstSeen, last_seen: l.lastSeen,
      missing_since: l.missingSince ?? null,
    };
  }
  async function detail(id: string) {
    const l = await db.get<StoredListing>('listings', id);
    if (!l) throw new HttpError(404, `no listing ${id}`);
    const u = await state(id);
    return { ...toApi(l, await db.get<Derived>('derived', id), u), history: u.history };
  }
  async function listListings(statuses: string[], group: string | null) {
    const p = await activeProfile();
    const [ls, ds, us] = await Promise.all([db.byCity<StoredListing>(p.city), db.all<Derived>('derived'), db.all<UserState>('userState')]);
    const dm = new Map(ds.map((d) => [d.id, d])), um = new Map(us.map((u) => [u.id, u]));
    return ls.map((l) => toApi(l, dm.get(l.id), um.get(l.id) ?? { id: l.id, status: 'new', note: '', history: [] }))
      // Lo descartado por los criterios no se enseña, salvo que la usuaria lo
      // haya tocado. Los del otro tipo si: la pantalla los separa y los cuenta.
      .filter((x) => (dm.get(x.id)?.group ?? 'rejected') !== 'rejected' || x.status !== 'new' || x.type !== p.listing_type)
      .filter((x) => !statuses.length || statuses.includes(x.status))
      .filter((x) => !group || x.group === group)
      .sort((a, b) => b.score - a.score || b.first_seen.localeCompare(a.first_seen));
  }
  async function discarded(): Promise<Set<string>> {
    return new Set((await db.all<UserState>('userState')).filter((u) => HIDDEN.includes(u.status)).map((u) => u.id));
  }

  // --- busquedas -------------------------------------------------------------
  type Summary = { accepted: number; possible: number; new: number; crawled: number };
  const run = { running: false, id: null as string | null, events: [] as SearchEvent[], summary: null as Summary | null,
    abort: null as AbortController | null };
  const listeners = new Set<(e: SearchEvent) => void>();
  const emit = (kind: SearchEvent['kind'], message: string, data: Record<string, unknown> = {}) => {
    const e = { kind, message, data };
    run.events.push(e);
    for (const f of listeners) f(e);
  };
  const store = {
    discarded,
    listings: (city: string) => db.byCity<StoredListing>(city),
    saveListings: (ls: StoredListing[]) => db.putMany('listings', ls),
    saveDerived: (ds: Derived[]) => db.putMany('derived', ds),
  };

  async function pipelineDeps(signal: AbortSignal): Promise<Deps> {
    const n = await notifySettings();
    return {
      fetchPage: deps.fetchPage(), fetchDirect: deps.fetchDirect ?? defaultFetchDirect, store,
      travel: await travel(), geocoder, ai: await ai().catch(() => null), aiCache, now,
      sleep, random: deps.random ?? Math.random, signal,
      notify: n.topic ? (items, kind) => notifyNew({ server: n.server, topic: n.topic, minScore: n.min_score },
        items.map(({ listing, derived }) => ({ score: derived.score, totalCost: totalCost(listing), title: listing.title,
          place: listing.neighbourhood || listing.municipality,
          firstTravel: Object.entries(derived.travel)[0] as [string, number] | undefined })), kind) : undefined,
    };
  }

  /** Vuelve a puntuar todo lo guardado de la ciudad con el perfil activo. */
  async function rescoreAll(emitTo = emit) {
    const p = await activeProfile();
    const ls = await db.byCity<StoredListing>(p.city);
    const ds = await rescore(ls, p, { travel: await travel(), ai: await ai().catch(() => null), aiCache, now }, await discarded(), emitTo);
    await db.putMany('derived', ds);
    return ds;
  }

  async function startSearch(body: { skip_details?: boolean; from_cache?: boolean }) {
    if (run.running) throw new HttpError(409, 'a search is already running');
    if (!body.from_cache) await deps.beforeSearch?.().catch(() => {});
    if (run.running) throw new HttpError(409, 'a search is already running');
    const p = await activeProfile();
    const id = `${Date.now()}`;
    Object.assign(run, { running: true, id, events: [], summary: null, abort: new AbortController() });
    const go = async () => {
      try {
        if (body.from_cache) {
          emit('stage', '1/1 Re-scoring the listings you already have...', { step: 1, total: 1 });
          const ds = await rescoreAll();
          const summary = { accepted: ds.filter((d) => d.group === 'accepted').length,
            possible: ds.filter((d) => d.group === 'possible').length, new: 0, crawled: 0 };
          run.summary = summary;
          emit('done', 'Done', summary);
        } else {
          run.summary = await runSearch(p, await pipelineDeps(run.abort!.signal), emit, { skipDetails: body.skip_details });
          await set('schedule_last_run', now().toISOString());
        }
      } catch (e) {
        if (!run.events.some((x) => x.kind === 'error')) emit('error', `The search failed: ${(e as Error).message}`);
      } finally {
        run.running = false;
      }
    };
    // Un Web Lock evita que dos pestañas busquen a la vez.
    const locks = deps.locks === undefined ? (globalThis.navigator?.locks ?? null) : deps.locks;
    if (locks) {
      const got = await new Promise<boolean>((resolve) => {
        locks.request('buscapiso-search', { ifAvailable: true }, async (lock) => {
          resolve(!!lock);
          if (lock) await go();
        });
      });
      if (!got) {
        run.running = false;
        throw new HttpError(409, 'a search is already running in another buscapiso tab');
      }
    } else void go();
    return { id };
  }

  // --- avisos y horario --------------------------------------------------------
  async function notifySettings() {
    return { server: await get('ntfy_server', DEFAULT_SERVER), topic: await get('ntfy_topic', ''),
      min_score: await get('notify_min_score', 80) };
  }
  async function schedule() {
    return { hours: await get('schedule_hours', 0), from: await get('schedule_from', '08:00'), to: await get('schedule_to', '23:00'),
      last_run: await get<string | null>('schedule_last_run', null) };
  }
  async function travelSettings() {
    const c = await travelConfig();
    return { travel_provider: c.provider, has_google_key: !!c.googleKey, motis_url: c.motisUrl };
  }
  async function aiSettings() {
    const c = await aiConfig();
    return { provider: c.provider, model: c.model, base_url: c.baseUrl,
      has_key: c.provider !== 'none' && !!(await get(`ai_key:${c.provider}`, '')), about_me: await get('ai_about_me', '') };
  }
  const http = (u: string) => /^https?:\/\//.test(u);

  // --- rutas --------------------------------------------------------------------
  type B = Record<string, any>;  // eslint-disable-line @typescript-eslint/no-explicit-any
  const routes: [string, RegExp, (m: string[], body: B, q: URLSearchParams) => Promise<unknown>][] = [
    ['GET', /^\/api\/meta$/, async () => ({ statuses: STATUSES, sources: ROOM_SOURCES, flat_sources: FLAT_SOURCES, genders: GENDERS })],
    ['GET', /^\/api\/listings$/, async (_m, _b, q) => listListings((q.get('status') ?? '').split(',').filter(Boolean), q.get('group'))],
    ['GET', /^\/api\/listings\/([^/]+)$/, async ([id]) => detail(id)],
    // La ficha completa al abrir el anuncio, y la IA lo vuelve a leer.
    ['POST', /^\/api\/listings\/([^/]+)\/full$/, async ([id]) => {
      const l = await db.get<StoredListing>('listings', id);
      if (!l) throw new HttpError(404, `no listing ${id}`);
      if (!l.detailRead) {
        const page = deps.fetchPage();
        if (!page) throw new HttpError(409, 'Reading the full listing needs the buscapiso extension');
        const why = await readFullListing(l, page);
        if (why) throw new HttpError(502, `Could not read the full listing (${why})`);
        await db.put('listings', l);
        const [d] = await rescore([l], await activeProfile(), { travel: await travel(), ai: await ai().catch(() => null),
          aiCache, now }, await discarded());
        await db.put('derived', d);
      }
      return detail(id);
    }],
    // El camino a cada destino, para dibujarlo; solo al abrir el anuncio.
    ['GET', /^\/api\/listings\/([^/]+)\/routes$/, async ([id]) => {
      const l = await db.get<StoredListing>('listings', id);
      if (!l) throw new HttpError(404, `no listing ${id}`);
      const p = await travel();
      const out: { name: string; route: Route | null }[] = [];
      for (const d of (await activeProfile()).destinations) {
        let route: Route | null = null;
        if (p?.route && l.lat !== null && l.lon !== null) {
          try { route = await p.route([l.lat, l.lon], d); } catch (e) { if (!(e instanceof TravelError)) throw e; }
        }
        out.push({ name: d.name, route });
      }
      return out;
    }],
    ['POST', /^\/api\/listings\/([^/]+)\/status$/, async ([id], b) => {
      if (!STATUSES.includes(b.status)) throw new HttpError(422, `invalid status ${b.status}`);
      if (!(await db.get('listings', id))) throw new HttpError(404, `no listing ${id}`);
      const u = await state(id);
      if (b.note !== undefined && b.note !== null) u.note = b.note;
      u.status = b.status;
      u.history.push({ status: b.status, note: u.note, at: now().toISOString() });
      await db.put('userState', u);
      return detail(id);
    }],
    ['PUT', /^\/api\/listings\/([^/]+)\/note$/, async ([id], b) => {
      if (!(await db.get('listings', id))) throw new HttpError(404, `no listing ${id}`);
      await db.put('userState', { ...(await state(id)), note: String(b.note ?? '') });
      return detail(id);
    }],
    ['POST', /^\/api\/listings\/([^/]+)\/draft$/, async ([id]) => {
      const l = await db.get<StoredListing>('listings', id);
      if (!l) throw new HttpError(404, `no listing ${id}`);
      const p = (await ai(true))!;
      try { return { text: await draftMessage(p, l, await get('ai_about_me', '')) }; } catch (e) { throw aiFail(e); }
    }],
    ['GET', /^\/api\/profiles$/, async () => profileList()],
    ['GET', /^\/api\/profiles\/active$/, async () => activeProfile()],
    ['POST', /^\/api\/profiles\/suggest$/, async (_m, b) => {
      const p = (await ai(true))!;
      try { return await suggestProfile(p, String(b.text ?? '')); } catch (e) { throw aiFail(e); }
    }],
    ['GET', /^\/api\/profiles\/([^/]+)$/, async ([name]) => {
      const p = await db.get('profiles', name);
      if (!p) throw new HttpError(404, `no profile ${name}`);
      return parseProfile(p);
    }],
    ['PUT', /^\/api\/profiles\/([^/]+)$/, async ([name], b) => {
      if (b.name !== name) throw new HttpError(400, 'the profile name in the body must match the URL');
      const r = searchProfile.safeParse(b);
      if (!r.success) throw new HttpError(422, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      const first = (await db.count('profiles')) === 0;
      await db.put('profiles', r.data);
      if (first) await set('active_profile', name);
      return r.data;
    }],
    ['POST', /^\/api\/profiles\/([^/]+)\/activate$/, async ([name]) => {
      if (!(await db.get('profiles', name))) throw new HttpError(404, `no profile ${name}`);
      await set('active_profile', name);
      return profileList();
    }],
    ['DELETE', /^\/api\/profiles\/([^/]+)$/, async ([name]) => {
      if ((await activeProfile()).name === name) throw new HttpError(409, 'the active profile cannot be deleted');
      if (!(await db.get('profiles', name))) throw new HttpError(404, `no profile ${name}`);
      await db.delete('profiles', name);
      return undefined;
    }],
    ['POST', /^\/api\/searches$/, async (_m, b) => startSearch(b)],
    ['POST', /^\/api\/searches\/current\/stop$/, async () => {
      run.abort?.abort();
      await deps.onStop?.().catch(() => {});
      return { stopping: run.running };
    }],
    ['GET', /^\/api\/searches\/current$/, async () => ({ running: run.running, id: run.id, events: [...run.events], summary: run.summary })],
    ['GET', /^\/api\/settings$/, async () => travelSettings()],
    ['PUT', /^\/api\/settings$/, async (_m, b) => {
      if (b.google_key !== undefined) await set('google_key', String(b.google_key).trim());
      const c = await travelConfig();
      const provider = b.travel_provider ?? c.provider;
      const url = String(b.motis_url ?? c.motisUrl).trim().replace(/\/+$/, '') || TRANSITOUS_URL;
      if (!http(url)) throw new HttpError(422, 'The server address must start with http:// or https://');
      if (provider === 'google' && !(await get('google_key', ''))) throw new HttpError(422, 'Google Routes needs an API key');
      if (!['transitous', 'google'].includes(provider)) throw new HttpError(422, `unknown travel provider ${provider}`);
      await set('travel_provider', provider);
      await set('motis_url', url);
      return travelSettings();
    }],
    ['POST', /^\/api\/settings\/test-route$/, async () => {
      const p = await activeProfile();
      const dest = p.destinations[0] ?? { name: 'Fira', lat: 41.3519, lon: 2.1307, mode: 'transit' as const, depart_at: '08:30',
        max_minutes: null, minute_weight: 1 };
      const origin: [number, number] = [41.3792, 2.1404];
      const est = estimateTrip(origin[0], origin[1], dest);
      const out = { estimate: { minutes: est.minutes, detail: est.detail }, provider: null as null | object, error: null as string | null };
      const t = await travel(false);
      if (!t) out.error = 'Google Routes needs an API key in the settings';
      else {
        try {
          const [trip] = await t.trips([origin], dest);
          out.provider = trip ? { name: t.name, minutes: trip.minutes, detail: trip.detail } : null;
        } catch (e) { out.error = e instanceof TravelError ? e.message : String(e); }
      }
      return out;
    }],
    ['GET', /^\/api\/geocode$/, async (_m, _b, q) => {
      const text = q.get('q') ?? '';
      if (text.length < 2) throw new HttpError(422, 'Type at least two letters');
      const city = CITIES[(await activeProfile()).city];
      try { return await geocoder.search(text, city?.box); } catch (e) { throw new HttpError(502, `Address search is unavailable: ${(e as Error).message}`); }
    }],
    ['GET', /^\/api\/ai$/, async () => aiSettings()],
    ['PUT', /^\/api\/ai$/, async (_m, b) => {
      const provider = b.provider ?? (await aiConfig()).provider;
      if (b.key !== undefined && provider !== 'none') await set(`ai_key:${provider}`, String(b.key).trim());
      for (const [field, key] of [['provider', 'ai_provider'], ['model', 'ai_model'], ['base_url', 'ai_base_url'], ['about_me', 'ai_about_me']]) {
        if (b[field] !== undefined && b[field] !== null) await set(key, String(b[field]).trim());
      }
      return aiSettings();
    }],
    ['POST', /^\/api\/ai\/test$/, async () => {
      const p = (await ai(true))!;
      try { await p.text('Reply with the single word: ready', 'Are you there?', 2000); } catch (e) { throw aiFail(e); }
      return { ok: true, model: p.model, message: 'The AI answered.' };
    }],
    ['POST', /^\/api\/ai\/models$/, async (_m, b) => {
      const key = String(b.key ?? '').trim() || (await get('ai_key:openai_compat', ''));
      try { return { models: await listModels(String(b.base_url), key) }; } catch (e) { throw aiFail(e); }
    }],
    ['GET', /^\/api\/schedule$/, async () => schedule()],
    ['PUT', /^\/api\/schedule$/, async (_m, b) => {
      const hours = Number(b.hours ?? 0);
      if (hours && !(hours >= 2 && hours <= 24)) throw new HttpError(422, 'Search every 2 to 24 hours, or 0 to turn it off');
      await set('schedule_hours', hours);
      await set('schedule_from', b.from ?? '08:00');
      await set('schedule_to', b.to ?? '23:00');
      return schedule();
    }],
    ['GET', /^\/api\/notify$/, async () => notifySettings()],
    ['PUT', /^\/api\/notify$/, async (_m, b) => {
      if (b.enabled === true && !(await get('ntfy_topic', ''))) await set('ntfy_topic', randomTopic());
      if (b.enabled === false) await set('ntfy_topic', '');
      if (b.server !== undefined && b.server !== null) {
        const server = String(b.server).trim().replace(/\/+$/, '') || DEFAULT_SERVER;
        if (!http(server)) throw new HttpError(422, 'The ntfy server must start with http:// or https://');
        await set('ntfy_server', server);
      }
      if (b.min_score !== undefined && b.min_score !== null) await set('notify_min_score', Number(b.min_score));
      return notifySettings();
    }],
    ['POST', /^\/api\/notify\/test$/, async () => {
      const s = await notifySettings();
      if (!s.topic) throw new HttpError(422, 'Turn on phone notifications first');
      try {
        await ntfySend(s, 'buscapiso is connected', 'You will get a message like this when a good new room appears.');
      } catch (e) { throw new HttpError(502, `Could not reach ntfy: ${(e as Error).message}`); }
      return { ok: true };
    }],
    ['GET', /^\/api\/neighbourhoods$/, async () => {
      const p = await activeProfile();
      const names = new Set((CITIES[p.city]?.areas ?? []).map((a) => a.name.split(',')[0].trim()));
      for (const l of await db.byCity<StoredListing>(p.city)) {
        for (const n of [l.neighbourhood, l.municipality]) if (n?.trim()) names.add(n.trim());
      }
      return { names: [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })) };
    }],
  ];

  // --- datos: exportar, importar, borrar -------------------------------------------
  const pending = new Map<string, ImportPreview>();
  routes.push(
    ['GET', /^\/api\/data\/export$/, async (_m, _b, q) => {
      const kind = q.get('kind') === 'backup' ? 'backup' : 'share';
      return exportData(db, kind, (await activeProfile()).city, now());
    }],
    ['POST', /^\/api\/data\/import\/preview$/, async (_m, body) => {
      let p: ImportPreview;
      try { p = await previewImport(db, String(body.text ?? '')); } catch (e) {
        if (e instanceof ImportError) throw new HttpError(422, e.message);
        throw e;
      }
      const token = `${Date.now()}-${pending.size}`;
      pending.set(token, p);
      const { listings: _l, userState: _u, profiles: _p, settings: _s, ...summary } = p;
      return { token, ...summary, states: p.userState.length, profiles: p.profiles.length };
    }],
    ['POST', /^\/api\/data\/import\/apply$/, async (_m, body) => {
      const p = pending.get(String(body.token));
      if (!p) throw new HttpError(404, 'That import has expired; choose the file again');
      pending.delete(String(body.token));
      const result = await applyImport(db, p);
      // Lo importado llega sin puntuar: este dispositivo puntua con su perfil.
      await rescoreAll(() => {});
      return result;
    }],
    ['GET', /^\/api\/data\/status$/, async () => {
      const est = await globalThis.navigator?.storage?.estimate?.().catch(() => undefined);
      const persisted = await globalThis.navigator?.storage?.persisted?.().catch(() => false);
      return { listings: await db.count('listings'), bytes: est?.usage ?? null, persisted: !!persisted };
    }],
    ['POST', /^\/api\/data\/clear$/, async () => {
      if (run.running) throw new HttpError(409, 'Wait for the search to finish');
      await db.clearAll();
      return { ok: true };
    }],
  );

  function aiFail(e: unknown): HttpError {
    if (e instanceof HttpError) return e;
    return new HttpError(502, e instanceof AIError ? e.message : String(e));
  }

  async function handle(method: string, url: string, body?: unknown): Promise<unknown> {
    const [path, query = ''] = url.split('?');
    for (const [m, re, fn] of routes) {
      if (m !== method) continue;
      const match = path.match(re);
      if (match) return fn(match.slice(1).map(decodeURIComponent), (body ?? {}) as B, new URLSearchParams(query));
    }
    throw new HttpError(404, `no route ${method} ${path}`);
  }

  return {
    handle,
    /** Eventos de la busqueda en curso, desde el primero (como el stream SSE
     * de antes); devuelve como dejar de escuchar. */
    subscribe(f: (e: SearchEvent) => void) {
      for (const e of [...run.events]) f(e);
      listeners.add(f);
      return () => { listeners.delete(f); };
    },
    activeProfile, rescoreAll, schedule, startSearch, isRunning: () => run.running,
  };
}

export type Backend = ReturnType<typeof createBackend>;
