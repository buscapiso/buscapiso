// Aparte de profiles.ts: las fuentes lo usan, y profiles.ts importa el
// registro de fuentes (un ciclo de importaciones).
import type { SearchProfile } from './profiles';

/** Presupuesto del tipo que se busca: el motor solo ve ese. */
export function activeBudget(p: SearchProfile): { ideal: number; max: number; assumed: number } {
  return p.listing_type === 'flat'
    ? { ideal: p.flat.ideal_rent, max: p.flat.max_rent, assumed: p.flat.assumed_bills }
    : { ideal: p.budget.ideal_total, max: p.budget.max_total, assumed: p.budget.assumed_expenses };
}
