import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import AISettings from './AISettings.svelte';

let body: Record<string, unknown> | null = null;
let puts: Record<string, unknown>[] = [];

beforeEach(() => {
  body = null;
  puts = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/api/ai/models')) {
      const b = JSON.parse(init!.body as string);
      if (b.key === 'BAD') return new Response(JSON.stringify({ detail: 'The provider answered HTTP 401. Check the key.' }), { status: 502 });
      return new Response(JSON.stringify({ models: ['gemini-flash', 'gemini-pro'] }));
    }
    if (String(url).endsWith('/api/ai/test')) return new Response(JSON.stringify({ ok: true, model: 'm', message: 'The AI answered.' }));
    if (init?.method === 'PUT') {
      body = JSON.parse(init.body as string);
      puts.push(body!);
      return new Response(JSON.stringify({ provider: body!.provider, model: body!.model ?? '',
        base_url: body!.base_url ?? '', has_key: Boolean(body!.key), about_me: body!.about_me ?? '' }));
    }
    return new Response(JSON.stringify({ provider: 'none', model: '', base_url: '', has_key: false, about_me: '' }));
  });
});
afterEach(() => vi.restoreAllMocks());

test('choosing Gemini fills its OpenAI-compatible address', async () => {
  render(AISettings);
  await userEvent.click(await screen.findByLabelText(/Gemini/));
  await userEvent.type(screen.getByLabelText('API key'), 'G-KEY');
  await userEvent.click(screen.getByRole('button', { name: 'Load models' }));
  await userEvent.selectOptions(await screen.findByLabelText('Model'), 'gemini-flash');
  await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
  expect(body).toMatchObject({ provider: 'openai_compat', model: 'gemini-flash',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/' });
  expect(puts.some((b) => b.key === 'G-KEY')).toBe(true);
});

test('Claude offers its models with their prices', async () => {
  render(AISettings);
  await userEvent.click(await screen.findByLabelText(/Claude/));
  expect(screen.getByRole('option', { name: /Haiku 5\.5.*\$0\.10/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Model'), 'claude-haiku-5-5');
  await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
  expect(body).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
});

test('Ollama needs no key', async () => {
  render(AISettings);
  await userEvent.click(await screen.findByLabelText(/Ollama/));
  expect(screen.queryByLabelText('API key')).toBeNull();
});

test('if the model list fails, the error shows and the name can be typed', async () => {
  render(AISettings);
  await userEvent.click(await screen.findByLabelText(/OpenAI/));
  await userEvent.type(screen.getByLabelText('API key'), 'BAD');
  await userEvent.click(screen.getByRole('button', { name: 'Load models' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 401');
  await userEvent.type(screen.getByLabelText('Model name'), 'gpt-something');
  await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
  expect(body).toMatchObject({ provider: 'openai_compat', model: 'gpt-something' });
});

test('the chosen model is saved without a separate Save, and Test saves first', async () => {
  const orden: string[] = [];
  vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
    const u = String(url);
    orden.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.endsWith('/api/ai/models')) return new Response(JSON.stringify({ models: ['gemini-flash', 'gemini-pro'] }));
    if (u.endsWith('/api/ai/test')) return new Response(JSON.stringify({ ok: true, model: 'gemini-pro', message: 'The AI answered.' }));
    if (init?.method === 'PUT') {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ provider: 'openai_compat', model: body!.model, base_url: body!.base_url,
        has_key: true, about_me: '' }));
    }
    return new Response(JSON.stringify({ provider: 'none', model: '', base_url: '', has_key: false, about_me: '' }));
  });
  render(AISettings);
  await userEvent.click(await screen.findByLabelText(/Gemini/));
  await userEvent.type(screen.getByLabelText('API key'), 'G-KEY');
  await userEvent.click(screen.getByRole('button', { name: 'Load models' }));
  await screen.findByLabelText('Model');
  expect(body).toMatchObject({ model: 'gemini-flash', key: 'G-KEY' });           // guardado al cargar
  await userEvent.selectOptions(screen.getByLabelText('Model'), 'gemini-pro');
  await userEvent.click(screen.getByRole('button', { name: 'Test the AI' }));
  expect(await screen.findByText('The AI answered.')).toBeInTheDocument();
  const ultimoPut = orden.lastIndexOf(orden.filter((x) => x.startsWith('PUT')).at(-1)!);
  expect(ultimoPut).toBeLessThan(orden.indexOf('POST /api/ai/test'));
  expect(body).toMatchObject({ model: 'gemini-pro' });
});
