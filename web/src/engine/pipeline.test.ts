import { describe, expect, it } from 'vitest';
import type { AICache, ListingFacts } from './ai/extract';
import { ClaudeProvider } from './ai/providers';
import { Geocoder } from './geocode';
import type { Derived, FetchPage, StoredListing } from './model';
import { rescore, runSearch, type Deps, type PipelineStore, type SearchEvent } from './pipeline';
import { parseProfile } from './profiles';
import { fixture } from './testing';
import { TravelError, type TravelProvider } from './travel';

function memoryStore() {
  const listings = new Map<string, StoredListing>();
  const derived = new Map<string, Derived>();
  const store: PipelineStore = {
    discarded: async () => new Set(),
    listings: async (city) => [...listings.values()].filter((l) => l.city === city).map((l) => structuredClone(l)),
    saveListings: async (ls) => { for (const l of ls) listings.set(l.id, structuredClone(l)); },
    saveDerived: async (ds) => { for (const d of ds) derived.set(d.id, d); },
  };
  return { store, listings, derived };
}

const PAGES: [RegExp, string][] = [
  [/idealista\.com\/alquiler-habitacion/, 'idealista_listado.html'],
  [/idealista\.com\/inmueble/, 'idealista_ficha.html'],
  [/fotocasa\.es\/es\/compartir/, 'fotocasa_listado.html'],
  [/roomgo\.es/, 'roomgo_listado.html'],
];

function extension(opts: { block?: string; calls?: string[] } = {}): FetchPage {
  return async (req, onNeedsUser) => {
    opts.calls?.push(req.url);
    if (req.portal === opts.block) { onNeedsUser?.(); return { ok: false, reason: 'timeout' }; }
    const hit = PAGES.find(([re]) => re.test(req.url));
    // Segunda pagina y siguientes: vacias, para que la paginacion pare.
    if (!hit || /pagina-[2-9]|\/l\/[2-9]|page=[2-9]/.test(req.url)) return { ok: true, html: '<html>' + ' '.repeat(30000) + '</html>', finalUrl: req.url, via: 'fetch' };
    return { ok: true, html: fixture(hit[1]), finalUrl: req.url, via: 'fetch' };
  };
}

function deps(over: Partial<Deps> = {}) {
  const mem = memoryStore();
  const geoStore = new Map();
  const d: Deps = {
    fetchPage: extension(),
    fetchDirect: async (url, form) => fixture(form ? 'depisoenpiso_alojamiento.json' : 'depisoenpiso_places.json'),
    store: mem.store,
    travel: null,
    geocoder: new Geocoder({ get: async (q) => geoStore.get(q), put: async (q, v) => { geoStore.set(q, v); } },
      async () => [{ lat: '41.39', lon: '2.16' }], async () => {}, () => 0),
    ai: null,
    aiCache: { get: async () => undefined, put: async () => {} },
    now: () => new Date('2026-10-09T10:00:00Z'),
    sleep: async () => {},
    random: () => 0.5,
    ...over,
  };
  return { d, mem };
}
const collect = () => { const events: SearchEvent[] = []; return { events, emit: (kind: SearchEvent['kind'], message: string, data = {}) => { events.push({ kind, message, data }); } }; };
const profile = (o = {}) => parseProfile({ name: 'T', household: { gender: 'any', no_live_in_owner: false }, budget: { ideal_total: 500, max_total: 900 },
  crawl: { max_pages: 2, details_to_read: 3 }, ...o });

describe('runSearch', () => {
  it('crawls every portal, stores raw listings, scores them and reports', async () => {
    const { d, mem } = deps();
    const { events, emit } = collect();
    const s = await runSearch(profile(), d, emit);
    const sources = new Set([...mem.listings.values()].map((l) => l.source));
    expect(sources).toEqual(new Set(['idealista', 'fotocasa', 'roomgo', 'depisoenpiso']));
    expect(s.crawled).toBe(mem.listings.size);
    expect(s.accepted).toBeGreaterThan(0);
    expect(s.new).toBeGreaterThan(0);
    expect(mem.derived.size).toBe(mem.listings.size);
    expect(events.at(-1)).toMatchObject({ kind: 'done', data: { accepted: s.accepted } });
    // Lo guardado es lo del portal: sin puntuacion ni trayectos.
    const any = [...mem.listings.values()][0] as unknown as Record<string, unknown>;
    expect(any.score).toBeUndefined();
    expect(any.firstSeen).toBe('2026-10-09T10:00:00.000Z');
    // Las fichas de De Piso en Piso se leen todas (por POST, sin extension).
    expect([...mem.listings.values()].filter((l) => l.source === 'depisoenpiso').every((l) => l.detailRead)).toBe(true);
  }, 30_000);

  it('keeps going when a captcha nobody solves times out on one portal', async () => {
    const { d, mem } = deps({ fetchPage: extension({ block: 'idealista' }) });
    const { events, emit } = collect();
    await runSearch(profile(), d, emit);
    expect(events.some((e) => e.kind === 'captcha' && e.data.portal === 'idealista')).toBe(true);
    expect(events.some((e) => e.kind === 'warning' && e.message.includes('idealista is blocking'))).toBe(true);
    expect([...mem.listings.values()].some((l) => l.source === 'fotocasa')).toBe(true);
    expect(events.at(-1)!.kind).toBe('done');
  }, 30_000);

  it('stops Idealista at once when it bans the connection, and says why', async () => {
    const BAN = '<html><body><h1>Se ha detectado un uso indebido</h1><p>El acceso se ha bloqueado</p>' + ' '.repeat(9000) + '</body></html>';
    const calls: string[] = [];
    const base = extension();
    const fetchPage: FetchPage = async (req, n) => {
      if (req.portal === 'idealista') { calls.push(req.url); return { ok: true, html: BAN, finalUrl: req.url, via: 'tab' }; }
      return base(req, n);
    };
    const { d, mem } = deps({ fetchPage });
    const { events, emit } = collect();
    await runSearch(profile(), d, emit);
    expect(calls).toHaveLength(1);
    expect(events.some((e) => e.kind === 'warning' && /idealista has blocked this connection/i.test(e.message))).toBe(true);
    expect([...mem.listings.values()].some((l) => l.source === 'fotocasa')).toBe(true);
  }, 30_000);

  it('without the extension, only portals that allow it are read', async () => {
    const { d, mem } = deps({ fetchPage: null });
    const { events, emit } = collect();
    await runSearch(profile(), d, emit);
    expect(new Set([...mem.listings.values()].map((l) => l.source))).toEqual(new Set(['depisoenpiso']));
    expect(events.filter((e) => e.message.includes('needs the buscapiso extension'))).toHaveLength(3);
  }, 30_000);

  it('stops when cancelled', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { d } = deps({ signal: ctl.signal });
    const { events, emit } = collect();
    await runSearch(profile(), d, emit);
    expect(events.at(-1)).toMatchObject({ kind: 'error', data: { cancelled: true } });
  });

  it('reads the full listing of the best Idealista rooms once', async () => {
    const calls: string[] = [];
    const { d, mem } = deps({ fetchPage: extension({ calls }) });
    await runSearch(profile({ sources: ['idealista'] }), d, collect().emit);
    const read = [...mem.listings.values()].filter((l) => l.detailRead);
    expect(read.length).toBeGreaterThan(0);
    expect(read.length).toBeLessThanOrEqual(3);
    const before = calls.length;
    await runSearch(profile({ sources: ['idealista'] }), d, collect().emit);
    // Ya leidas: la segunda busqueda no vuelve a pedir esas fichas.
    expect(calls.slice(before).filter((u) => read.some((l) => l.url === u))).toEqual([]);
  }, 30_000);
});

describe('rescore', () => {
  const work = { name: 'Work', lat: 41.3851, lon: 2.1734, max_minutes: 60 };
  async function stored() {
    const { d, mem } = deps();
    await runSearch(profile({ sources: ['fotocasa'] }), d, collect().emit);
    return [...mem.listings.values()];
  }
  it('falls back to estimates, with a warning, when the travel provider is down', async () => {
    const down: TravelProvider = { name: 'transitous', trips: async () => { throw new TravelError('offline'); } };
    const { events, emit } = collect();
    const ds = await rescore(await stored(), profile({ destinations: [work] }), { travel: down, ai: null,
      aiCache: { get: async () => undefined, put: async () => {} }, now: () => new Date('2026-10-09T10:00:00Z') }, new Set(), emit);
    expect(ds.filter((x) => x.travel.Work !== undefined).length).toBeGreaterThan(0);
    expect(ds.every((x) => x.travelSource === '' || x.travelSource === 'estimate')).toBe(true);
    expect(events.some((e) => e.kind === 'warning' && e.message.includes('did not answer'))).toBe(true);
  });
  it('uses real times when the provider answers and says so', async () => {
    const fast: TravelProvider = { name: 'transitous', trips: async (o) => o.map(() => ({ minutes: 12, detail: 'via L3', source: 'transitous' })) };
    const ds = await rescore(await stored(), profile({ destinations: [work] }), { travel: fast, ai: null,
      aiCache: { get: async () => undefined, put: async () => {} }, now: () => new Date() }, new Set());
    const placed = ds.filter((x) => x.travel.Work !== undefined);
    expect(placed.every((x) => x.travel.Work === 12 && x.routes.Work === 'via L3' && x.travelSource === 'transitous')).toBe(true);
  });
  it('applies AI facts to the score without touching the stored listing', async () => {
    const ls = await stored();
    const facts: ListingFacts = { household_gender: 'mixed', bills_included: true, bills_amount_eur: null, owner_lives_in: null,
      couples_allowed: null, visitors_allowed: null, seasonal_or_short_let: true, min_stay_months: null, roommates: null,
      roommates_age_range: null, roommates_occupation: null, available_from: null, summary: 'ok', pros: [], cons: [], red_flags: ['check'] };
    const cache: AICache = { get: async () => facts, put: async () => {} };
    const copy = structuredClone(ls);
    const ds = await rescore(ls, profile({ crawl: { ai_listings: 5 } }), { travel: null, ai: new ClaudeProvider('k'), aiCache: cache,
      now: () => new Date() }, new Set());
    const withAi = ds.filter((x) => x.summary === 'ok');
    expect(withAi.length).toBeGreaterThan(0);
    expect(withAi[0].reasons.some((r) => r.startsWith('AI: looks like a short'))).toBe(true);
    expect(ls).toEqual(copy);
  });
});
