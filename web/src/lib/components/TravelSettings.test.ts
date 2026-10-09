import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import TravelSettings from './TravelSettings.svelte';

let body: Record<string, unknown> | null = null;

beforeEach(() => {
  body = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.endsWith('/test-route')) return new Response(JSON.stringify({
      graph: { minutes: 22, detail: 'L5 > L9S' },
      provider: { name: 'transitous', minutes: 19, detail: 'L5 > L9S' }, error: null }));
    if (init?.method === 'PUT') {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ travel_provider: body!.travel_provider,
        transitous_contact: body!.transitous_contact ?? '', has_google_key: false }));
    }
    return new Response(JSON.stringify({ travel_provider: 'graph', transitous_contact: '', has_google_key: false }));
  });
});
afterEach(() => vi.restoreAllMocks());

test('choosing Transitous asks for a contact and explains its terms', async () => {
  render(TravelSettings);
  await userEvent.click(await screen.findByLabelText(/Transitous/));
  expect(screen.getByText(/open-source, non-commercial/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Your contact (email or website)'), 'ana@example.org');
  await userEvent.click(screen.getByRole('button', { name: 'Save travel settings' }));
  expect(body).toEqual({ travel_provider: 'transitous', transitous_contact: 'ana@example.org' });
});

test('the test compares the estimate with real timetables', async () => {
  render(TravelSettings);
  await userEvent.click(await screen.findByRole('button', { name: 'Test a trip' }));
  expect(await screen.findByText('Estimated: 22 min')).toBeInTheDocument();
  expect(screen.getByText('transitous: 19 min')).toBeInTheDocument();
});

test('the Google key field is write-only', async () => {
  render(TravelSettings);
  await userEvent.click(await screen.findByLabelText(/Google/));
  const key = screen.getByLabelText('API key') as HTMLInputElement;
  expect(key.type).toBe('password');
  expect(key.value).toBe('');
});
