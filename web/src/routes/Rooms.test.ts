import { render, screen, within } from '@testing-library/svelte';
import Rooms from './Rooms.svelte';

const L = (id: string, status: string, group = 'accepted') => ({
  id, status, group, title: `Room ${id}`, total_cost: 500, price: 450, expenses: 50, score: 90,
  travel: {}, routes: {}, neighbourhood: 'Sants', municipality: 'Barcelona', photo: '', portal: 'idealista',
  lat: 41.37, lon: 2.14, summary: '', reasons: [],
});

const profile = { name: 'default', sources: ['idealista'], destinations: [],
  budget: { ideal_total: 500, max_total: 650, assumed_expenses: 55 },
  household: { gender: 'female_only' }, zones: { exclude: [], penalize: [], prefer: [] }, crawl: {}, weights: {} };

beforeEach(() => {
  vi.stubGlobal('EventSource', class { close() {} });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/api/listings')) return new Response(JSON.stringify([
      L('a', 'new'), L('b', 'new'), L('c', 'liked'), L('d', 'contacted'), L('e', 'new', 'possible'), L('f', 'hidden')]));
    if (u.includes('/api/profiles/active')) return new Response(JSON.stringify(profile));
    return new Response(JSON.stringify({ running: false, id: null, events: [], summary: null }));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('filters are chips with counts, and the list shows only that filter', async () => {
  render(Rooms, { filter: 'new', view: 'list' });
  await screen.findByText('Room a');
  const filtros = screen.getByRole('navigation', { name: 'Filter by status' });
  const n = (label: string) => within(filtros).getByRole('link', { name: new RegExp(`^${label}`) }).textContent;
  expect(n('New')).toMatch(/2/);
  expect(n('Liked')).toMatch(/1/);
  expect(n('In progress')).toMatch(/1/);
  expect(n('Ask first')).toMatch(/1/);
  expect(n('Hidden')).toMatch(/1/);
  expect(screen.getByText('Room a')).toBeInTheDocument();
  expect(screen.queryByText('Room c')).toBeNull();
});

test('each filter link keeps the current view', async () => {
  render(Rooms, { filter: 'new', view: 'map' });
  const filtros = await screen.findByRole('navigation', { name: 'Filter by status' });
  expect(within(filtros).getByRole('link', { name: /^Liked/ })).toHaveAttribute('href', '#/?f=liked&v=map');
});

test('the board view shows tracking columns instead of status chips', async () => {
  render(Rooms, { filter: 'new', view: 'board' });
  expect(await screen.findByRole('region', { name: 'Liked' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Filter by status' })).toBeNull();
});

test('search and criteria live on the same page', async () => {
  render(Rooms, { filter: 'new', view: 'list' });
  expect(await screen.findByRole('button', { name: 'Search now' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Up to 650 €' })).toBeInTheDocument();
});
