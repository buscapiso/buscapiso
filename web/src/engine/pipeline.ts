// La busqueda de principio a fin: elegir zonas, rastrear los portales en
// paralelo, deduplicar, situar, leer fichas, guardar y puntuar.
//
// rescore() es la mitad que no rastrea: trayectos, IA, filtro y puntuacion.
// La usan tambien "Re-score now" y la importacion de un fichero.
import { applyFacts, extractFacts, type AICache, type AIDerived } from './ai/extract';
import { AIError, type AIProvider } from './ai/providers';
import { CITIES, selectAreas, type Trips } from './coverage';
import { dedupe } from './dedupe';
import type { Geocoder } from './geocode';
import { emptyDerived, listingId, type Derived, type FetchPage, type RawListing, type StoredListing } from './model';
import { activeSources, type Destination, type SearchProfile } from './profiles';
import { filter, score, type Scorable } from './ranking';
import { inferGender, type Area, type Source } from './sources/base';
import { SOURCES } from './sources/index';
import { estimateTrip, TravelError, type Origin, type Trip, type TravelProvider } from './travel';

export type EventKind = 'stage' | 'progress' | 'info' | 'warning' | 'captcha' | 'done' | 'error';
export interface SearchEvent { kind: EventKind; message: string; data: Record<string, unknown> }
export type Emit = (kind: EventKind, message: string, data?: Record<string, unknown>) => void;

export interface PipelineStore {
  discarded(): Promise<Set<string>>;
  listings(city: string): Promise<StoredListing[]>;
  saveListings(ls: StoredListing[]): Promise<void>;
  saveDerived(ds: Derived[]): Promise<void>;
}

export interface Deps {
  /** La extension; null si no esta instalada. */
  fetchPage: FetchPage | null;
  /** Portales que admiten CORS: la web los pide sola. */
  fetchDirect(url: string, form?: Record<string, string>): Promise<string>;
  store: PipelineStore;
  travel: TravelProvider | null;
  geocoder: Geocoder;
  ai: AIProvider | null;
  aiCache: AICache;
  notify?(items: { listing: StoredListing; derived: Derived }[], kind: 'room' | 'flat'): Promise<number>;
  now(): Date;
  sleep(ms: number): Promise<void>;
  random(): number;
  signal?: AbortSignal;
}

export interface SearchOptions { pages?: number; skipDetails?: boolean }
export interface SearchSummary { accepted: number; possible: number; new: number; crawled: number }

const CAPTCHA_TIMEOUT_MS = 180_000;
const localDate = (d: Date) => d.toLocaleDateString('sv-SE');
const stage = (emit: Emit, step: number, message: string) => emit('stage', `${step}/5 ${message}`, { step, total: 5 });

class Cancelled extends Error {}

// --- una pagina -----------------------------------------------------------
type Fetched = { ok: true; body: string } | { ok: false; reason: string };

async function fetchOne(src: Source, url: string, deps: Deps, emit: Emit, form?: Record<string, string>): Promise<Fetched> {
  if (deps.signal?.aborted) return { ok: false, reason: 'cancelled' };
  if (src.direct) {
    try {
      return { ok: true, body: await deps.fetchDirect(url, form) };
    } catch (e) {
      return { ok: false, reason: `network: ${(e as Error).message}` };
    }
  }
  if (!deps.fetchPage) return { ok: false, reason: 'no-extension' };
  const r = await deps.fetchPage({ url, portal: src.name, blockedMarkers: src.blockedMarkers,
    fatalMarkers: src.fatalMarkers, readyMarkers: src.readyMarkers, allowTab: true, timeoutMs: CAPTCHA_TIMEOUT_MS },
  () => emit('captcha', `${src.name} wants you to confirm you're human: solve it in the tab that just opened.`,
    { portal: src.name, wait_seconds: CAPTCHA_TIMEOUT_MS / 1000 }));
  if (!r.ok) return r;
  // Una extension anterior no conoce fatalMarkers: se mira tambien aqui.
  if ((src.fatalMarkers ?? []).some((m) => r.html.includes(m))) return { ok: false, reason: 'banned' };
  if (r.html.length < src.minLength || src.blockedMarkers.some((m) => r.html.includes(m))) return { ok: false, reason: 'blocked' };
  return { ok: true, body: r.html };
}

const pause = (src: Source, deps: Deps) => deps.sleep((src.pause[0] + deps.random() * (src.pause[1] - src.pause[0])) * 1000);

/** Despues de leer la ficha, el genero inferido puede cambiar con la descripcion. */
function mergeDetail(l: RawListing, d: Partial<RawListing>): void {
  Object.assign(l, d);
  if (!l.genderConfirmed) l.gender = inferGender(`${l.title} ${l.description}`);
}

// --- un portal ------------------------------------------------------------
/** Devuelve SIEMPRE lo recogido: un fallo en la zona N no invalida las anteriores. */
async function crawlSource(src: Source, areas: Area[], p: SearchProfile, pages: number, deps: Deps,
  emit: Emit): Promise<RawListing[]> {
  const out: RawListing[] = [];
  const seen = new Set<string>();
  // Zonas con URL propia; varias zonas pueden compartir una (Fotocasa: toda la ciudad).
  const starts = new Map<string, Area | null>();
  for (const a of src.perArea ? areas : []) {
    const u = src.listUrl(a, p, 1);
    if (u && !starts.has(u)) starts.set(u, a);
  }
  if (!starts.size) {
    const u = src.listUrl(null, p, 1);
    if (u) starts.set(u, null);
  }
  let first = true;
  for (const area of starts.values()) {
    for (let page = 1; page <= pages; page++) {
      const url = src.listUrl(area, p, page);
      if (!url) break;
      if (!first) await pause(src, deps);
      first = false;
      const r = await fetchOne(src, url, deps, emit);
      if (!r.ok) {
        if (r.reason === 'cancelled') throw new Cancelled();
        if (r.reason === 'no-extension') {
          emit('warning', `  ${src.name} needs the buscapiso extension; skipping it`, { source: src.name });
          return out;
        }
        if (r.reason === 'banned') {
          emit('warning', `  ${src.name} has blocked this connection for a while (it says it detected misuse). `
            + `It usually lifts within hours; the other portals go on. Keeping ${out.length} listings from it.`, { source: src.name, banned: true });
          return out;
        }
        if (r.reason === 'blocked' || r.reason === 'timeout') {
          emit('warning', `  ${src.name} is blocking us (${r.reason}); keeping ${out.length} listings from it`, { source: src.name });
          return out;
        }
        emit('warning', `  ${src.name} ${area?.name ?? ''} page ${page} failed (${r.reason.slice(0, 60)}); going on`, { source: src.name });
        break;
      }
      const batch = src.parseList(r.body, p.listing_type).filter((l) => !seen.has(l.sourceId));
      batch.forEach((l) => seen.add(l.sourceId));
      out.push(...batch);
      emit('info', `  ${src.name} ${area ? area.name.split(',')[0] + ' ' : ''}page ${page}: ${batch.length} listings`,
        { source: src.name, count: batch.length });
      if (batch.length < src.pageSize) break;
      if (src.totalPages && page >= src.totalPages(r.body)) break;
      if (src.shouldStop?.(batch, p)) break;
    }
  }
  // Sin la ficha, algunos portales no dicen quien vive en el piso.
  if (src.detailsForAll && src.detailRequest && src.parseDetail) {
    emit('info', `  ${src.name}: ${out.length} listings, reading them in full...`);
    for (const l of out) {
      const req = src.detailRequest(l);
      const r = await fetchOne(src, req.url, deps, emit, req.form);
      if (!r.ok) {
        if (r.reason === 'cancelled') throw new Cancelled();
        continue;   // una ficha ilegible no tumba el resto
      }
      mergeDetail(l, src.parseDetail(r.body));
      await pause(src, deps);
    }
  }
  return out;
}

// --- puntuar ----------------------------------------------------------------
interface Working { stored: StoredListing; effective: Scorable; derived: Derived }

function tripsWithFallback(provider: TravelProvider | null, emit: Emit): Trips {
  let warned = false;
  return async (origins: Origin[], d: Destination) => {
    if (provider) {
      try {
        const real = await provider.trips(origins, d);
        return real.map((t, i) => t ?? estimateTrip(origins[i][0], origins[i][1], d));
      } catch (e) {
        if (!(e instanceof TravelError)) throw e;
        if (!warned) emit('warning', `    ${provider.name} did not answer (${e.message}); using estimated times`, { provider: provider.name });
        warned = true;
      }
    }
    return origins.map(([lat, lon]) => estimateTrip(lat, lon, d));
  };
}

function classify(ws: Working[], p: SearchProfile, discarded: Set<string>, today: string): void {
  const res = filter(ws.map((w) => w.effective), p, discarded);
  const byId = new Map(ws.map((w) => [w.stored.id, w]));
  for (const [l, why] of res.rejected) Object.assign(byId.get(l.id)!.derived, { group: 'rejected', rejectReason: why, score: 0, reasons: [] });
  for (const [group, list] of [['accepted', res.accepted], ['possible', res.possible]] as const) {
    for (const l of list) {
      const s = score(l, p, today);
      const w = byId.get(l.id)!;
      Object.assign(w.derived, { group, rejectReason: '', score: s.score, reasons: s.reasons });
      // Los "posibles" solo se enseñan si puntuan bien.
      if (group === 'possible' && s.score < p.household.min_score_to_ask) {
        Object.assign(w.derived, { group: 'rejected', rejectReason: 'gender not confirmed and low score' });
      }
    }
  }
}

const ranked = (ws: Working[]) => ws.filter((w) => w.derived.group !== 'rejected')
  .sort((a, b) => b.derived.score - a.derived.score);

function setTravel(w: Working, d: Destination, t: Trip) {
  w.effective.travel[d.name] = t.minutes;
  w.derived.travel[d.name] = t.minutes;
  w.derived.routes[d.name] = t.detail;
}

/** Trayectos, IA, filtro y puntuacion de los anuncios dados. No rastrea. */
export async function rescore(listings: StoredListing[], p: SearchProfile, deps: Pick<Deps, 'travel' | 'ai' | 'aiCache' | 'now'>,
  discarded: Set<string>, emit: Emit = () => {}): Promise<Derived[]> {
  const today = localDate(deps.now());
  const ws: Working[] = listings.map((l) => ({ stored: l,
    effective: { ...l, travel: {}, aiTemporary: null, redFlags: [] },
    derived: { ...emptyDerived(l.id), alsoOn: [...(l.alsoOn ?? [])] } }));
  const placed = ws.filter((w) => w.stored.lat !== null && w.stored.lon !== null && w.stored.type === p.listing_type);
  const origins = (xs: Working[]): Origin[] => xs.map((w) => [w.stored.lat!, w.stored.lon!]);

  // 1. Estimacion para todos, sin red.
  for (const d of p.destinations) {
    for (const w of placed) setTravel(w, d, estimateTrip(w.stored.lat!, w.stored.lon!, d));
  }
  for (const w of placed) w.derived.travelSource = 'estimate';
  classify(ws, p, discarded, today);

  // 2. Horarios reales: transporte publico con Transitous es una peticion por
  // destino, asi que va para todos; lo demas, para los mejores.
  if (deps.travel && p.destinations.length) {
    const top = ranked(ws).filter((w) => placed.includes(w)).slice(0, p.crawl.real_travel_times);
    const complete = new Map<Working, boolean>();
    try {
      for (const d of p.destinations) {
        const cheap = deps.travel.name === 'transitous' && d.mode === 'transit';
        const who = cheap ? placed : top;
        if (!who.length) continue;
        const trips = await deps.travel.trips(origins(who), d);
        who.forEach((w, i) => {
          const t = trips[i];
          if (t) setTravel(w, d, t);
          complete.set(w, (complete.get(w) ?? true) && !!t);
        });
      }
      for (const [w, ok] of complete) if (ok) w.derived.travelSource = deps.travel.name;
      emit('info', `    Real timetables (${deps.travel.name}) for ${[...complete.values()].filter(Boolean).length} listings`);
    } catch (e) {
      if (!(e instanceof TravelError)) throw e;
      emit('warning', `    ${deps.travel.name} did not answer (${e.message}); using estimated times`, { provider: deps.travel.name });
    }
    classify(ws, p, discarded, today);
  }

  // 3. IA sobre los mejores. Un fallo suelto se salta; si fallan todos, aviso.
  if (deps.ai && p.crawl.ai_listings) {
    const top = ranked(ws).slice(0, p.crawl.ai_listings);
    let read = 0;
    let last: Error | null = null;
    for (const w of top) {
      try {
        const facts = await extractFacts(deps.ai, w.stored, deps.aiCache);
        const { listing, ai } = applyFacts(w.stored, facts);
        w.effective = { ...listing, travel: w.effective.travel, aiTemporary: ai.aiTemporary, redFlags: ai.redFlags };
        Object.assign(w.derived, ai satisfies AIDerived);
        read++;
      } catch (e) {
        if (!(e instanceof AIError)) throw e;
        last = e;
      }
    }
    if (top.length && !read && last) emit('warning', `    The AI did not answer (${last.message}); going on without it`);
    else if (read) emit('info', `    AI: read ${read} listings`, { calls: deps.ai.usage.calls });
    classify(ws, p, discarded, today);
  }
  return ws.map((w) => w.derived);
}

// --- la busqueda ----------------------------------------------------------
export async function runSearch(p: SearchProfile, deps: Deps, emit: Emit, opts: SearchOptions = {}): Promise<SearchSummary> {
  const city = CITIES[p.city];
  if (!city) throw new Error(`unknown city ${p.city}`);
  const pages = opts.pages ?? p.crawl.max_pages;
  try {
    stage(emit, 1, 'Choosing areas and reading the portals...');
    const areas = await selectAreas(city.areas, p.destinations, tripsWithFallback(deps.travel, emit));
    emit('info', `Areas to search: ${areas.length}`, { zones: areas.map((a) => a.name) });
    const names = activeSources(p).filter((n) => SOURCES[n]?.types.includes(p.listing_type));
    const results = await Promise.all(names.map((n) => crawlSource(SOURCES[n], areas, p, pages, deps, emit)
      .catch((e) => {
        if (e instanceof Cancelled) throw e;
        // Que un portal falle no debe tumbar la busqueda entera.
        emit('warning', `  ${n} failed (${String((e as Error).message).slice(0, 70)}); going on with the rest`, { source: n });
        return [] as RawListing[];
      })));
    const raw = results.flat();
    if (!raw.length) {
      emit('warning', 'Nothing could be read from the portals. Try again in a few minutes: they block for a while after many requests in a row.');
      emit('done', 'Done', { new: 0, accepted: 0, possible: 0, crawled: 0 });
      return { accepted: 0, possible: 0, new: 0, crawled: 0 };
    }
    const { unique, alsoOn, merged } = dedupe(raw);
    emit('info', merged ? `    ${raw.length} listings, ${merged} were on two portals -> ${unique.length}` : `    ${unique.length} listings found`);

    stage(emit, 2, 'Placing them on the map (Nominatim, 1 request a second)...');
    const before = await deps.store.listings(p.city);
    const known = new Map(before.map((l) => [l.id, l]));
    let i = 0;
    for (const l of unique) {
      if (deps.signal?.aborted) throw new Cancelled();
      const id = listingId(l.source, l.sourceId);
      const old = known.get(id);
      if (l.lat === null && old?.lat != null) Object.assign(l, { lat: old.lat, lon: old.lon, approximateLocation: old.approximateLocation });
      if (l.lat === null) await deps.geocoder.place(l);
      if (++i % 25 === 0) emit('progress', `    ${i}/${unique.length}`, { done: i, total: unique.length });
    }
    const now = deps.now().toISOString();
    const stored: StoredListing[] = unique.map((l) => {
      const id = listingId(l.source, l.sourceId);
      const old = known.get(id);
      // Lo que ya leimos de la ficha no se pierde al volver a ver el listado.
      const detail = old?.detailRead && !l.detailRead ? pickDetail(old) : {};
      return { ...l, ...detail, id, city: p.city, firstSeen: old?.firstSeen ?? now, lastSeen: now,
        alsoOn: alsoOn.get(l) ?? old?.alsoOn ?? [] };
    });
    await deps.store.saveListings(stored);

    stage(emit, 3, 'Calculating travel times and scores...');
    const discarded = await deps.store.discarded();
    const all = await deps.store.listings(p.city);
    let derived = await rescore(all, p, deps, discarded, emit);

    // 4. Fichas de los mejores de Idealista (dueño, visitas, parejas).
    const top = new Map(derived.filter((d) => d.group === 'accepted').map((d) => [d.id, d]));
    const fresh = new Map(stored.map((l) => [l.id, l]));
    const idealista = SOURCES.idealista;
    const toRead = [...top.values()].sort((a, b) => b.score - a.score)
      .map((d) => fresh.get(d.id)).filter((l): l is StoredListing => !!l && l.source === 'idealista' && !l.detailRead)
      .slice(0, p.crawl.details_to_read);
    if (toRead.length && !opts.skipDetails && deps.fetchPage) {
      stage(emit, 4, `Reading the ${toRead.length} best full listings (guests, owner)...`);
      let read = 0;
      for (const l of toRead) {
        const r = await fetchOne(idealista, idealista.detailRequest!(l).url, deps, emit);
        if (!r.ok) {
          if (r.reason === 'cancelled') throw new Cancelled();
          if (r.reason === 'blocked' || r.reason === 'timeout' || r.reason === 'banned') { emit('warning', '  blocked while reading full listings; keeping what we have'); break; }
          continue;
        }
        mergeDetail(l, idealista.parseDetail!(r.body));
        read++;
        await pause(idealista, deps);
      }
      await deps.store.saveListings(toRead);
      derived = await rescore(await deps.store.listings(p.city), p, deps, discarded, emit);
      emit('info', `    ${read} full listings read`);
    } else stage(emit, 4, 'Full listings skipped');

    stage(emit, 5, 'Saving...');
    await deps.store.saveDerived(derived);
    const newIds = new Set(stored.filter((l) => !known.has(l.id)).map((l) => l.id));
    const accepted = derived.filter((d) => d.group === 'accepted');
    const possible = derived.filter((d) => d.group === 'possible');
    const summary = { accepted: accepted.length, possible: possible.length,
      new: [...accepted, ...possible].filter((d) => newIds.has(d.id)).length, crawled: unique.length };
    if (deps.notify) {
      const byId = new Map(stored.map((l) => [l.id, l]));
      await deps.notify(accepted.filter((d) => newIds.has(d.id)).map((d) => ({ listing: byId.get(d.id)!, derived: d })), p.listing_type)
        .catch(() => 0);
    }
    emit('info', `    ${summary.accepted} fit all your criteria, ${summary.possible} to ask about`);
    emit('done', 'Done', { ...summary });
    return summary;
  } catch (e) {
    if (e instanceof Cancelled) {
      emit('error', 'Search stopped', { cancelled: true });
      return { accepted: 0, possible: 0, new: 0, crawled: 0 };
    }
    emit('error', `The search failed: ${(e as Error).message}`);
    throw e;
  }
}

const DETAIL_FIELDS: (keyof RawListing)[] = ['ownerLivesIn', 'visitsAllowed', 'couplesAllowed', 'smokingAllowed',
  'roommateAges', 'roommateOccupation', 'atmosphere', 'exterior', 'minStayMonths', 'availableFrom', 'description',
  'detailRead', 'gender', 'genderConfirmed'];
function pickDetail(l: StoredListing): Partial<RawListing> {
  return Object.fromEntries(DETAIL_FIELDS.map((k) => [k, l[k]]));
}
