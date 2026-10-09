import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Nav from './Nav.svelte';

test('the phone bar keeps five tabs at hand and the rest under More', async () => {
  render(Nav, { current: 'inbox' });
  const bar = screen.getByRole('navigation', { name: 'Main (phone)' });
  // jsdom no oculta lo que hay dentro de un <details> cerrado: solo los enlaces directos.
  const visibles = [...bar.querySelectorAll(':scope > a')].map((a) => a.textContent?.trim());
  expect(visibles).toEqual(['Inbox', 'Liked', 'Map', 'Search', 'Settings']);
  await userEvent.click(within(bar).getByText('More'));
  expect(within(bar).getByRole('link', { name: 'Board' })).toBeVisible();
  expect(within(bar).getByRole('link', { name: 'Phone' })).toBeVisible();
});

test('the current tab is marked', () => {
  render(Nav, { current: 'map' });
  const bar = screen.getByRole('navigation', { name: 'Main (phone)' });
  expect(within(bar).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
});
