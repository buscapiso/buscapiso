import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import NeighbourhoodPicker from './NeighbourhoodPicker.svelte';

const OPTIONS = ['Collblanc', 'Gràcia', 'Sants', 'Sants - Badal'];

test('search, pick and remove neighbourhoods', async () => {
  const onchange = vi.fn();
  render(NeighbourhoodPicker, { label: 'Preferred', options: OPTIONS, selected: ['Gràcia'], onchange });
  await userEvent.type(screen.getByLabelText('Preferred'), 'san');
  await userEvent.click(screen.getByRole('option', { name: 'Sants - Badal' }));
  expect(onchange).toHaveBeenLastCalledWith(['Gràcia', 'Sants - Badal']);
  await userEvent.click(screen.getByRole('button', { name: 'Remove Gràcia' }));
  expect(onchange).toHaveBeenLastCalledWith([]);
});

test('a saved name that is not in the list is kept', () => {
  render(NeighbourhoodPicker, { label: 'Never', options: OPTIONS, selected: ['La Mina'], onchange: vi.fn() });
  expect(screen.getByText('La Mina')).toBeInTheDocument();
});

test('text that matches nothing can still be added', async () => {
  const onchange = vi.fn();
  render(NeighbourhoodPicker, { label: 'Never', options: OPTIONS, selected: [], onchange });
  await userEvent.type(screen.getByLabelText('Never'), 'La Mina{Enter}');
  expect(onchange).toHaveBeenLastCalledWith(['La Mina']);
});
