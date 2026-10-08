import { fieldErrors } from './profileErrors';

test('turns FastAPI validation errors into field paths', () => {
  const detail = [
    { loc: ['body', 'budget'], msg: 'Value error, ideal_total cannot be above max_total' },
    { loc: ['body', 'destinations', 0, 'name'], msg: 'String should have at least 1 character' },
  ];
  expect(fieldErrors(detail)).toEqual({
    budget: 'Value error, ideal_total cannot be above max_total',
    'destinations.0.name': 'String should have at least 1 character',
  });
});

test('anything else becomes a general error', () => {
  expect(fieldErrors('boom')).toEqual({ '': 'boom' });
});
