import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import CityPicker from './CityPicker.svelte';

afterEach(() => vi.restoreAllMocks());

test('finds a town, sets it up and switches to it', async () => {
  const bcn = { city: 'barcelona', name: 'Barcelona', province: 'Barcelona', center: [41.38, 2.17], areas: 19, portals: {} };
  const gr = { city: 'granada-granada', name: 'Granada', province: 'Granada', center: [37.17, -3.59], areas: 14, portals: {} };
  let active = bcn;
  const used: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    const json = (x: unknown) => new Response(JSON.stringify(x));
    if (u.includes('/api/cities/search')) return json([{ name: 'Granada', province: 'Granada', lat: 37.17, lon: -3.59, box: [0, 0, 0, 0] }]);
    if (u.endsWith('/api/cities/discover') && init?.method === 'POST') return json({ running: false });
    if (u.endsWith('/api/cities/discover')) return json({ running: false, log: [], error: null,
      result: { city: gr, notes: [{ portal: 'fotocasa', found: true, detail: '9 districts' },
        { portal: 'roomgo', found: false, detail: 'not in this city' }] } });
    if (u.endsWith('/api/cities/use')) { used.push(JSON.parse(String(init!.body)).city); active = gr; return json(gr); }
    return json({ active, saved: [bcn] });
  });
  const onchange = vi.fn();
  render(CityPicker, { onchange });
  expect(await screen.findByText(/You're searching in Barcelona/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Search somewhere else'), 'Granada');
  await userEvent.click(screen.getByRole('button', { name: 'Find' }));
  await userEvent.click(await screen.findByRole('button', { name: /Granada/ }));
  expect(await screen.findByText('9 districts')).toBeInTheDocument();
  expect(screen.getByText('not here')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Search in Granada' }));
  expect(used).toEqual(['granada-granada']);
  expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Granada' }));
  expect(await screen.findByText(/You're searching in Granada/)).toBeInTheDocument();
});

test.each([
  [0.93, /nearly all of Zaragoza, so travel times are real/],
  [0.65, /about 65% of Zaragoza/],
  [0.21, /only 21% of Zaragoza; it probably lacks the city buses/],
])('says how much of the city the timetables cover (%s)', async (share, text) => {
  const zgz = { city: 'zaragoza-zaragoza', name: 'Zaragoza', province: 'Zaragoza', center: [41.65, -0.88], areas: 10, portals: {},
    transit: { share, provider: 'transitous' } };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ active: zgz, saved: [zgz] })));
  render(CityPicker, { onchange: vi.fn() });
  expect(await screen.findByText(text)).toBeInTheDocument();
});
