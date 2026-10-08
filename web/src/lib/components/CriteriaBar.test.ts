import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import CriteriaBar from './CriteriaBar.svelte';
import type { SearchProfile } from '../api';

const profile = {
  name: 'default', sources: ['idealista', 'fotocasa'],
  destinations: [{ name: 'Fira', lat: 41.35, lon: 2.13, max_minutes: 30, minute_weight: 2, mode: 'transit', depart_at: '08:30' },
                 { name: 'Gym', lat: 41.38, lon: 2.17, max_minutes: null, minute_weight: 1, mode: 'walk', depart_at: '19:00' }],
  budget: { ideal_total: 500, max_total: 650, assumed_expenses: 55 },
  household: { gender: 'female_only', ask_if_gender_unknown: true, min_score_to_ask: 60, no_live_in_owner: true, visits: 'preferred' },
  zones: { exclude: [], penalize: [], prefer: [] }, idealista: {},
  crawl: { sort: 'newest', fotocasa_sort: 'cheapest', max_pages: 3, details_to_read: 12, real_travel_times: 40 },
  weights: {},
} as unknown as SearchProfile;

test('shows each criterion as a chip', () => {
  render(CriteriaBar, { profile, onsave: vi.fn() });
  expect(screen.getByRole('button', { name: 'Up to 650 €' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Women only' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Up to 30 min to Fira' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '2 portals' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Gym/ })).toBeNull();     // sin limite: no es un filtro
});

test('editing one criterion keeps the rest of the profile', async () => {
  const onsave = vi.fn();
  render(CriteriaBar, { profile, onsave });
  await userEvent.click(screen.getByRole('button', { name: 'Up to 650 €' }));
  const input = screen.getByLabelText('Maximum monthly cost');
  await userEvent.clear(input);
  await userEvent.type(input, '700');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  const saved = onsave.mock.calls[0][0] as SearchProfile;
  expect(saved.budget.max_total).toBe(700);
  expect(saved.household.gender).toBe('female_only');
  expect(saved.destinations).toHaveLength(2);
  expect(profile.budget.max_total).toBe(650);                           // el original no se toca
});

test('travel limits are edited per place', async () => {
  const onsave = vi.fn();
  render(CriteriaBar, { profile, onsave });
  await userEvent.click(screen.getByRole('button', { name: 'Up to 30 min to Fira' }));
  const input = screen.getByLabelText('Max minutes to Fira');
  await userEvent.clear(input);
  await userEvent.type(input, '40');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((onsave.mock.calls[0][0] as SearchProfile).destinations[0].max_minutes).toBe(40);
});

test('cancel closes the editor without saving', async () => {
  const onsave = vi.fn();
  render(CriteriaBar, { profile, onsave });
  await userEvent.click(screen.getByRole('button', { name: 'Women only' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onsave).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});
