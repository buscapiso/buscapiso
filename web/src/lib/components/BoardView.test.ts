import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import BoardView from './BoardView.svelte';
import type { Listing } from '../api';

const listing = (id: string, status: string) => ({
  id, status, title: `Room ${id}`, total_cost: 500, travel: {}, neighbourhood: '', municipality: '',
}) as unknown as Listing;

test('each listing sits in the column of its status and can move', async () => {
  const onmove = vi.fn();
  render(BoardView, { items: [listing('a', 'liked'), listing('b', 'contacted')], onmove });
  const liked = screen.getByRole('region', { name: 'Liked' });
  expect(within(liked).getByText('Room a')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Contacted' })).getByText('Room b')).toBeInTheDocument();
  await userEvent.selectOptions(within(liked).getByLabelText('Status'), 'visit_scheduled');
  expect(onmove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'visit_scheduled');
});
