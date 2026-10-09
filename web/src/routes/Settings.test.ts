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
    'Automatic searches', 'Alerts', 'AI', 'Your data']);
  expect(within(nav).getByRole('link', { name: 'AI' })).toHaveAttribute('aria-current', 'page');
  expect(within(nav).getByRole('link', { name: 'Places & travel' })).toHaveAttribute('href', '#/settings/places');
});

test('only the chosen section is shown', async () => {
  render(Settings, { section: 'ai' });
  expect(await screen.findByText('AI (optional)')).toBeInTheDocument();
  expect(screen.queryByText('Travel times')).toBeNull();
});

test('there is no way to quit: nothing runs outside this tab', async () => {
  render(Settings, { section: 'ai' });
  expect(await screen.findByText('AI (optional)')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Quit/ })).toBeNull();
});
