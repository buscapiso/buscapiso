import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import AutoSettings from './AutoSettings.svelte';

const puts: [string, unknown][] = [];

beforeEach(() => {
  puts.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (init?.method === 'PUT') {
      const b = JSON.parse(init.body as string);
      puts.push([u, b]);
      if (u.endsWith('/api/notify')) return new Response(JSON.stringify({ server: 'https://ntfy.sh', topic: b.enabled ? 'buscapiso-abc' : '', min_score: 80 }));
      return new Response(JSON.stringify({ hours: b.hours, from: b.from, to: b.to, last_run: null }));
    }
    if (u.endsWith('/api/notify/test')) return new Response(JSON.stringify({ ok: true }));
    if (u.endsWith('/api/notify')) return new Response(JSON.stringify({ server: 'https://ntfy.sh', topic: '', min_score: 80 }));
    return new Response(JSON.stringify({ hours: 0, from: '08:00', to: '23:00', last_run: null }));
  });
});
afterEach(() => vi.restoreAllMocks());

test('turns on automatic searches every few hours', async () => {
  render(AutoSettings);
  await userEvent.selectOptions(await screen.findByLabelText('Search automatically'), '4');
  await userEvent.click(screen.getByRole('button', { name: 'Save automatic searches' }));
  expect(puts[0]).toEqual(['/api/schedule', { hours: 4, from: '08:00', to: '23:00' }]);
});

test('turning on notifications shows the topic to subscribe to', async () => {
  render(AutoSettings);
  await userEvent.click(await screen.findByLabelText('Send good new rooms to my phone'));
  expect(await screen.findByText('buscapiso-abc')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));
  expect(await screen.findByText('Sent. Check your phone.')).toBeInTheDocument();
});
