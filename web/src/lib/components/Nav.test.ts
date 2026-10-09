import { render, screen, within } from '@testing-library/svelte';
import Nav from './Nav.svelte';

test('two places on the computer: Rooms and Settings', () => {
  render(Nav, { route: { name: 'rooms', filter: 'new', view: 'list' } });
  const nav = screen.getByRole('navigation', { name: 'Main' });
  expect(within(nav).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Rooms', 'Settings']);
  expect(within(nav).getByRole('link', { name: 'Rooms' })).toHaveAttribute('aria-current', 'page');
});

test('the phone bar adds a shortcut to the map', () => {
  render(Nav, { route: { name: 'rooms', filter: 'liked', view: 'map' } });
  const bar = screen.getByRole('navigation', { name: 'Main (phone)' });
  expect(within(bar).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Rooms', 'Map', 'Settings']);
  expect(within(bar).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
  expect(within(bar).getByRole('link', { name: 'Map' })).toHaveAttribute('href', '#/?f=liked&v=map');
});

test('settings is current on any settings section', () => {
  render(Nav, { route: { name: 'settings', section: 'ai' } });
  const nav = screen.getByRole('navigation', { name: 'Main' });
  expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
});
