import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import BrowserBanner from './BrowserBanner.svelte';

afterEach(() => vi.restoreAllMocks());

test('offers to install the browser when it is missing, and shows progress', async () => {
  let estado = { installed: false, installing: false, log: [] as string[], error: null };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      estado = { installed: false, installing: true, log: ['Downloading Chromium 40%'], error: null };
      return new Response(JSON.stringify({ started: true }), { status: 202 });
    }
    return new Response(JSON.stringify(estado));
  });
  render(BrowserBanner, { every: 10 });
  await userEvent.click(await screen.findByRole('button', { name: 'Install the browser (about 150 MB)' }));
  expect(await screen.findByText('Downloading Chromium 40%')).toBeInTheDocument();
  estado = { installed: true, installing: false, log: [], error: null };
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Install the browser/ })).toBeNull());
});

test('says nothing when the browser is there', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ installed: true, installing: false, log: [], error: null })));
  render(BrowserBanner, { every: 10 });
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByRole('button')).toBeNull();
});
