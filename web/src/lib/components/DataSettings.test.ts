import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import DataSettings from './DataSettings.svelte';

let calls: { url: string; method: string; body: unknown }[] = [];
beforeEach(() => {
  calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith('/api/data/status')) return new Response(JSON.stringify({ listings: 312, bytes: 18 * 1048576, persisted: true }));
    if (u.includes('/api/data/export')) return new Response(JSON.stringify({ format: 'buscapiso', summary: { city: 'barcelona' } }));
    if (u.endsWith('/import/preview')) return new Response(JSON.stringify({ token: 'tk', kind: 'share', city: 'barcelona',
      types: ['room'], searchedFrom: '2026-10-07T10:00:00Z', searchedTo: '2026-10-09T10:00:00Z', total: 312, newToYou: 41,
      skipped: 0, states: 0, profiles: 0 }));
    if (u.endsWith('/import/apply')) return new Response(JSON.stringify({ added: 41, updated: 271, missing: 0, states: 0, profiles: 0 }));
    if (u.endsWith('/api/data/clear')) return new Response(JSON.stringify({ ok: true }));
    return new Response('{}');
  });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

test('shows what is stored and that it stays here', async () => {
  render(DataSettings);
  expect(await screen.findByText(/312 listings, 18.0 MB/)).toBeInTheDocument();
  expect(screen.getByText('Your data stays in this browser. buscapiso has no server.')).toBeInTheDocument();
});

test('exports a share file as a download', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(DataSettings);
  await userEvent.click(screen.getByRole('button', { name: 'Export to share' }));
  expect(calls.some((c) => c.url.endsWith('/api/data/export?kind=share'))).toBe(true);
  expect(click).toHaveBeenCalled();
});

test('importing shows a summary first and merges only after confirming', async () => {
  render(DataSettings);
  const file = new File(['{"format":"buscapiso"}'], 'b.json', { type: 'application/json' });
  await userEvent.upload(screen.getByLabelText('Choose a buscapiso file'), file);
  expect(await screen.findByText(/312 listings · Barcelona · rooms · searched .* · 41 new to you/)).toBeInTheDocument();
  expect(calls.some((c) => c.url.endsWith('/import/apply'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Import' }));
  expect(await screen.findByText(/41 new listings, 271 updated/)).toBeInTheDocument();
  expect(calls.find((c) => c.url.endsWith('/import/apply'))!.body).toEqual({ token: 'tk' });
});

test('deleting everything needs a second, in-page confirmation', async () => {
  const confirm = vi.spyOn(window, 'confirm');
  render(DataSettings);
  await userEvent.click(screen.getByRole('button', { name: 'Delete all data in this browser' }));
  expect(calls.some((c) => c.url.endsWith('/api/data/clear'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Yes, delete everything' }));
  expect(await screen.findByText('Everything was deleted.')).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
});
