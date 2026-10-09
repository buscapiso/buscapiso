import { describe, expect, it } from 'vitest';
import { emptyListing } from '../model';
import { applyFacts, describeFacts, extractFacts, extractMany, listingFacts, suggestProfile, type ListingFacts } from './extract';
import type { AIProvider } from './providers';
import { AIError, ClaudeProvider, estimateCost, listModels, OpenAICompatProvider } from './providers';
import { notifyNew, randomTopic } from '../notify';

const FACTS: ListingFacts = listingFacts.parse({ household_gender: 'female_only', bills_included: null,
  bills_eur_min: 40, bills_eur_max: 40, owner_lives_in: false, couples_allowed: null, visitors_allowed: true,
  smoking_allowed: false, exterior: null,
  seasonal_or_short_let: true, min_stay_months: 6, roommates: 2, roommates_age_range: '24-28',
  roommates_occupation: 'students', available_from: '2026-11-01', summary: 'Bright room.',
  pros: ['light'], cons: [], red_flags: ['asks for a deposit before visiting'] });

function recorder(answers: { status: number; data: unknown }[]) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];  // eslint-disable-line @typescript-eslint/no-explicit-any
  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    calls.push({ url, headers, body });
    return answers.shift()! as { status: number; data: any };  // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { calls, post };
}
const claudeText = (text: string) => ({ status: 200, data: { content: [{ type: 'text', text }], stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 } } });

describe('Claude', () => {
  it('calls the Messages API from the browser with the key and counts tokens', async () => {
    const { calls, post } = recorder([claudeText('ready')]);
    const p = new ClaudeProvider('sk-1', 'claude-haiku-5-5', post);
    expect(await p.text('sys', 'hi')).toBe('ready');
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers).toMatchObject({ 'x-api-key': 'sk-1', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(calls[0].body).toMatchObject({ model: 'claude-haiku-5-5', system: 'sys' });
    expect(p.usage).toEqual({ calls: 1, inputTokens: 10, outputTokens: 5 });
  });
  it('retries once when the JSON is invalid, then fails', async () => {
    const good = JSON.stringify(FACTS);
    const { post } = recorder([claudeText('not json'), claudeText('```json\n' + good + '\n```')]);
    expect((await new ClaudeProvider('k', undefined, post).json('s', 'u', listingFacts, {})).summary).toBe('Bright room.');
    const bad = recorder([claudeText('x'), claudeText('y')]);
    await expect(new ClaudeProvider('k', undefined, bad.post).json('s', 'u', listingFacts, {})).rejects.toBeInstanceOf(AIError);
  });
  it('reports HTTP errors without the key', async () => {
    const { post } = recorder([{ status: 401, data: {} }]);
    await expect(new ClaudeProvider('sk-secret', undefined, post).text('s', 'u')).rejects.toThrow('Claude answered HTTP 401');
  });
});

describe('OpenAI-compatible', () => {
  it('asks for a JSON object and sends the key as a bearer token', async () => {
    const { calls, post } = recorder([{ status: 200, data: { choices: [{ message: { content: JSON.stringify(FACTS) } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 } } }]);
    const p = new OpenAICompatProvider('k', 'https://api.openai.com/v1/', 'gpt-x', post);
    await p.json('s', 'u', listingFacts, {});
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer k');
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
  });
  it('marks a rate limit so the caller can wait and retry', async () => {
    const { post } = recorder([{ status: 429, data: {} }]);
    const err = await new OpenAICompatProvider('k', 'https://x/v1', 'gemini-x', post).text('s', 'u').catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.status).toBe(429);
  });
  it("passes on the provider's own words and how long it asks to wait", async () => {
    // Gemini, por su API compatible, envuelve el error en una lista.
    const body = [{ error: { code: 429, status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota. Quota exceeded for metric: generate_requests_per_model_per_day',
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31s' }] } }];
    const { post } = recorder([{ status: 429, data: body }]);
    const err = await new OpenAICompatProvider('k', 'https://x/v1', 'gemini-x', post).text('s', 'u').catch((e) => e);
    expect(err.message).toContain('You exceeded your current quota');
    expect(err.retryAfterMs).toBe(31_000);
    expect(err.daily).toBe(true);
  });
  it('explains an empty answer cut by length, and sends no key for Ollama', async () => {
    const { calls, post } = recorder([{ status: 200, data: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } }]);
    await expect(new OpenAICompatProvider('', 'http://localhost:11434/v1', 'llama', post).text('s', 'u'))
      .rejects.toThrow(/ran out of room/);
    expect(calls[0].headers.Authorization).toBeUndefined();
  });
  it('lists chat models without the Gemini prefix', async () => {
    const get = (async () => new Response(JSON.stringify({ data: [{ id: 'models/gemini-3-flash' }, { id: 'text-embedding-4' }, { id: 'gpt-x' }] }))) as typeof fetch;
    expect(await listModels('https://x/v1/', 'k', get)).toEqual(['gemini-3-flash', 'gpt-x']);
  });
  it('estimates cost only for known models', () => {
    expect(estimateCost('claude-haiku-5-5', { calls: 1, inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.1);
    expect(estimateCost('llama', { calls: 1, inputTokens: 5, outputTokens: 5 })).toBeNull();
  });
});

describe('facts', () => {
  const base = () => ({ ...emptyListing('fotocasa', '1', 'https://x'), title: 'Hab', description: 'Piso tranquilo' });
  it('fill gaps on a copy and never override what the portal published', () => {
    const l = { ...base(), gender: 'mixed' as const, genderConfirmed: true, couplesAllowed: false };
    const { listing, ai } = applyFacts(l, FACTS);
    expect(listing).not.toBe(l);
    expect(l.expenses).toBeNull();
    expect(listing).toMatchObject({ gender: 'mixed', expenses: 40, ownerLivesIn: false, couplesAllowed: false,
      visitsAllowed: true, roommates: 2, minStayMonths: 6, roommateAges: '24-28', availableFrom: '01-11-2026' });
    expect(ai).toEqual({ summary: 'Bright room.', pros: ['light'], cons: [], redFlags: ['asks for a deposit before visiting'], aiTemporary: true });
    expect(applyFacts(base(), FACTS).listing.gender).toBe('female_only');
    expect(applyFacts(base(), { ...FACTS, bills_included: true }).listing.expenses).toBe(0);
  });
  it('count a range of bills as its midpoint and say which facts they filled', () => {
    const r = applyFacts(base(), { ...FACTS, bills_included: false, bills_eur_min: 50, bills_eur_max: 100 });
    expect(r.listing.expenses).toBe(75);
    expect(r.listing.smokingAllowed).toBe(false);
    expect(r.filled).toContain('expenses');
    expect(applyFacts({ ...base(), expenses: 30 }, FACTS).filled).not.toContain('expenses');
  });
  it('describe what the AI found in plain words, marking what changed the score', () => {
    const f = { ...FACTS, household_gender: 'female_only' as const, bills_included: false, bills_eur_min: 50, bills_eur_max: 100,
      roommates: 2, roommates_age_range: '37-41', roommates_occupation: 'workers', smoking_allowed: false, exterior: false,
      owner_lives_in: null, visitors_allowed: null, min_stay_months: null, available_from: null, seasonal_or_short_let: false };
    expect(describeFacts(f, ['expenses', 'roommateAges'])).toEqual([
      { label: 'Who lives there', value: 'women only', used: false },
      { label: 'Bills', value: '50–100 € a month, counted as 75 €', used: true },
      { label: 'Roommates', value: '2, aged 37-41, workers', used: true },
      { label: 'Smoking', value: 'not allowed', used: false },
      { label: 'Room', value: 'interior', used: false },
    ]);
    expect(describeFacts({ ...f, bills_included: true }, [])[1]).toEqual({ label: 'Bills', value: 'included', used: false });
  });
  it('are cached by listing text, so a second search does not pay again', async () => {
    const store = new Map<string, ListingFacts>();
    const cache = { get: async (k: string) => store.get(k), put: async (k: string, f: ListingFacts) => { store.set(k, f); } };
    const { calls, post } = recorder([claudeText(JSON.stringify({ listings: [{ ...FACTS, id: '0' }] }))]);
    const p = new ClaudeProvider('k', undefined, post);
    await extractFacts(p, base(), cache);
    await extractFacts(p, base(), cache);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.messages[0].content).toContain('<listing id="0">');
  });
  it('turns a description into a profile suggestion', async () => {
    const { post } = recorder([claudeText(JSON.stringify({ budget_max: 700, places: [{ name: 'UPC', address: 'Campus Nord' }] }))]);
    const s = await suggestProfile(new ClaudeProvider('k', undefined, post), 'max 700, I study at UPC');
    expect(s).toMatchObject({ budget_max: 700, budget_ideal: null, places: [{ name: 'UPC', mode: 'transit', max_minutes: null }] });
  });
});

describe('batched extraction', () => {
  const listing = (i: number) => ({ ...emptyListing('idealista', String(i), `https://x/${i}`), title: `Room ${i}`, description: `Text ${i}` });
  const memory = () => {
    const store = new Map<string, ListingFacts>();
    return { store, cache: { get: async (k: string) => store.get(k), put: async (k: string, f: ListingFacts) => { store.set(k, f); } } };
  };
  /** Un proveedor falso que contesta por los ids que ve en el mensaje. */
  /** `rooms[i]` es el numero de la habitacion que lleva el id i en este lote. */
  function fake(answer: (ids: string[], call: number, rooms: string[]) => unknown[]): AIProvider & { prompts: string[] } {
    const prompts: string[] = [];
    return { name: 'fake', model: 'm', usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, prompts, text: async () => '',
      json: (async (_s: string, user: string, schema: { parse(x: unknown): unknown }) => {
        prompts.push(user);
        const tags = [...user.matchAll(/<listing id="(\d+)">\nTitle: Room (\d+)/g)];
        return schema.parse({ listings: answer(tags.map((m) => m[1]), prompts.length - 1, tags.map((m) => m[2])) });
      }) as AIProvider['json'] };
  }
  const facts = (id: string, summary = `s${id}`) => ({ ...FACTS, id, summary });

  it('reads several listings in one call and caches each one', async () => {
    const { store, cache } = memory();
    const p = fake((ids) => ids.map((id) => facts(id)));
    const ls = [0, 1, 2].map(listing);
    const r = await extractMany(p, ls, cache);
    expect(p.prompts).toHaveLength(1);
    expect(ls.map((l) => r.facts.get(l)?.summary)).toEqual(['s0', 's1', 's2']);
    expect(store.size).toBe(3);
    await extractMany(p, ls, cache);
    expect(p.prompts).toHaveLength(1);
  });
  it('sends at most ten listings per call', async () => {
    const p = fake((ids) => ids.map((id) => facts(id)));
    const r = await extractMany(p, Array.from({ length: 23 }, (_, i) => listing(i)), memory().cache);
    expect(p.prompts).toHaveLength(3);
    expect(r.facts.size).toBe(23);
  });
  it('asks again once for listings the answer left out, then gives up on them', async () => {
    // La habitacion 1 falta la primera vez; la 2, siempre.
    const p = fake((ids, call, rooms) => ids.filter((_, i) => (call > 0 || rooms[i] !== '1') && rooms[i] !== '2').map((id) => facts(id)));
    const ls = [0, 1, 2].map(listing);
    const r = await extractMany(p, ls, memory().cache);
    expect(p.prompts).toHaveLength(2);
    expect(r.facts.has(ls[1])).toBe(true);
    expect(r.facts.has(ls[2])).toBe(false);
  });
  it('skips an item that does not match the schema without losing the rest', async () => {
    const p = fake((ids) => ids.map((id) => (id === '0' ? { id, household_gender: 'robots' } : facts(id))));
    const ls = [0, 1].map(listing);
    const r = await extractMany(p, ls, memory().cache);
    expect(r.facts.has(ls[0])).toBe(false);
    expect(r.facts.get(ls[1])?.summary).toBe('s1');
  });
  const limited = (o: { daily?: boolean; retryAfterMs?: number } = {}) =>
    Object.assign(new AIError('quota', 429), o);
  it('stops asking for the rest of the search when the daily quota is gone', async () => {
    const p = fake(() => { throw limited({ daily: true }); });
    const breaker = { stopped: null as AIError | null };
    const r = await extractMany(p, Array.from({ length: 40 }, (_, i) => listing(i)), memory().cache, { breaker, sleep: async () => {} });
    expect(p.prompts).toHaveLength(1);
    expect(r.stopped?.message).toBe('quota');
    // Otra pasada en la misma busqueda no vuelve a intentarlo.
    await extractMany(p, [listing(99)], memory().cache, { breaker });
    expect(p.prompts).toHaveLength(1);
  });
  it('waits as long as the provider asks, and stops if it keeps refusing', async () => {
    const waits: number[] = [];
    let n = 0;
    const ok = fake((ids) => { if (n++ === 0) throw limited({ retryAfterMs: 31_000 }); return ids.map((id) => facts(id)); });
    const r = await extractMany(ok, [listing(0)], memory().cache, { sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([31_000]);
    expect(r.facts.size).toBe(1);
    const never = fake(() => { throw limited(); });
    const r2 = await extractMany(never, Array.from({ length: 40 }, (_, i) => listing(i)), memory().cache, { sleep: async () => {} });
    expect(r2.stopped).not.toBeNull();
    // Unos pocos intentos, no cuatro por cada uno de los cuatro lotes.
    expect(never.prompts.length).toBeLessThanOrEqual(6);
  });
  it('counts only the listings it actually read', async () => {
    const seen: number[] = [];
    const p = fake((ids, _c, rooms) => ids.filter((_, i) => rooms[i] !== '1').map((id) => facts(id)));
    await extractMany(p, [0, 1, 2].map(listing), memory().cache, { onProgress: (done) => seen.push(done) });
    expect(seen.at(-1)).toBe(2);
  });
  it('keeps going when a whole call fails, and reports it', async () => {
    const p = fake(() => { throw new AIError('HTTP 500', 500); });
    const r = await extractMany(p, [listing(0)], memory().cache);
    expect(r.facts.size).toBe(0);
    expect(r.failures[0].message).toBe('HTTP 500');
  });
});

describe('ntfy', () => {
  const items = [80, 95, 60, 90, 85, 99].map((score, i) => ({ score, totalCost: 500 + i, title: `Room ${i}`, place: 'Gràcia',
    firstTravel: ['Work', 20.4] as [string, number] }));
  it('sends the best new ones above the minimum, three lines at most', async () => {
    const bodies: any[] = [];  // eslint-disable-line @typescript-eslint/no-explicit-any
    const post = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response('{}'); }) as typeof fetch;
    const n = await notifyNew({ server: 'https://ntfy.sh', topic: 't', minScore: 85 }, items, 'room', undefined, post);
    expect(n).toBe(4);
    expect(bodies[0].title).toBe('4 new rooms worth a look');
    expect(bodies[0].message.split('\n')).toEqual(['505 €, 20 min to Work. Room 5', '501 €, 20 min to Work. Room 1',
      '503 €, 20 min to Work. Room 3', 'and 1 more']);
  });
  it('does nothing without a topic and never throws', async () => {
    expect(await notifyNew({ server: 'x', topic: '', minScore: 0 }, items, 'room')).toBe(0);
    const fail = (async () => { throw new Error('offline'); }) as typeof fetch;
    expect(await notifyNew({ server: 'https://ntfy.sh', topic: 't', minScore: 0 }, items, 'flat', undefined, fail)).toBe(0);
    expect(randomTopic()).toMatch(/^buscapiso-[a-z0-9]{10}$/);
  });
});
