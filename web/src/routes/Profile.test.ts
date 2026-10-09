import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Profile from './Profile.svelte';

const profile = {
  name: 'default', listing_type: 'room', sources: ['idealista'], flat_sources: ['fotocasa', 'habitaclia'],
  flat: { ideal_rent: 1100, max_rent: 1400, assumed_bills: 120, min_bedrooms: 1, min_surface_m2: null,
          elevator_required: false, furnished: 'any' },
  destinations: [
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
      if ((saved as typeof profile).budget.ideal_total === 0) {
        return new Response(JSON.stringify({ detail: [
          { loc: ['body', 'budget', 'ideal_total'], msg: 'Input should be greater than 0' }] }),
          { status: 422 });
      }
      if ((saved as typeof profile).budget.ideal_total > (saved as typeof profile).budget.max_total) {
        return new Response(JSON.stringify({ detail: [
          { loc: ['body', 'budget'], msg: 'Value error, ideal_total cannot be above max_total' }] }),
          { status: 422 });
      }
      return new Response(JSON.stringify(saved));
    }
    if (u.includes('/api/geocode')) return new Response(JSON.stringify([
      { name: 'Fira Gran Via, Barcelona', lat: 41.354, lon: 2.127 }]));
    if (u.endsWith('/api/profiles')) return new Response(JSON.stringify([{ name: 'default', active: true }]));
    if (u.endsWith('/api/meta')) return new Response(JSON.stringify({
      statuses: [], sources: ['idealista', 'fotocasa'], flat_sources: ['fotocasa', 'habitaclia'], genders: ['female_only', 'male_only', 'mixed', 'any'] }));
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


test('errors on nested fields are shown, not swallowed', async () => {
  render(Profile);
  const ideal = await screen.findByLabelText('Ideal monthly cost (rent + bills)');
  await userEvent.clear(ideal);
  await userEvent.type(ideal, '0');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/Input should be greater than 0/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Some fields need fixing');
});

test('a destination can be found by address', async () => {
  render(Profile);
  await screen.findByDisplayValue('Fira');
  await userEvent.type(screen.getByLabelText('Find an address'), 'Fira Gran Via');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Fira Gran Via, Barcelona' }));
  expect(screen.getByDisplayValue('41.354')).toBeInTheDocument();
});

test('each destination has a travel mode and a departure time', async () => {
  render(Profile);
  await screen.findByDisplayValue('Fira');
  await userEvent.selectOptions(screen.getByLabelText('How you get there'), 'bike');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved');
  expect((saved as { destinations: { mode: string }[] }).destinations[0].mode).toBe('bike');
});

test('choosing a whole flat swaps the room settings for the flat ones', async () => {
  render(Profile);
  await userEvent.click(await screen.findByLabelText('A whole flat to rent'));
  expect(screen.queryByLabelText('Maximum monthly cost')).toBeNull();
  expect(screen.queryByText("Who you'd live with")).toBeNull();
  expect(screen.getByLabelText('habitaclia')).toBeChecked();
  expect(screen.queryByLabelText('idealista')).toBeNull();
  const max = screen.getByLabelText('Maximum monthly rent (bills included)');
  await userEvent.clear(max);
  await userEvent.type(max, '1300');
  await userEvent.selectOptions(screen.getByLabelText('Furnished'), 'no');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  const p = saved as { listing_type: string; flat: { max_rent: number; furnished: string };
                       budget: { max_total: number } };
  expect(p.listing_type).toBe('flat');
  expect(p.flat.max_rent).toBe(1300);
  expect(p.flat.furnished).toBe('no');
  expect(p.budget.max_total).toBe(650);
});
