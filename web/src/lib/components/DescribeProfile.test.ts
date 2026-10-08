import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import DescribeProfile from './DescribeProfile.svelte';

afterEach(() => vi.restoreAllMocks());

test('suggests settings from a description and applies them on request', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    budget_ideal: null, budget_max: 650, household_gender: 'female_only',
    owner_must_not_live_in: null, visits: null,
    places: [{ name: 'Work', address: 'Fira Gran Via', max_minutes: 30, mode: 'transit' }] })));
  const onapply = vi.fn();
  render(DescribeProfile, { onapply });
  await userEvent.type(screen.getByLabelText("Describe what you're looking for"), 'Girls only, max 650, I work at Fira');
  await userEvent.click(screen.getByRole('button', { name: 'Suggest settings' }));
  expect(await screen.findByText('Maximum monthly cost: 650 €')).toBeInTheDocument();
  expect(screen.getByText('Household: Women only')).toBeInTheDocument();
  expect(screen.getByText('Place: Work (Fira Gran Via), 30 min')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onapply).toHaveBeenCalledWith(expect.objectContaining({ budget_max: 650 }));
});
