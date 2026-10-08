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
