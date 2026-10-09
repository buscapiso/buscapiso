import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { emptyListing, listingId, type StoredListing, type UserState } from '../engine/model';
import { defaultProfile } from '../engine/profiles';
import { Db } from './db';
import { applyImport, exportData, ImportError, MAX_BYTES, previewImport } from './transfer';

const NOW = new Date('2026-10-09T12:00:00Z');
function listing(id: string, over: Partial<StoredListing> = {}): StoredListing {
  return { ...emptyListing('idealista', id, `https://www.idealista.com/inmueble/${id}/`), id: listingId('idealista', id),
    city: 'barcelona', firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-05T00:00:00Z', price: 500, ...over };
}
async function device() { return Db.open('t', new IDBFactory()); }
async function seed(db: Db, ls: StoredListing[]) { await db.putMany('listings', ls); }
const text = async (db: Db, kind: 'share' | 'backup' = 'share') => JSON.stringify(await exportData(db, kind, 'barcelona', NOW));

describe('export', () => {
  it('a share carries only the listings, never keys or personal data', async () => {
    const a = await device();
    await seed(a, [listing('1', { missingSince: '2026-10-06T00:00:00Z' })]);
    await a.put('userState', { id: listingId('idealista', '1'), status: 'liked', note: 'mine', history: [] });
    await a.put('settings', 'SECRET-KEY', 'google_key');
    const f = JSON.parse(await text(a));
    expect(f).toMatchObject({ format: 'buscapiso', version: 1, kind: 'share', summary: { city: 'barcelona', count: 1, types: ['room'] } });
    expect(f.personal).toBeUndefined();
    expect(f.listings[0].missingSince).toBeUndefined();
    expect(JSON.stringify(f)).not.toContain('SECRET-KEY');
  });
  it('a backup adds states, profiles and settings, but still no keys', async () => {
    const a = await device();
    await seed(a, [listing('1')]);
    await a.put('userState', { id: listingId('idealista', '1'), status: 'liked', note: 'mine', history: [] });
    await a.put('profiles', defaultProfile('Mine'));
    await a.put('settings', 'sk-ant-XYZ', 'ai_key:anthropic');
    await a.put('settings', 'google', 'travel_provider');
    const t = await text(a, 'backup');
    expect(t).not.toContain('sk-ant-XYZ');
    const f = JSON.parse(t);
    expect(f.personal.userState).toHaveLength(1);
    expect(f.personal.settings).toEqual({ travel_provider: 'google' });
  });
});

describe('import', () => {
  it('round-trips into an empty browser', async () => {
    const a = await device(), b = await device();
    await seed(a, [listing('1'), listing('2', { type: 'flat' })]);
    const p = await previewImport(b, await text(a));
    expect(p).toMatchObject({ total: 2, newToYou: 2, kind: 'share', city: 'barcelona' });
    await applyImport(b, p);
    expect((await b.all('listings')).sort()).toEqual((await a.all('listings')).sort());
  });
  it('never changes a note or status the importer already has', async () => {
    const a = await device(), b = await device();
    const id = listingId('idealista', '1');
    await seed(a, [listing('1', { lastSeen: '2026-10-08T00:00:00Z', price: 450 })]);
    await a.put('userState', { id, status: 'discarded', note: 'theirs', history: [] });
    await seed(b, [listing('1')]);
    const mine: UserState = { id, status: 'liked', note: 'call on Monday', history: [{ status: 'liked', note: '', at: 'x' }] };
    await b.put('userState', mine);
    await applyImport(b, await previewImport(b, await text(a, 'backup')));
    expect(await b.get('userState', id)).toEqual(mine);
    // Los datos del portal si se actualizan con la copia mas reciente.
    expect((await b.get<StoredListing>('listings', id))!.price).toBe(450);
  });
  it('a backup fills states only where there were none', async () => {
    const a = await device(), b = await device();
    await seed(a, [listing('1'), listing('2')]);
    await a.put('userState', { id: listingId('idealista', '2'), status: 'contacted', note: 'n', history: [] });
    const r = await applyImport(b, await previewImport(b, await text(a, 'backup')));
    expect(r.states).toBe(1);
    expect((await b.get<UserState>('userState', listingId('idealista', '2')))!.status).toBe('contacted');
    const share = await previewImport(b, await text(a, 'share'));
    expect(share.userState).toEqual([]);
  });
  it('keeps the earliest first sighting and marks what a newer file no longer has', async () => {
    const a = await device(), b = await device();
    await seed(a, [listing('1', { firstSeen: '2026-10-03T00:00:00Z', lastSeen: '2026-10-09T00:00:00Z' })]);
    await seed(b, [listing('1', { firstSeen: '2026-09-20T00:00:00Z' }), listing('old', { lastSeen: '2026-10-02T00:00:00Z' }),
      listing('flat', { type: 'flat', lastSeen: '2026-10-02T00:00:00Z' })]);
    const r = await applyImport(b, await previewImport(b, await text(a)));
    expect(r).toMatchObject({ added: 0, updated: 1, missing: 1 });
    expect((await b.get<StoredListing>('listings', listingId('idealista', '1')))!.firstSeen).toBe('2026-09-20T00:00:00Z');
    expect((await b.get<StoredListing>('listings', listingId('idealista', 'old')))!.missingSince).toBe('2026-10-09T00:00:00Z');
    // Otro tipo: el fichero no habla de pisos, no se marca.
    expect((await b.get<StoredListing>('listings', listingId('idealista', 'flat')))!.missingSince).toBeUndefined();
  });
  it('refuses bad files and cleans what it accepts', async () => {
    const b = await device();
    await expect(previewImport(b, 'nope')).rejects.toBeInstanceOf(ImportError);
    await expect(previewImport(b, JSON.stringify({ format: 'buscapiso', version: 2 }))).rejects.toThrow(/newer buscapiso/);
    await expect(previewImport(b, ' '.repeat(MAX_BYTES + 1))).rejects.toThrow(/50 MB/);
    const a = await device();
    await seed(a, [listing('ok')]);
    const f = JSON.parse(await text(a));
    f.listings.push({ ...f.listings[0], sourceId: 'evil', url: 'javascript:alert(1)' });
    f.listings.push({ ...f.listings[0], sourceId: 'pic', photo: 'javascript:alert(1)', extra: 'x', id: 'forged' });
    f.listings.push({ nonsense: true });
    const p = await previewImport(b, JSON.stringify(f));
    expect(p.skipped).toBe(2);
    const pic = p.listings.find((l) => l.sourceId === 'pic')!;
    expect(pic.photo).toBe('');
    expect(pic.id).toBe(listingId('idealista', 'pic'));
    expect((pic as unknown as Record<string, unknown>).extra).toBeUndefined();
  });
});
