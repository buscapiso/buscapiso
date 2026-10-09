import { render, screen, within } from '@testing-library/svelte';
import Settings from './Settings.svelte';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ provider: 'none', model: '', base_url: '', has_key: false, about_me: '' })));
});
afterEach(() => vi.restoreAllMocks());

test('sections are links, and the current one is marked', () => {
  render(Settings, { section: 'ai' });
  const nav = screen.getByRole('navigation', { name: 'Settings sections' });
  const nombres = within(nav).getAllByRole('link').map((a) => a.textContent?.trim());
  expect(nombres).toEqual(["What you're looking for", 'Places & travel', 'Neighbourhoods',
    'Automatic searches', 'Phone & alerts', 'AI']);
  expect(within(nav).getByRole('link', { name: 'AI' })).toHaveAttribute('aria-current', 'page');
  expect(within(nav).getByRole('link', { name: 'Places & travel' })).toHaveAttribute('href', '#/settings/places');
});

test('only the chosen section is shown', async () => {
  render(Settings, { section: 'ai' });
  expect(await screen.findByText('AI (optional)')).toBeInTheDocument();
  expect(screen.queryByText('Travel times')).toBeNull();
});

test('buscapiso can be closed from settings', async () => {
  const f = vi.mocked(globalThis.fetch);
  render(Settings, { section: 'search' });
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.click(screen.getByRole('button', { name: 'Quit buscapiso' }));
  expect(f.mock.calls.some(([u, i]) => String(u).endsWith('/api/quit') && i?.method === 'POST')).toBe(true);
  expect(await screen.findByText('buscapiso is closed. You can close this tab.')).toBeInTheDocument();
});
