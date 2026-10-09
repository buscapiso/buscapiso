// Exportar e importar. "share" lleva solo lo que dijeron los portales, para
// mandarselo a otra persona: su dispositivo puntua con su perfil y sus sitios.
// "backup" añade estados, notas, perfiles y ajustes, para llevarse lo propio a
// otro navegador. Las claves no salen nunca.
import { z } from 'zod';
import { listingId, type StoredListing, type UserState } from '../engine/model';
import { searchProfile, type SearchProfile } from '../engine/profiles';
import type { Db } from './db';

export const MAX_BYTES = 50 * 1024 * 1024;
const SECRET = (key: string) => key === 'google_key' || key.startsWith('ai_key:');

const web = z.string().transform((u) => (/^https?:\/\//i.test(u.trim()) ? u.trim() : ''));
const n = z.number().finite().nullable();
const b = z.boolean().nullable();
const s = z.string();
const listingRow = z.object({
  source: z.string().min(1).max(40), sourceId: z.string().min(1).max(200), url: web, type: z.enum(['room', 'flat']),
  title: s, price: n, expenses: n, address: s, neighbourhood: s, municipality: s, lat: n, lon: n,
  approximateLocation: z.boolean(), gender: z.enum(['female_only', 'male_only', 'mixed', 'unknown']),
  genderConfirmed: z.boolean(), bedrooms: n, roommates: n, smokingAllowed: b, ownerLivesIn: b, visitsAllowed: b,
  publishedText: s, ageDays: n, roommateAges: s, roommateOccupation: s, atmosphere: s, couplesAllowed: b,
  exterior: b, minStayMonths: n, availableFrom: s, description: s, photo: web, detailRead: z.boolean(),
  extraNotes: s, surfaceM2: n, bathrooms: n, floor: s, elevator: b, furnished: b,
  city: z.string().min(1).max(60), firstSeen: s, lastSeen: s, alsoOn: z.array(s).optional(),
});
const STATUSES = ['new', 'liked', 'hidden', 'contacted', 'visit_scheduled', 'visited', 'applied', 'got_it', 'rejected', 'discarded'] as const;
const userStateRow = z.object({
  id: z.string(), status: z.enum(STATUSES), note: s,
  history: z.array(z.object({ status: z.enum(STATUSES), note: s, at: s })),
});
const fileSchema = z.object({
  format: z.literal('buscapiso'),
  version: z.literal(1),
  kind: z.enum(['share', 'backup']),
  exportedAt: s,
  app: s.optional(),
  summary: z.object({ city: s, types: z.array(z.enum(['room', 'flat'])), count: z.number(), sources: z.array(s),
    searchedFrom: s.nullable(), searchedTo: s.nullable() }),
  listings: z.array(z.unknown()),
  personal: z.object({ userState: z.array(z.unknown()).default([]), profiles: z.array(z.unknown()).default([]),
    settings: z.record(z.unknown()).default({}) }).optional(),
});
export type ExportFile = z.input<typeof fileSchema>;

export async function exportData(db: Db, kind: 'share' | 'backup', city: string, now: Date, app = '1.0.0'): Promise<ExportFile> {
  const ls = (await db.byCity<StoredListing>(city)).map(({ missingSince: _drop, ...l }) => l);
  const seen = ls.map((l) => l.lastSeen).sort();
  const file: ExportFile = {
    format: 'buscapiso', version: 1, kind, exportedAt: now.toISOString(), app,
    summary: { city, types: [...new Set(ls.map((l) => l.type))], count: ls.length,
      sources: [...new Set(ls.map((l) => l.source))], searchedFrom: seen[0] ?? null, searchedTo: seen.at(-1) ?? null },
    listings: ls,
  };
  if (kind === 'backup') {
    const ids = new Set(ls.map((l) => l.id));
    const settings: Record<string, unknown> = {};
    const all = await db.allEntries('settings');
    for (const [k, v] of all) if (!SECRET(String(k))) settings[String(k)] = v;
    file.personal = { userState: (await db.all<UserState>('userState')).filter((u) => ids.has(u.id)),
      profiles: await db.all('profiles'), settings };
  }
  return file;
}

export interface ImportPreview {
  kind: 'share' | 'backup';
  city: string;
  types: ('room' | 'flat')[];
  searchedFrom: string | null;
  searchedTo: string | null;
  total: number;
  newToYou: number;
  skipped: number;
  listings: StoredListing[];
  userState: UserState[];
  profiles: SearchProfile[];
  settings: Record<string, unknown>;
}

export class ImportError extends Error {}

/** Lee y valida el fichero sin tocar nada. */
export async function previewImport(db: Db, text: string): Promise<ImportPreview> {
  if (text.length > MAX_BYTES) throw new ImportError('The file is larger than 50 MB.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ImportError('This is not a buscapiso file (it is not JSON).'); }
  const f = fileSchema.safeParse(raw);
  if (!f.success) {
    const v = (raw as { format?: unknown; version?: unknown }) ?? {};
    if (v.format === 'buscapiso' && v.version !== 1) throw new ImportError('This file comes from a newer buscapiso. Update the page and try again.');
    throw new ImportError('This is not a buscapiso export file.');
  }
  const listings: StoredListing[] = [];
  let skipped = 0;
  for (const row of f.data.listings) {
    const r = listingRow.safeParse(row);
    if (!r.success || !r.data.url) { skipped++; continue; }
    // El id se recalcula: no se fia del fichero.
    listings.push({ ...r.data, id: listingId(r.data.source, r.data.sourceId) } as StoredListing);
  }
  const have = new Set((await db.byCity<StoredListing>(f.data.summary.city)).map((l) => l.id));
  const personal = f.data.kind === 'backup' ? f.data.personal : undefined;
  return {
    kind: f.data.kind, city: f.data.summary.city, types: f.data.summary.types,
    searchedFrom: f.data.summary.searchedFrom, searchedTo: f.data.summary.searchedTo,
    total: listings.length, newToYou: listings.filter((l) => !have.has(l.id)).length, skipped, listings,
    userState: (personal?.userState ?? []).flatMap((u) => { const r = userStateRow.safeParse(u); return r.success ? [r.data] : []; }),
    profiles: (personal?.profiles ?? []).flatMap((p) => { const r = searchProfile.safeParse(p); return r.success ? [r.data] : []; }),
    settings: Object.fromEntries(Object.entries(personal?.settings ?? {}).filter(([k]) => !SECRET(k))),
  };
}

export interface ImportResult { added: number; updated: number; missing: number; states: number; profiles: number }

/** Fusiona. Lo de la persona que importa siempre gana a lo del fichero. */
export async function applyImport(db: Db, p: ImportPreview): Promise<ImportResult> {
  const local = new Map((await db.byCity<StoredListing>(p.city)).map((l) => [l.id, l]));
  const incoming = new Set(p.listings.map((l) => l.id));
  const out: StoredListing[] = [];
  let added = 0, updated = 0, missing = 0;
  for (const l of p.listings) {
    const old = local.get(l.id);
    if (!old) { out.push(l); added++; continue; }
    const newer = l.lastSeen > old.lastSeen ? l : old;
    const merged: StoredListing = { ...newer, firstSeen: l.firstSeen < old.firstSeen ? l.firstSeen : old.firstSeen,
      lastSeen: newer.lastSeen };
    delete merged.missingSince;
    out.push(merged);
    updated++;
  }
  // Lo que ya estaba, de la misma ciudad y tipo, y falta en un fichero mas reciente.
  if (p.searchedTo) {
    for (const l of local.values()) {
      if (incoming.has(l.id) || !p.types.includes(l.type) || l.missingSince || l.lastSeen >= p.searchedTo) continue;
      out.push({ ...l, missingSince: p.searchedTo });
      missing++;
    }
  }
  await db.putMany('listings', out);
  let states = 0, profiles = 0;
  if (p.kind === 'backup') {
    const ids = new Set([...local.keys(), ...incoming]);
    for (const u of p.userState) {
      if (!ids.has(u.id) || (await db.get('userState', u.id))) continue;
      await db.put('userState', u);
      states++;
    }
    for (const pr of p.profiles) {
      if (await db.get('profiles', pr.name)) continue;
      await db.put('profiles', pr);
      profiles++;
    }
    for (const [k, v] of Object.entries(p.settings)) {
      if ((await db.get('settings', k)) === undefined) await db.put('settings', v, k);
    }
  }
  return { added, updated, missing, states, profiles };
}
