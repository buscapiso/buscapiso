import { describe, expect, it } from 'vitest';
import { emptyListing, type StoredListing } from './model';
import { priceContexts, scamSignals } from './signals';

let n = 0;
function stored(o: Partial<StoredListing>): StoredListing {
  const l = emptyListing('fotocasa', String(++n), `https://x/${n}`);
  return { ...l, id: `fotocasa:${n}`, city: 'barcelona', firstSeen: '2026-10-01', lastSeen: '2026-10-11', ...o };
}
const rooms = (prices: number[], hood = 'Gràcia') => prices.map((price) => stored({ price, neighbourhood: hood, municipality: 'Barcelona' }));

describe('price context', () => {
  it('compares a room with the median of its neighbourhood', () => {
    const ls = rooms([400, 450, 500, 500, 550, 600, 650]);
    const ctx = priceContexts(ls, 'room').get(ls[0].id)!;
    expect(ctx).toMatchObject({ median: 500, n: 7, place: 'Gràcia', perM2: false });
    expect(ctx.diff).toBeCloseTo(-0.2);
  });
  it('falls back to the town when the neighbourhood has too few, and says nothing with too few overall', () => {
    const ls = [...rooms([300], 'Vallcarca'), ...rooms([500, 500, 520, 480, 510, 490], 'Sants')];
    expect(priceContexts(ls, 'room').get(ls[0].id)).toMatchObject({ place: 'Barcelona', n: 7 });
    expect(priceContexts(rooms([400, 500]), 'room').size).toBe(0);
  });
  it('compares flats by price per square metre when the size is known', () => {
    const ls = [1000, 1100, 1200, 1300, 1400, 1500].map((price) => stored({ type: 'flat', price, surfaceM2: 70, neighbourhood: 'Eixample' }));
    const ctx = priceContexts(ls, 'flat').get(ls[5].id)!;
    expect(ctx.perM2).toBe(true);
    expect(ctx.median).toBeCloseTo(17.9, 1);
  });
  it('ignores placeholder prices', () => {
    const ls = rooms([1, 450, 500, 500, 550, 600]);
    expect(priceContexts(ls, 'room').has(ls[0].id)).toBe(false);
  });
});

describe('scam signals', () => {
  it('flags the usual scam stories in Spanish and English', () => {
    const say = (description: string) => scamSignals(stored({ description }), undefined, new Map());
    expect(say('Estoy trabajando en Londres, te envío las llaves por mensajería tras el pago por adelantado'))
      .toEqual(['Asks for payment before you visit', 'Says the owner is abroad', 'Keys sent by post or courier']);
    expect(say('Payment via Western Union only')).toEqual(['Mentions a money transfer service']);
    expect(say('Piso luminoso, visitas por las tardes, fianza de un mes')).toEqual([]);
  });
  it('flags a price far below similar listings', () => {
    const l = stored({ price: 250 });
    expect(scamSignals(l, { median: 520, n: 12, place: 'Gràcia', diff: -0.52, perM2: false }, new Map()))
      .toEqual(['Price is 52% below similar listings in Gràcia']);
    expect(scamSignals(l, { median: 520, n: 4, place: 'Gràcia', diff: -0.52, perM2: false }, new Map())).toEqual([]);
  });
  it('flags a photo that another listing elsewhere also uses', () => {
    const a = stored({ photo: 'https://img/1.jpg', neighbourhood: 'Gràcia' });
    const b = stored({ photo: 'https://img/1.jpg', neighbourhood: 'Sants' });
    const c = stored({ photo: 'https://img/2.jpg', neighbourhood: 'Gràcia' });
    const d = stored({ photo: 'https://img/2.jpg', neighbourhood: 'Gràcia' });   // el mismo edificio
    const photos = new Map([['https://img/1.jpg', new Set(['gracia', 'sants'])], ['https://img/2.jpg', new Set(['gracia'])]]);
    expect(scamSignals(a, undefined, photos)).toEqual(['Same photo as a listing elsewhere']);
    expect(scamSignals(c, undefined, photos)).toEqual([]);
    expect([b, d].length).toBe(2);
  });
});
