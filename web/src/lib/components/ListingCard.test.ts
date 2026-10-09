import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ListingCard from './ListingCard.svelte';
import type { Listing } from '../api';

const listing = {
  id: 'a1', portal: 'idealista', url: 'https://x/1', title: 'Room in Sants',
  price: 450, expenses: 50, total_cost: 500, neighbourhood: 'Sants',
  municipality: 'Barcelona', photo: '', travel: { Fira: 12.4, Collblanc: 9.6 },
  score: 87.6, status: 'new', group: 'accepted', reasons: [],
} as unknown as Listing;

test('shows the total monthly cost and the minutes to each place', () => {
  render(ListingCard, { listing });
  expect(screen.getByText('500 €')).toBeInTheDocument();
  expect(screen.getByText('12 min to Fira')).toBeInTheDocument();
  expect(screen.getByText('10 min to Collblanc')).toBeInTheDocument();
  expect(screen.getByText('88')).toBeInTheDocument();
});

test('like and hide report the new status', async () => {
  const onstatus = vi.fn();
  render(ListingCard, { listing, onstatus });
  await userEvent.click(screen.getByRole('button', { name: 'Like' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
  expect(onstatus.mock.calls).toEqual([['liked'], ['hidden']]);
});

test('without onstatus there are no action buttons', () => {
  render(ListingCard, { listing });
  expect(screen.queryByRole('button')).toBeNull();
});

test('marks the listings the AI has read', () => {
  const { unmount } = render(ListingCard, { listing: { ...listing, ai_facts: [{ label: 'Bills', value: 'included', used: true }] } });
  expect(screen.getByTitle('Read by AI')).toBeInTheDocument();
  unmount();
  render(ListingCard, { listing: { ...listing, ai_facts: [] } });
  expect(screen.queryByTitle('Read by AI')).toBeNull();
});
