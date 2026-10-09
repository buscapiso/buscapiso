import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import TravelSettings from './TravelSettings.svelte';

let body: Record<string, unknown> | null = null;

beforeEach(() => {
  body = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.endsWith('/test-route')) return new Response(JSON.stringify({
      estimate: { minutes: 22, detail: 'estimate' },
      provider: { name: 'transitous', minutes: 19, detail: 'L5 > L9S' }, error: null }));
    if (init?.method === 'PUT') {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ travel_provider: body!.travel_provider, has_google_key: false,
        motis_url: body!.motis_url ?? 'https://api.transitous.org' }));
    }
    return new Response(JSON.stringify({ travel_provider: 'google', has_google_key: false,
      motis_url: 'https://api.transitous.org' }));
  });
});
afterEach(() => vi.restoreAllMocks());

test('Transitous needs no setup and explains its terms; there is no offline map any more', async () => {
  render(TravelSettings);
  await userEvent.click(await screen.findByLabelText(/Transitous/));
  expect(screen.getByText(/open-source, non-commercial/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/contact/i)).toBeNull();
  expect(screen.queryByText(/Built-in/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Save travel settings' }));
  expect(body).toEqual({ travel_provider: 'transitous', motis_url: 'https://api.transitous.org' });
});

test('the test compares the estimate with real timetables', async () => {
  render(TravelSettings);
  await userEvent.click(await screen.findByRole('button', { name: 'Test a trip' }));
  expect(await screen.findByText('Straight-line estimate: 22 min')).toBeInTheDocument();
  expect(screen.getByText('transitous: 19 min')).toBeInTheDocument();
});

test('the Google key field is write-only', async () => {
  render(TravelSettings);
  await userEvent.click(await screen.findByLabelText(/Google/));
  const key = screen.getByLabelText('API key') as HTMLInputElement;
  expect(key.type).toBe('password');
  expect(key.value).toBe('');
});

test('your own MOTIS server can be used', async () => {
  render(TravelSettings);
  await userEvent.click(await screen.findByLabelText(/Transitous/));
  const server = screen.getByLabelText('Timetable server');
  await userEvent.clear(server);
  await userEvent.type(server, 'http://localhost:8080');
  await userEvent.click(screen.getByRole('button', { name: 'Save travel settings' }));
  expect(body).toEqual({ travel_provider: 'transitous', motis_url: 'http://localhost:8080' });
});
