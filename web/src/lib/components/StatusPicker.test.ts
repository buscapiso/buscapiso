import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import StatusPicker from './StatusPicker.svelte';

test('lists every status in English and reports the choice', async () => {
  const onchange = vi.fn();
  render(StatusPicker, { value: 'liked', onchange });
  const select = screen.getByLabelText('Status') as HTMLSelectElement;
  expect(select.value).toBe('liked');
  expect(screen.getByRole('option', { name: 'Visit scheduled' })).toBeInTheDocument();
  await userEvent.selectOptions(select, 'contacted');
  expect(onchange).toHaveBeenCalledWith('contacted');
});
