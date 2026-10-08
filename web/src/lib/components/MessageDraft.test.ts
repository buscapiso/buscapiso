import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import MessageDraft from './MessageDraft.svelte';

afterEach(() => vi.restoreAllMocks());

test('drafts an editable message for the listing', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ text: 'Hola, soy Ana.' })));
  render(MessageDraft, { id: 'a1' });
  await userEvent.click(screen.getByRole('button', { name: 'Draft a message' }));
  expect(await screen.findByDisplayValue('Hola, soy Ana.')).toBeInTheDocument();
  expect(String(f.mock.calls[0][0])).toBe('/api/listings/a1/draft');
});

test('explains when no AI is set up', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ detail: 'Set up an AI provider in the settings first' }), { status: 422 }));
  render(MessageDraft, { id: 'a1' });
  await userEvent.click(screen.getByRole('button', { name: 'Draft a message' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Set up an AI provider');
});
