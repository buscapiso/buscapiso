import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import AISettings from './AISettings.svelte';

let body: Record<string, unknown> | null = null;

beforeEach(() => {
  body = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/api/ai/models')) {
      const b = JSON.parse(init!.body as string);
      if (b.key === 'BAD') return new Response(JSON.stringify({ detail: 'The provider answered HTTP 401. Check the key.' }), { status: 502 });
      return new Response(JSON.stringify({ models: ['gemini-flash', 'gemini-pro'] }));
    }
    if (String(url).endsWith('/api/ai/test')) return new Response(JSON.stringify({ ok: true, model: 'm', message: 'The AI answered.' }));
    if (init?.method === 'PUT') {
      body = JSON.parse(init.body as string);
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
  expect(body).toMatchObject({ provider: 'openai_compat', model: 'gemini-flash', key: 'G-KEY',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/' });
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
