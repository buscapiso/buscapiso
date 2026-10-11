import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { emptyListing, listingId, type FetchPage, type StoredListing } from '../engine/model';
import { fixture } from '../engine/testing';
import type { SearchEvent } from '../engine/pipeline';
import type { CityCandidate } from '../engine/geocode';
import { createBackend, HttpError, type BackendDeps } from './backend';
import { Db } from './db';

/** Un LockManager minimo compartido entre "pestañas". */
function fakeLocks(): LockManager {
  const held = new Set<string>();
  return {
    async request(name: string, opts: LockOptions, cb: (l: Lock | null) => Promise<unknown>) {
      if (held.has(name) && opts.ifAvailable) return cb(null);
      held.add(name);
      try { return await cb({ name, mode: 'exclusive' } as Lock); } finally { held.delete(name); }
    },
    async query() { return {}; },
  } as unknown as LockManager;
}

const roomgoOnly: FetchPage = async (req) => (/roomgo\.es\/barcelona\/piso-compartido-barcelona$/.test(req.url)
  ? { ok: true, html: fixture('roomgo_listado.html'), finalUrl: req.url, via: 'fetch' }
  : { ok: true, html: '<html>' + ' '.repeat(6000) + '</html>', finalUrl: req.url, via: 'fetch' });

async function setup(over: Partial<BackendDeps> = {}, factory = new IDBFactory()) {
  const db = await Db.open('t', factory);
  const b = createBackend({ db, fetchPage: () => roomgoOnly, fetchDirect: async () => '{"places":[]}',
    sleep: async () => {}, random: () => 0, travelFactory: () => null, locks: null,
    geoGet: async () => [{ lat: '41.39', lon: '2.16' }], now: () => new Date('2026-10-09T10:00:00Z'), ...over });
  return { db, b };
}
const until = (b: { subscribe: (f: (e: SearchEvent) => void) => () => void }) => new Promise<SearchEvent[]>((ok) => {
  const seen: SearchEvent[] = [];
  b.subscribe((e) => { seen.push(e); if (e.kind === 'done' || e.kind === 'error') ok(seen); });
});
const searchRooms = { name: 'Default', sources: ['roomgo'], household: { gender: 'any', no_live_in_owner: false },
  budget: { ideal_total: 400, max_total: 900 } };

async function withListings() {
  const s = await setup();
  await s.b.handle('PUT', '/api/profiles/Default', searchRooms);
  await s.b.handle('POST', '/api/searches', {});
  await until(s.b);
  return s;
}

describe('profiles', () => {
  it('creates an active default profile the first time', async () => {
    const { b } = await setup();
    expect(await b.handle('GET', '/api/profiles')).toEqual([{ name: 'Default', active: true }]);
    expect(await b.handle('GET', '/api/profiles/active')).toMatchObject({ name: 'Default', city: 'barcelona', listing_type: 'room' });
  });
  it('validates, activates and refuses to delete the active one', async () => {
    const { b } = await setup();
    await expect(b.handle('PUT', '/api/profiles/X', { name: 'Y' })).rejects.toMatchObject({ status: 400 });
    await expect(b.handle('PUT', '/api/profiles/X', { name: 'X', budget: { ideal_total: 900, max_total: 500 } }))
      .rejects.toMatchObject({ status: 422 });
    await b.handle('GET', '/api/profiles');
    await b.handle('PUT', '/api/profiles/Flat', { name: 'Flat', listing_type: 'flat' });
    expect(await b.handle('POST', '/api/profiles/Flat/activate')).toContainEqual({ name: 'Flat', active: true });
    await expect(b.handle('DELETE', '/api/profiles/Flat')).rejects.toMatchObject({ status: 409 });
    await b.handle('DELETE', '/api/profiles/Default');
    await expect(b.handle('GET', '/api/profiles/Default')).rejects.toMatchObject({ status: 404 });
  });
});

describe('listings', () => {
  const idealistaRoom = (): StoredListing => ({ ...emptyListing('idealista', '123', 'https://www.idealista.com/inmueble/123/'),
    id: listingId('idealista', '123'), city: 'barcelona', firstSeen: '', lastSeen: '', title: 'Habitación en Sants',
    description: 'Cut after 320 characters', price: 400, lat: 41.39, lon: 2.17, gender: 'mixed', genderConfirmed: true });
  it('reads a listing in full through the extension, saves it and scores it again', async () => {
    const urls: string[] = [];
    const page: FetchPage = async (req) => { urls.push(req.url); return { ok: true, html: fixture('idealista_ficha.html'), finalUrl: req.url, via: 'fetch' }; };
    const s = await setup({ fetchPage: () => page });
    const l = idealistaRoom();
    await s.db.put('listings', l);
    const r = await s.b.handle('POST', `/api/listings/${l.id}/full`) as { detail_read: boolean; description: string; reasons: string[] };
    expect(urls).toEqual(['https://www.idealista.com/inmueble/123/']);
    expect(r.detail_read).toBe(true);
    expect(r.description).not.toBe('Cut after 320 characters');
    expect(r.reasons.length).toBeGreaterThan(0);
    // Ya leida: no se vuelve a pedir.
    await s.b.handle('POST', `/api/listings/${l.id}/full`);
    expect(urls).toHaveLength(1);
  });
  it('says the extension is needed to read a listing in full', async () => {
    const s = await setup({ fetchPage: () => null });
    const l = idealistaRoom();
    await s.db.put('listings', l);
    await expect(s.b.handle('POST', `/api/listings/${l.id}/full`)).rejects.toMatchObject({ status: 409 });
  });
  it('draws the route from a listing to each destination, asking only once', async () => {
    let asked = 0;
    const route = { minutes: 19, legs: [{ mode: 'transit' as const, line: 'L1', color: '#CE1126', from: 'Sants', to: 'Espanya', minutes: 5, points: [] }] };
    const travel = { name: 'transitous', trips: async (o: [number, number][]) => o.map(() => null),
      route: async () => { asked++; return route; } };
    const s = await setup({ travelFactory: () => travel });
    await s.b.handle('PUT', '/api/profiles/Default', { ...searchRooms,
      destinations: [{ name: 'Work', lat: 41.39, lon: 2.17 }] });
    await s.b.handle('POST', '/api/searches', {});
    await until(s.b);
    const [l] = await s.b.handle('GET', '/api/listings') as { id: string }[];
    const url = `/api/listings/${encodeURIComponent(l.id)}/routes`;
    expect(await s.b.handle('GET', url)).toEqual([{ name: 'Work', route }]);
    await s.b.handle('GET', url);
    expect(asked).toBe(1);
  });
  it('a search stores listings and the list shows the ones that fit', async () => {
    const { b, db } = await withListings();
    const ls = await b.handle('GET', '/api/listings') as { id: string; portal: string; group: string; status: string }[];
    expect(ls.length).toBeGreaterThan(0);
    expect(ls.every((l) => l.portal === 'roomgo' && l.status === 'new')).toBe(true);
    expect((await db.all<StoredListing>('listings')).length).toBeGreaterThanOrEqual(ls.length);
  });
  it('status changes keep a history and the note', async () => {
    const { b } = await withListings();
    const [first] = await b.handle('GET', '/api/listings') as { id: string }[];
    await b.handle('PUT', `/api/listings/${first.id}/note`, { note: 'call Ana' });
    await b.handle('POST', `/api/listings/${first.id}/status`, { status: 'liked' });
    const d = await b.handle('POST', `/api/listings/${first.id}/status`, { status: 'contacted', note: 'sent a message' }) as
      { status: string; note: string; history: { status: string; note: string }[] };
    expect(d.status).toBe('contacted');
    expect(d.note).toBe('sent a message');
    expect(d.history.map((h) => [h.status, h.note])).toEqual([['liked', 'call Ana'], ['contacted', 'sent a message']]);
    expect(await b.handle('GET', '/api/listings?status=contacted')).toHaveLength(1);
    await expect(b.handle('POST', '/api/listings/nope/status', { status: 'liked' })).rejects.toMatchObject({ status: 404 });
    await expect(b.handle('POST', `/api/listings/${first.id}/status`, { status: 'bogus' })).rejects.toMatchObject({ status: 422 });
  });
  it('re-scoring only rewrites what the engine computes', async () => {
    const { b, db } = await withListings();
    const [first] = await b.handle('GET', '/api/listings') as { id: string }[];
    await b.handle('POST', `/api/listings/${first.id}/status`, { status: 'liked', note: 'mine' });
    const before = await db.all('listings');
    // Criterio imposible: nada encaja, pero lo que marcó la usuaria sigue a la vista.
    await b.handle('PUT', '/api/profiles/Default', { ...searchRooms, budget: { ideal_total: 10, max_total: 20 } });
    await b.handle('POST', '/api/searches', { from_cache: true });
    await until(b);
    expect(await db.all('listings')).toEqual(before);
    const ls = await b.handle('GET', '/api/listings') as { id: string; note: string; reasons: string[] }[];
    expect(ls.map((l) => l.id)).toEqual([first.id]);
    expect(ls[0].note).toBe('mine');
    expect(ls[0].reasons[0]).toMatch(/^no longer fits/);
  });
});

describe('searches', () => {
  it('a second tab cannot start a search while one runs', async () => {
    const locks = fakeLocks();
    const factory = new IDBFactory();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: FetchPage = async (req) => { await gate; return roomgoOnly(req); };
    const tab1 = await setup({ locks, fetchPage: () => slow }, factory);
    const tab2 = await setup({ locks }, factory);
    await tab1.b.handle('PUT', '/api/profiles/Default', searchRooms);
    await tab1.b.handle('POST', '/api/searches', {});
    await expect(tab2.b.handle('POST', '/api/searches', {})).rejects.toMatchObject({ status: 409 });
    await expect(tab1.b.handle('POST', '/api/searches', {})).rejects.toMatchObject({ status: 409 });
    const done = until(tab1.b);
    await new Promise((r) => setTimeout(r, 10));
    release();
    expect((await done).at(-1)!.kind).toBe('done');
  });
  it('replays the events so far to a late listener', async () => {
    const { b } = await withListings();
    const replay: SearchEvent[] = [];
    b.subscribe((e) => replay.push(e));
    expect(replay.at(-1)!.kind).toBe('done');
    expect(replay[0].kind).toBe('stage');
  });
});

describe('settings', () => {
  it('keeps keys in the browser and only reports whether they exist', async () => {
    const { b } = await setup();
    await expect(b.handle('PUT', '/api/settings', { travel_provider: 'google' })).rejects.toMatchObject({ status: 422 });
    const s = await b.handle('PUT', '/api/settings', { travel_provider: 'google', google_key: ' K ' });
    expect(s).toEqual({ travel_provider: 'google', has_google_key: true, motis_url: 'https://api.transitous.org' });
    await expect(b.handle('PUT', '/api/settings', { motis_url: 'ftp://x' })).rejects.toMatchObject({ status: 422 });
    const ai = await b.handle('PUT', '/api/ai', { provider: 'anthropic', key: 'sk', model: 'claude-haiku-5-5' });
    expect(ai).toMatchObject({ provider: 'anthropic', has_key: true, model: 'claude-haiku-5-5' });
    expect(JSON.stringify(ai)).not.toContain('sk"');
  });
  it('moves the old "about you" text into the profile description, once', async () => {
    const { b, db } = await setup();
    await db.put('settings', 'Ana, 27, nurse', 'ai_about_me');
    expect(await b.handle('GET', '/api/profiles/active')).toMatchObject({ description: 'Ana, 27, nurse' });
    expect(await db.get('settings', 'ai_about_me')).toBeUndefined();
    expect(await b.handle('GET', '/api/ai')).not.toHaveProperty('about_me');
  });
  it('writes drafts with the profile description', async () => {
    const seen: string[] = [];
    const ai = { name: 'fake', model: 'm', usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
      text: async (_s: string, user: string) => { seen.push(user); return 'Hola'; }, json: async () => ({}) };
    const { b, db } = await setup({ aiFactory: () => ai as never });
    await b.handle('PUT', '/api/ai', { provider: 'anthropic', key: 'k' });
    await b.handle('PUT', '/api/profiles/Default', { name: 'Default', description: 'Quiet person with a cat' });
    const l = { ...emptyListing('roomgo', '1', 'https://x/1'), id: listingId('roomgo', '1'), city: 'barcelona',
      firstSeen: '2026-10-09', lastSeen: '2026-10-09' };
    await db.put('listings', l);
    expect(await b.handle('POST', `/api/listings/${l.id}/draft`)).toEqual({ text: 'Hola' });
    expect(seen[0]).toContain('Quiet person with a cat');
  });
  it('validates the schedule and turns notifications on with a random topic', async () => {
    const { b } = await setup();
    await expect(b.handle('PUT', '/api/schedule', { hours: 1, from: '08:00', to: '23:00' })).rejects.toMatchObject({ status: 422 });
    expect(await b.handle('PUT', '/api/schedule', { hours: 6, from: '09:00', to: '22:00' })).toMatchObject({ hours: 6, from: '09:00' });
    const n = await b.handle('PUT', '/api/notify', { enabled: true, min_score: 70 }) as { topic: string; min_score: number };
    expect(n.topic).toMatch(/^buscapiso-/);
    expect(n.min_score).toBe(70);
    await expect(b.handle('PUT', '/api/notify', { server: 'nope' })).rejects.toBeInstanceOf(HttpError);
  });
  it('answers 404 for routes the desktop app had and the web does not', async () => {
    const { b } = await setup();
    await expect(b.handle('POST', '/api/quit')).rejects.toMatchObject({ status: 404 });
  });
});

describe('listing types', () => {
  it('keeps listings of the other type in the list, so the screen can count them', async () => {
    const { b, db } = await withListings();
    const other: StoredListing = { ...((await db.all<StoredListing>('listings'))[0]), id: 'flat1', sourceId: 'flat1', type: 'flat' };
    await db.put('listings', other);
    await b.handle('POST', '/api/searches', { from_cache: true });
    await until(b);
    const ls = await b.handle('GET', '/api/listings') as { id: string; type: string }[];
    expect(ls.some((l) => l.id === 'flat1' && l.type === 'flat')).toBe(true);
  });
});

describe('cities', () => {
  const granadaPages: Record<string, string> = {
    'https://www.fotocasa.es/es/alquiler/viviendas/granada-capital/todas-las-zonas/l': 'fotocasa_granada_ciudad.html',
    'https://www.habitaclia.com/alquiler/viviendas/granada-provincia/granada-capital/s': 'habitaclia_granada_ciudad.html',
  };
  const portals: FetchPage = async (req) => (granadaPages[req.url]
    ? { ok: true, html: fixture(granadaPages[req.url]), finalUrl: req.url, via: 'fetch' }
    : { ok: false, reason: 'blocked' });
  const nominatim = async (url: string) => (url.includes('featureType=settlement')
    ? [{ lat: '37.17', lon: '-3.59', name: 'Granada', boundingbox: ['37.13', '37.22', '-3.65', '-3.55'],
      address: { city: 'Granada', province: 'Granada', state: 'Andalucía' } }]
    : [{ lat: '37.18', lon: '-3.60' }]);
  const settle = async (b: { handle: (m: string, u: string) => Promise<unknown> }) => {
    for (;;) {
      const d = await b.handle('GET', '/api/cities/discover') as { running: boolean };
      if (!d.running) return d as unknown;
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  it('finds a city, sets it up through the extension and moves the profile there', async () => {
    let closed = 0;
    const { b } = await setup({ fetchPage: () => portals, geoGet: nominatim, onStop: async () => { closed++; } });
    const [granada] = await b.handle('GET', '/api/cities/search?q=Granada') as CityCandidate[];
    expect(granada).toMatchObject({ name: 'Granada', province: 'Granada' });
    expect(await b.handle('POST', '/api/cities/discover', granada)).toEqual({ running: true });
    const done = await settle(b) as { result: { city: { city: string; areas: number } }; error: string | null; log: string[] };
    expect(done.error).toBeNull();
    expect(done.result.city).toMatchObject({ city: 'granada-granada' });
    expect(done.result.city.areas).toBeGreaterThan(5);
    expect(closed).toBe(1);
    await b.handle('POST', '/api/cities/use', { city: 'granada-granada' });
    expect(await b.handle('GET', '/api/profiles/active')).toMatchObject({ city: 'granada-granada' });
    const cities = await b.handle('GET', '/api/cities') as { active: { name: string }; saved: { city: string }[] };
    expect(cities.active.name).toBe('Granada');
    expect(cities.saved.map((c) => c.city)).toEqual(['barcelona', 'granada-granada']);
    expect((await b.handle('GET', '/api/neighbourhoods') as { names: string[] }).names).toContain('Centro');
  });
  it('looks a place up in the city a description names, not inside this one', async () => {
    const urls: string[] = [];
    const { b } = await setup({ geoGet: async (u) => { urls.push(u); return [{ display_name: 'x', lat: '40.4', lon: '-3.7' }]; } });
    await b.handle('GET', '/api/geocode?q=Calle%20Menorca&city=Madrid');
    await b.handle('GET', '/api/geocode?q=Calle%20Menorca&city=Barcelona');
    expect(new URL(urls[0]).searchParams.get('q')).toBe('Calle Menorca, Madrid, España');
    expect(urls[0]).not.toContain('bounded');
    expect(urls[1]).toContain('bounded=1');
  });
  it('uses the built-in Barcelona without asking the portals', async () => {
    const { b } = await setup({ fetchPage: () => { throw new Error('should not fetch'); } });
    await b.handle('POST', '/api/cities/discover', { name: 'Barcelona', province: 'Barcelona', lat: 41.38, lon: 2.17, box: [0, 0, 0, 0] });
    expect(await settle(b)).toMatchObject({ result: { city: { city: 'barcelona' } } });
  });
  it('needs the extension to set up a new city, and refuses an unknown one in a profile', async () => {
    const { b } = await setup({ fetchPage: () => null });
    await expect(b.handle('POST', '/api/cities/discover', { name: 'Granada', province: 'Granada', lat: 37, lon: -3, box: [0, 0, 0, 0] }))
      .rejects.toMatchObject({ status: 409 });
    await expect(b.handle('PUT', '/api/profiles/Default', { name: 'Default', city: 'atlantis' })).rejects.toMatchObject({ status: 422 });
  });
});
