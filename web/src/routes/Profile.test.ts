import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Profile from './Profile.svelte';

const profile = {
  name: 'default', sources: ['idealista'], destinations: [
    { name: 'Fira', lat: 41.35, lon: 2.13, max_minutes: 30, minute_weight: 2 }],
  budget: { ideal_total: 500, max_total: 650, assumed_expenses: 55 },
  household: { gender: 'female_only', ask_if_gender_unknown: true, min_score_to_ask: 60,
    no_live_in_owner: true, visits: 'preferred' },
  zones: { exclude: [], penalize: [], prefer: [] }, idealista: {},
  crawl: { sort: 'newest', fotocasa_sort: 'cheapest', max_pages: 3, details_to_read: 12 },
  weights: { novedad: 25 },
};

let saved: unknown = null;

beforeEach(() => {
  saved = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (init?.method === 'PUT') {
      saved = JSON.parse(init.body as string);
      if ((saved as typeof profile).budget.ideal_total > (saved as typeof profile).budget.max_total) {
        return new Response(JSON.stringify({ detail: [
          { loc: ['body', 'budget'], msg: 'Value error, ideal_total cannot be above max_total' }] }),
          { status: 422 });
      }
      return new Response(JSON.stringify(saved));
    }
    if (u.endsWith('/api/profiles')) return new Response(JSON.stringify([{ name: 'default', active: true }]));
    if (u.endsWith('/api/meta')) return new Response(JSON.stringify({
      statuses: [], sources: ['idealista', 'fotocasa'], genders: ['female_only', 'male_only', 'mixed', 'any'] }));
    return new Response(JSON.stringify(profile));
  });
});
afterEach(() => vi.restoreAllMocks());

test('edits and saves the active profile', async () => {
  render(Profile);
  const max = await screen.findByLabelText('Maximum monthly cost');
  await userEvent.clear(max);
  await userEvent.type(max, '700');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved')).toBeInTheDocument();
  expect((saved as typeof profile).budget.max_total).toBe(700);
});

test('shows the server validation error next to the budget', async () => {
  render(Profile);
  const ideal = await screen.findByLabelText('Ideal monthly cost (rent + bills)');
  await userEvent.clear(ideal);
  await userEvent.type(ideal, '900');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/ideal_total cannot be above max_total/)).toBeInTheDocument();
});

test('destinations can be added and removed', async () => {
  render(Profile);
  await screen.findByDisplayValue('Fira');
  await userEvent.click(screen.getByRole('button', { name: 'Add a place' }));
  expect(screen.getAllByLabelText('Name')).toHaveLength(2);
  await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
  expect(screen.queryByDisplayValue('Fira')).toBeNull();
});
