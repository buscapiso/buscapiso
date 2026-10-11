import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Welcome from './Welcome.svelte';
import { ext } from '../lib/extensionState.svelte';

vi.mock('../lib/extension', async (orig) => ({ ...(await orig<typeof import('../lib/extension')>()),
  detectExtension: async () => ext.status }));

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  ext.status = { installed: true, outdated: false, version: '9.9.9', browser: 'chrome' };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
    return new Response(JSON.stringify({ active: null, saved: [], provider: 'none', model: '', presets: [] }));
  });
});
afterEach(() => vi.restoreAllMocks());

test('walks through the steps, extension first, and can go back', async () => {
  render(Welcome);
  expect(screen.getByRole('heading', { name: /Step 1 of 5: The extension/ })).toBeInTheDocument();
  expect(screen.getByText(/five short steps/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('heading', { name: /Step 2 of 5: Your city/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('heading', { name: /Step 3 of 5: AI \(optional\)/ })).toBeInTheDocument();
  expect(screen.getByText(/Gemini has a free tier/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('heading', { name: /Step 2 of 5/ })).toBeInTheDocument();
  // Los pasos siguientes no se saltan desde la lista.
  expect(screen.getByRole('button', { name: /What you're looking for/ })).toBeDisabled();
});

test('skipping marks the welcome as done and goes to the settings', async () => {
  render(Welcome);
  await userEvent.click(screen.getByRole('button', { name: "Skip, I'll set it up myself" }));
  expect(calls.some((c) => c.startsWith('PUT') && c.includes('/api/welcome'))).toBe(true);
  expect(location.hash).toBe('#/settings');
});
