import { describe, expect, it } from 'vitest';
import { listingFacts, type AICache, type ListingFacts } from './ai/extract';
import { AIError, ClaudeProvider, type AIProvider } from './ai/providers';
import { Geocoder } from './geocode';
import { emptyListing, type Derived, type FetchPage, type StoredListing } from './model';
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

  it('keeps the crawled listings when stopped while placing them on the map', async () => {
    const ctl = new AbortController();
    const geocoder = new Geocoder({ get: async () => undefined, put: async () => {} },
      async () => { ctl.abort(); return []; }, async () => {}, () => 0);
    const { d, mem } = deps({ geocoder, signal: ctl.signal });
    const { events, emit } = collect();
    await runSearch(profile({ sources: ['idealista'] }), d, emit);
    expect(events.at(-1)).toMatchObject({ kind: 'error', data: { cancelled: true } });
    expect([...mem.listings.values()].filter((l) => l.source === 'idealista').length).toBeGreaterThan(0);
  }, 30_000);

  it('places every listing by its neighbourhood and looks up only the best addresses', async () => {
    const queries: string[] = [];
    const geoStore = new Map();
    const geocoder = new Geocoder({ get: async (q) => geoStore.get(q), put: async (q, v) => { geoStore.set(q, v); } },
      async (url) => { queries.push(new URL(url).searchParams.get('q')!); return [{ lat: '41.39', lon: '2.16' }]; },
      async () => {}, () => 0);
    const { d, mem } = deps({ geocoder });
    await runSearch(profile({ sources: ['idealista'], crawl: { max_pages: 1, details_to_read: 0, real_travel_times: 2 } }), d, collect().emit);
    const ls = [...mem.listings.values()];
    expect(ls.length).toBeGreaterThan(2);
    expect(ls.every((l) => l.lat !== null)).toBe(true);
    const addressQueries = queries.filter((q) => ls.some((l) => l.address && l.address !== l.neighbourhood && q.startsWith(`${l.address},`)));
    expect(addressQueries).toHaveLength(2);
    expect(ls.filter((l) => !l.approximateLocation)).toHaveLength(2);
  }, 30_000);

  it('leaves alone the position a portal gives, even a vague one', async () => {
    const queries: string[] = [];
    // Un sitio que ningun portal daria: si aparece, lo puso el geocodificador.
    const geocoder = new Geocoder({ get: async () => undefined, put: async () => {} },
      async (url) => { queries.push(new URL(url).searchParams.get('q')!); return [{ lat: '1', lon: '1' }]; },
      async () => {}, () => 0);
    const { d, mem } = deps({ geocoder });
    await runSearch(profile({ sources: ['fotocasa'], crawl: { max_pages: 1, details_to_read: 0 } }), d, collect().emit);
    const ls = [...mem.listings.values()];
    expect(queries).toEqual([]);
    expect(ls.filter((l) => l.lat === 1)).toEqual([]);
    // Fotocasa da coordenadas, aproximadas a proposito en muchos anuncios.
    expect(ls.some((l) => l.approximateLocation && l.address)).toBe(true);
  }, 30_000);

  it('reports the crawl as it goes: the plan, each page with a few listings, and each portal finishing', async () => {
    const { d } = deps();
    const { events, emit } = collect();
    await runSearch(profile({ crawl: { max_pages: 2, details_to_read: 0 } }), d, emit);
    const plan = events.find((e) => e.data.plan)!.data.plan as Record<string, number>;
    expect(Object.keys(plan).sort()).toEqual(['depisoenpiso', 'fotocasa', 'idealista', 'roomgo']);
    expect(plan.roomgo).toBe(2);    // una sola URL, dos paginas como mucho
    const pages = events.filter((e) => e.data.page);
    expect(pages.length).toBeGreaterThan(3);
    const first = pages.find((e) => e.data.source === 'idealista')!;
    expect(first.data.found).toBe(first.data.count);
    const sample = first.data.sample as { title: string; price: number; url: string; source: string }[];
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.length).toBeLessThanOrEqual(3);
    expect(sample[0]).toMatchObject({ source: 'idealista', url: expect.stringContaining('idealista.com') });
    const finished = events.filter((e) => e.data.finished).map((e) => e.data.source).sort();
    expect(finished).toEqual(['depisoenpiso', 'fotocasa', 'idealista', 'roomgo']);
  }, 30_000);

  it('fills the list while placing listings, with cached AI facts and no AI calls', async () => {
    let t = Date.parse('2026-10-09T10:00:00Z');
    const geoStore = new Map();
    // Cada consulta al geocodificador avanza el reloj 6 s: toca vista previa.
    const geocoder = new Geocoder({ get: async (q) => geoStore.get(q), put: async (q, v) => { geoStore.set(q, v); } },
      async () => { t += 6000; return [{ lat: '41.39', lon: '2.16' }]; }, async () => {}, () => 0);
    let aiCalls = 0;
    const cached = listingFacts.parse({ household_gender: 'mixed', summary: 'from before' });
    const ai: AIProvider = { name: 'fake', model: 'm', usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, text: async () => '',
      json: (async () => { aiCalls++; throw new AIError('no'); }) as AIProvider['json'] };
    const { d, mem } = deps({ geocoder, ai, aiCache: { get: async () => cached, put: async () => {} }, now: () => new Date(t) });
    let stage = 0;
    const previews: { summaries: number; calls: number }[] = [];
    await runSearch(profile({ sources: ['idealista'], crawl: { max_pages: 1, details_to_read: 0 } }), d, (kind, _m, data = {}) => {
      if (kind === 'stage') stage = Number(data.step);
      if (data.results && stage === 2) {
        previews.push({ summaries: [...mem.derived.values()].filter((x) => x.summary === 'from before').length, calls: aiCalls });
      }
    });
    expect(previews.length).toBeGreaterThanOrEqual(2);
    expect(previews.every((x) => x.summaries > 0 && x.calls === 0)).toBe(true);
  }, 30_000);

  it('puts first results in the list before the search ends', async () => {
    const { d, mem } = deps();
    const seen: number[] = [];
    await runSearch(profile(), d, (kind, message, data = {}) => {
      if (data.results) seen.push(mem.derived.size);
      if (kind === 'stage' && data.step === 4) seen.push(-1);
    });
    // Al menos una entrega antes de leer las fichas, y con anuncios dentro.
    expect(seen.indexOf(-1)).toBeGreaterThan(0);
    expect(seen[0]).toBeGreaterThan(0);
  }, 30_000);

  it('says how long each stage took', async () => {
    let t = Date.parse('2026-10-09T10:00:00Z');
    const { d } = deps({ now: () => new Date((t += 61_000)) });
    const { events, emit } = collect();
    await runSearch(profile({ sources: ['fotocasa'] }), d, emit);
    expect(events.filter((e) => /took \d+ min/.test(e.message)).length).toBeGreaterThanOrEqual(5);
    expect(events.every((e) => typeof e.data.elapsed === 'number')).toBe(true);
  }, 30_000);

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
    const facts: ListingFacts = { household_gender: 'mixed', bills_included: true, bills_eur_min: null, bills_eur_max: null, owner_lives_in: null, smoking_allowed: null, exterior: null,
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

  const FACTS: ListingFacts = { household_gender: 'mixed', bills_included: null, bills_eur_min: null, bills_eur_max: null, owner_lives_in: null, smoking_allowed: null, exterior: null,
    couples_allowed: null, visitors_allowed: null, seasonal_or_short_let: null, min_stay_months: null, roommates: null,
    roommates_age_range: null, roommates_occupation: null, available_from: null, summary: 'read', pros: [], cons: [], red_flags: [] };
  const noCache: AICache = { get: async () => undefined, put: async () => {} };
  /** Contesta a cada lote con los hechos que da `answer` para cada anuncio. */
  function fakeAI(answer: (n: number, title: string) => Promise<ListingFacts>, prompts: string[] = []): AIProvider {
    let n = 0;
    return { name: 'fake', model: 'm', usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, text: async () => '',
      json: (async (_s: string, user: string, schema: { parse(x: unknown): unknown }) => {
        prompts.push(user);
        const call = n++;
        const tags = [...user.matchAll(/<listing id="(\d+)">\nTitle: ([^\n]*)/g)];
        const listings = [];
        for (const [, id, title] of tags) listings.push({ ...(await answer(call, title)), id });
        return schema.parse({ listings });
      }) as AIProvider['json'] };
  }
  const place = { lat: 41.3851, lon: 2.1734 };
  const room = (id: string, o: Partial<StoredListing>): StoredListing => ({ ...emptyListing('fotocasa', id, `https://x/${id}`),
    id: `fotocasa:${id}`, city: 'barcelona', firstSeen: '', lastSeen: '', ...place, approximateLocation: false,
    gender: 'mixed', genderConfirmed: true, ...o });
  const tight = () => profile({ budget: { ideal_total: 400, max_total: 500 },
    destinations: [{ name: 'Work', lat: 41.39, lon: 2.17, max_minutes: 60 }], crawl: { ai_listings: 30 } });

  it('reads bills written in the description and says where the figure came from', async () => {
    const ds = await rescore([room('a', { title: 'A', price: 420, description: 'Precio 420€ + gastos a parte (50-100€/mes)' })],
      tight(), { travel: null, ai: null, aiCache: noCache, now: () => new Date() }, new Set());
    expect(ds[0].reasons).toContain('420 € + ~75 € bills (from the description) = 495 € a month (-11)');
  });
  it('lets the AI rescue a listing whose only problem was a hidden fact, before travel times', async () => {
    const prompts: string[] = [];
    const ai = fakeAI(async () => ({ ...FACTS, bills_included: true }), prompts);
    const origins: number[] = [];
    const travel: TravelProvider = { name: 'transitous', trips: async (o) => { origins.push(o.length); return o.map(() => ({ minutes: 20, detail: '', source: 'transitous' })); } };
    const ls = [room('a', { title: 'Hidden bills', price: 470 }), room('b', { title: 'Too dear', price: 900 })];
    const ds = await rescore(ls, tight(), { travel, ai, aiCache: noCache, now: () => new Date() }, new Set());
    // 470 + 55 supuestos pasa del maximo; con gastos incluidos, no.
    expect(ds.find((d) => d.id === 'fotocasa:a')!.group).toBe('accepted');
    // El alquiler solo ya pasa del maximo: la IA no lo puede arreglar y no se le pregunta.
    expect(prompts.join('')).toContain('Hidden bills');
    expect(prompts.join('')).not.toContain('Too dear');
  });
  it('only uses cached AI facts when asked not to call the AI', async () => {
    const prompts: string[] = [];
    const ai = fakeAI(async () => FACTS, prompts);
    const ds = await rescore([room('a', { title: 'A', price: 420 })], tight(), { travel: null, ai, aiCache: noCache,
      now: () => new Date() }, new Set(), undefined, { aiCacheOnly: true });
    expect(prompts).toEqual([]);
    expect(ds[0].summary).toBe('');
  });
  it('asks the AI about several listings at once, but not all of them', async () => {
    let inFlight = 0, most = 0;
    const ai = fakeAI(async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return FACTS;
    });
    const ds = await rescore(await stored(), profile({ crawl: { ai_listings: 12 } }), { travel: null, ai, aiCache: noCache,
      now: () => new Date() }, new Set());
    expect(ds.filter((x) => x.summary === 'read').length).toBeGreaterThan(4);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
  });
  it('waits and retries when the AI says it is getting too many requests', async () => {
    const waits: number[] = [];
    const ai = fakeAI(async (n) => { if (n === 0) throw new AIError('HTTP 429', 429); return FACTS; });

    const ds = await rescore(await stored(), profile({ crawl: { ai_listings: 3 } }), { travel: null, ai, aiCache: noCache,
      now: () => new Date(), sleep: async (ms) => { waits.push(ms); } }, new Set());
    expect(waits.length).toBeGreaterThan(0);
    // Todos los que aun podian valer, no solo los tres primeros.
    expect(ds.filter((x) => x.summary === 'read').length).toBeGreaterThan(3);
  });
});
