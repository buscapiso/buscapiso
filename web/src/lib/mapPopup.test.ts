import { popupContent } from './mapPopup';

test('listing text is shown as text, never as HTML', () => {
  const el = popupContent({ label: '<img src=x onerror="alert(1)">Room', sub: '500 €', href: '#/listing/a' });
  expect(el.querySelector('img')).toBeNull();
  expect(el.textContent).toContain('<img src=x onerror="alert(1)">Room');
  expect(el.querySelector('a')!.getAttribute('href')).toBe('#/listing/a');
});

test('only in-app links are allowed in popups', () => {
  const el = popupContent({ label: 'x', href: 'javascript:alert(1)' });
  expect(el.querySelector('a')).toBeNull();
});

test('place labels on the map are text too', async () => {
  // Los nombres de destino pueden venir de Nominatim al buscar una direccion.
  const src = await import('./components/MapView.svelte?raw');
  expect(src.default).not.toMatch(/bindTooltip\(d\.name/);
  expect(src.default).toMatch(/bindTooltip\(popupContent\(\{ label: d\.name \}\)/);
});
