import { describe, expect, it } from 'vitest';
import { billsFromText, emptyListing, estimatedCost, listingId, richness, sha1, totalCost } from './model';
import { inferGender, surface } from './sources/base';

describe('listingId', () => {
  it('matches the id the Python engine gave the same listing', () => {
    expect(listingId('idealista', '12345')).toBe('d5e46fd21a68');
    expect(listingId('fotocasa', '987')).toBe('d447ea981e5d');
    expect(listingId('roomgo', 'abc-1')).toBe('217f640a9d8f');
  });
  it('hashes UTF-8 and long input like sha1sum', () => {
    expect(sha1('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1('ñ'.repeat(40))).toBe('69b39506bcbe4687c1f97238e373e075ac640716');
    expect(sha1('The quick brown fox jumps over the lazy dog')).toBe('2fd4e1c67a2d28fced849ee1bb76e7391b93eb12');
  });
});

describe('costs', () => {
  const l = { ...emptyListing('idealista', '1', 'https://x'), price: 490 };
  it('total cost adds stated bills only', () => {
    expect(totalCost(l)).toBe(490);
    expect(totalCost({ ...l, expenses: 150 })).toBe(640);
    expect(totalCost({ ...l, price: null })).toBeNull();
  });
  it('estimated cost assumes bills when the listing says nothing', () => {
    expect(estimatedCost(l, 55)).toBe(545);
    expect(estimatedCost({ ...l, expenses: 0 }, 55)).toBe(490);
  });
  it('richness counts useful fields, confirmed gender weighs 3', () => {
    expect(richness(l)).toBe(0);
    expect(richness({ ...l, lat: 41, description: 'x', genderConfirmed: true })).toBe(5);
  });
});

describe('inferGender', () => {
  it.each([
    'Habitación en piso de chicas, muy luminosa', 'Solo chicas, no fumadoras',
    'Buscamos una compañera de piso para octubre', 'Somos 3 chicas tranquilas y ordenadas',
    'Piso femenino en el centro', 'Es un pis només noies',
    'Busquem només 3 Noies estudiants mir master Pis reformat', 'Es busca noia per compartir pis al Clot',
    'Pis de noies, ambient tranquil', 'Som 2 noies i busquem companya', 'Només noies, no fumadores',
    'Buscamos solo 2 chicas', 'Somos 3 chicas y buscamos compañera',
  ])('women only: %s', (t) => expect(inferGender(t)).toBe('female_only'));
  it.each([
    'Piso mixto de estudiantes', 'Compartido con chicos/as', 'Viven chicas y chicos',
    'Somos 2 chicas y chicos, piso mixto', 'Somos 2 chicas y 1 chico entre 24 y 27 años',
    'Buscamos compañero/a de piso para entrar el 1 de octubre', 'Som 2 noies i un noi',
    'En el piso viven 3 chicos y 2 chicas', 'Se alquila a chico/a responsable',
    'Piso de chicas. Bueno, somos 2 chicas y 1 chico',
  ])('mixed: %s', (t) => expect(inferGender(t)).toBe('mixed'));
  it.each(['Solo chicos, ambiente tranquilo', 'Només nois, pis tranquil'])(
    'men only: %s', (t) => expect(inferGender(t)).toBe('male_only'));
  it.each(['Habitación amplia con armario empotrado y buena luz', 'Piso reformado cerca del metro', '',
    'Se alquila habitación a persona responsable'])(
    'unknown: %s', (t) => expect(inferGender(t)).toBe('unknown'));
});

describe('surface', () => {
  it('treats 1 m² and junk as unknown', () => {
    expect(surface(1)).toBeNull();
    expect(surface('70')).toBe(70);
    expect(surface('abc')).toBeNull();
    expect(surface(null)).toBeNull();
  });
});

describe('bills from the description', () => {
  it('reads a range as its midpoint, and a single amount', () => {
    expect(billsFromText('El precio són 420€ + gastos a parte (50-100€/mes dependiendo de los consumos). Fianza 1 mes.')).toBe(75);
    expect(billsFromText('Gastos aparte: 40 € al mes')).toBe(40);
    expect(billsFromText('despeses 30-50€')).toBe(40);
  });
  it('knows included bills, and says nothing when the text does not', () => {
    expect(billsFromText('Todos los gastos incluidos')).toBe(0);
    expect(billsFromText('Gastos no incluidos')).toBeNull();
    expect(billsFromText('Fianza 1 mes, 420 €')).toBeNull();
  });
});
