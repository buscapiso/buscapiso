// IA opcional con la clave de cada persona, llamada desde el navegador.
// Claude por su API de Messages (con la cabecera que permite el navegador);
// Gemini, OpenAI, OpenRouter y Ollama por su API compatible con OpenAI.
// La salida JSON se valida con zod y se reintenta una vez: algunas capas de
// compatibilidad no respetan un esquema.
import type { ZodType, ZodTypeDef } from 'zod';

type Schema<T> = ZodType<T, ZodTypeDef, unknown>;

export class AIError extends Error {
  /** Cuanto pide el proveedor que se espere antes de volver a intentarlo. */
  retryAfterMs?: number;
  /** Se acabo la cuota del dia: reintentar hoy no sirve. */
  daily?: boolean;
  /** El codigo HTTP, si lo hubo: 429 es "espera y reintenta". */
  constructor(message: string, public status?: number) { super(message); }
}

type Json = any;  // eslint-disable-line @typescript-eslint/no-explicit-any

/** El error tal como lo cuenta el proveedor. Gemini lo envuelve en una lista
 * y dice cuanto esperar en RetryInfo; Claude y OpenAI, en error.message. */
function httpError(who: string, status: number, data: Json): AIError {
  const body = Array.isArray(data) ? data[0] : data;
  const err = body?.error ?? {};
  const text = typeof err === 'string' ? err : err.message;
  const words = text ? String(text).slice(0, 240).trim().replace(/[.\s]+$/, '') : '';
  const e = new AIError(words ? `${who} answered HTTP ${status}: ${words}` : `${who} answered HTTP ${status}`, status);
  const delay = (Array.isArray(err.details) ? err.details : []).find((d: Json) => d?.retryDelay)?.retryDelay;
  if (delay) e.retryAfterMs = Math.round(parseFloat(delay) * 1000);
  e.daily = status === 429 && /per.?day|daily/i.test(JSON.stringify(err));
  return e;
}
export interface Usage { calls: number; inputTokens: number; outputTokens: number }

export interface AIProvider {
  name: string;
  model: string;
  usage: Usage;
  text(system: string, user: string, maxTokens?: number): Promise<string>;
  json<T>(system: string, user: string, schema: Schema<T>, jsonSchema: object, maxTokens?: number): Promise<T>;
}

type Post = (url: string, headers: Record<string, string>, body: unknown) => Promise<{ status: number; data: any }>;  // eslint-disable-line @typescript-eslint/no-explicit-any

export const browserPost: Post = async (url, headers, body) => {
  let r: Response;
  try {
    r = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new AIError('Could not reach the AI provider');
  }
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

// Dolares por millon de tokens (entrada, salida).
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
};
export function estimateCost(model: string, u: Usage): number | null {
  const p = PRICES[model];
  return p ? (u.inputTokens * p[0] + u.outputTokens * p[1]) / 1_000_000 : null;
}

const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

async function jsonWithRetry<T>(complete: (system: string) => Promise<string>, system: string,
  schema: Schema<T>, jsonSchema: object): Promise<T> {
  const sys = `${system}\n\nReply with a single JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(jsonSchema)}`;
  for (let i = 0; i < 2; i++) {
    const raw = await complete(sys);
    const m = raw.match(FENCE);
    try {
      const parsed = schema.safeParse(JSON.parse(m ? m[1] : raw));
      if (parsed.success) return parsed.data;
    } catch { /* reintenta */ }
  }
  throw new AIError('The model did not return valid JSON');
}

export class ClaudeProvider implements AIProvider {
  name = 'anthropic';
  usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  constructor(private key: string, public model = 'claude-opus-5-5', private post: Post = browserPost) {}

  private async complete(system: string, user: string, maxTokens: number): Promise<string> {
    const { status, data } = await this.post('https://api.anthropic.com/v1/messages', {
      'x-api-key': this.key, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }, { model: this.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
    if (status !== 200) throw httpError('Claude', status, data);
    this.usage.calls++;
    this.usage.inputTokens += data.usage?.input_tokens ?? 0;
    this.usage.outputTokens += data.usage?.output_tokens ?? 0;
    if (data.stop_reason === 'refusal') throw new AIError('Claude declined this request');
    const text = (data.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? '';
    if (!text) throw new AIError('Claude returned no text');
    return text;
  }

  text(system: string, user: string, maxTokens = 1024) { return this.complete(system, user, maxTokens); }
  json<T>(system: string, user: string, schema: Schema<T>, jsonSchema: object, maxTokens = 4096) {
    return jsonWithRetry((sys) => this.complete(sys, user, maxTokens), system, schema, jsonSchema);
  }
}

export class OpenAICompatProvider implements AIProvider {
  name = 'openai_compat';
  usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  private url: string;
  constructor(private key: string, baseUrl: string, public model: string, private post: Post = browserPost) {
    this.url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  }

  private async complete(system: string, user: string, maxTokens: number, jsonMode: boolean): Promise<string> {
    const body: Record<string, unknown> = { model: this.model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const { status, data } = await this.post(this.url, this.key ? { Authorization: `Bearer ${this.key}` } : {}, body);
    if (status !== 200) throw httpError('The AI provider', status, data);
    this.usage.calls++;
    this.usage.inputTokens += data.usage?.prompt_tokens ?? 0;
    this.usage.outputTokens += data.usage?.completion_tokens ?? 0;
    const choice = data.choices?.[0];
    if (!choice?.message) throw new AIError('The AI provider returned an unexpected answer');
    const content = choice.message.content ?? '';
    if (!content && choice.finish_reason === 'length') {
      throw new AIError('The model ran out of room before answering (it spends tokens thinking). Try a lighter model.');
    }
    return content;
  }

  async text(system: string, user: string, maxTokens = 1024) {
    const t = (await this.complete(system, user, maxTokens, false)).trim();
    if (!t) throw new AIError('The AI provider returned no text');
    return t;
  }
  json<T>(system: string, user: string, schema: Schema<T>, jsonSchema: object, maxTokens = 4096) {
    return jsonWithRetry((sys) => this.complete(sys, user, maxTokens, true), system, schema, jsonSchema);
  }
}

// Modelos que /models incluye pero que no conversan.
const NO_CHAT = /embed|imagen|image-gen|dall-e|veo|tts|audio|whisper|transcri|moderation|\baqa\b|\/aqa/i;

/** La lista estandar /models de las APIs compatibles con OpenAI. */
export async function listModels(baseUrl: string, key = '', get: typeof fetch = fetch): Promise<string[]> {
  let r: Response;
  try {
    r = await get(baseUrl.replace(/\/+$/, '') + '/models', { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  } catch {
    throw new AIError('Could not reach the provider');
  }
  if (!r.ok) throw new AIError(`The provider answered HTTP ${r.status}. Check the key.`);
  const data = await r.json();
  // Gemini nombra sus modelos "models/gemini-..."; su API espera el nombre sin prefijo.
  const ids = new Set<string>();
  for (const m of data.data ?? []) {
    if (m?.id && !NO_CHAT.test(m.id)) ids.add(String(m.id).replace(/^models\//, ''));
  }
  return [...ids].sort();
}
