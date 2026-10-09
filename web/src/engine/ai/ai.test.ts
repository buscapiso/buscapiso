import { describe, expect, it } from 'vitest';
import { emptyListing } from '../model';
import { applyFacts, extractFacts, listingFacts, suggestProfile, type ListingFacts } from './extract';
import { AIError, ClaudeProvider, estimateCost, listModels, OpenAICompatProvider } from './providers';
import { notifyNew, randomTopic } from '../notify';

const FACTS: ListingFacts = listingFacts.parse({ household_gender: 'female_only', bills_included: null,
  bills_amount_eur: 40, owner_lives_in: false, couples_allowed: null, visitors_allowed: true,
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
  it('are cached by listing text, so a second search does not pay again', async () => {
    const store = new Map<string, ListingFacts>();
    const cache = { get: async (k: string) => store.get(k), put: async (k: string, f: ListingFacts) => { store.set(k, f); } };
    const { calls, post } = recorder([claudeText(JSON.stringify(FACTS))]);
    const p = new ClaudeProvider('k', undefined, post);
    await extractFacts(p, base(), cache);
    await extractFacts(p, base(), cache);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.messages[0].content).toContain('<listing>');
  });
  it('turns a description into a profile suggestion', async () => {
    const { post } = recorder([claudeText(JSON.stringify({ budget_max: 700, places: [{ name: 'UPC', address: 'Campus Nord' }] }))]);
    const s = await suggestProfile(new ClaudeProvider('k', undefined, post), 'max 700, I study at UPC');
    expect(s).toMatchObject({ budget_max: 700, budget_ideal: null, places: [{ name: 'UPC', mode: 'transit', max_minutes: null }] });
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
