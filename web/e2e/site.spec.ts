// La web compilada (vite preview) en Chromium: arranca sin servidor, guarda en
// IndexedDB e importa el fichero que mandaria otra persona.
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '../../extension/dist/chrome-dev');
const SITE = 'http://localhost:4173/buscapiso/';

function shareFile(): string {
  const base = { type: 'room', title: '', price: 450, expenses: 0, address: '', neighbourhood: 'Gràcia',
    municipality: 'Barcelona', lat: 41.402, lon: 2.157, approximateLocation: false, gender: 'mixed', genderConfirmed: true,
    bedrooms: 1, roommates: 2, smokingAllowed: null, ownerLivesIn: false, visitsAllowed: null, publishedText: '',
    ageDays: 1, roommateAges: '', roommateOccupation: '', atmosphere: '', couplesAllowed: null, exterior: null,
    minStayMonths: null, availableFrom: '', description: 'Habitación luminosa', photo: '', detailRead: false,
    extraNotes: '', surfaceM2: null, bathrooms: null, floor: '', elevator: null, furnished: null, city: 'barcelona',
    firstSeen: '2026-10-08T10:00:00Z', lastSeen: '2026-10-09T10:00:00Z' };
  const listings = [1, 2, 3].map((i) => ({ ...base, source: 'roomgo', sourceId: `e2e-${i}`, title: `Room number ${i}`,
    url: `https://www.roomgo.es/barcelona/e2e-${i}`, price: 400 + i * 10 }));
  const f = { format: 'buscapiso', version: 1, kind: 'share', exportedAt: '2026-10-09T12:00:00Z',
    summary: { city: 'barcelona', types: ['room'], count: 3, sources: ['roomgo'], searchedFrom: base.lastSeen, searchedTo: base.lastSeen },
    listings };
  const path = join(mkdtempSync(join(tmpdir(), 'bp-')), 'buscapiso-barcelona.json');
  writeFileSync(path, JSON.stringify(f));
  return path;
}

let ctx: BrowserContext;
test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'bp-')), { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
});
test.afterAll(async () => { await ctx?.close(); });

test('the site runs with no server, imports a shared file and scores it here', async () => {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(SITE);
  // Con la extension instalada no hay aviso, y se puede buscar.
  await expect(page.getByRole('button', { name: 'Search now' })).toBeEnabled();
  await expect(page.getByText(/add the buscapiso extension/)).toHaveCount(0);
  await page.goto(`${SITE}#/settings/data`);
  await page.getByLabel('Choose a buscapiso file').setInputFiles(shareFile());
  await expect(page.getByText(/3 listings · Barcelona · rooms/)).toBeVisible();
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(/Imported: 3 new listings/)).toBeVisible();
  await page.goto(`${SITE}#/`);
  await expect(page.getByText('Room number 1')).toBeVisible();
  await expect(page.getByText('Room number 3')).toBeVisible();
  // Sigue ahi al recargar: IndexedDB.
  await page.reload();
  await expect(page.getByText('Room number 2')).toBeVisible();
  expect(errors).toEqual([]);
});

test('without the extension the site still opens and explains what to do', async () => {
  const plain = await chromium.launch({ headless: true });
  const page = await plain.newPage();
  await page.goto(SITE);
  await expect(page.getByText(/add the buscapiso extension/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search now' })).toBeDisabled();
  await plain.close();
});
