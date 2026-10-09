// La extension real (compilacion de desarrollo) en Chromium, hablando con el
// cliente real de la web servido por vite. No toca ningun portal real.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { startPortals } from './portals';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '../../extension/dist/chrome-dev');
let ctx: BrowserContext;
let page: Page;
let portals: Server;

test.beforeAll(async () => {
  execFileSync('node', [resolve(HERE, '../../extension/build.mjs'), '--dev']);
  portals = await startPortals();
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'bp-')), {
    headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  page = await ctx.newPage();
  await page.goto('http://localhost:5173/buscapiso/e2e/harness.html');
  await page.waitForFunction(() => (window as any).ready);  // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).ext.detectExtension(3000));  // eslint-disable-line @typescript-eslint/no-explicit-any
});
test.afterAll(async () => { await ctx?.close(); portals?.close(); });

const run = (fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).ext[f as string](...(a as unknown[])), [fn, args]);  // eslint-disable-line @typescript-eslint/no-explicit-any

test('the site finds the extension', async () => {
  expect(await run('detectExtension', 3000)).toMatchObject({ installed: true, outdated: false, browser: 'chrome' });
});

test('a page that is not blocked comes by plain fetch', async () => {
  const r = await page.evaluate(() => (window as any).ext.extensionFetchPage()({  // eslint-disable-line @typescript-eslint/no-explicit-any
    url: 'http://localhost:4599/list', portal: 'fake', blockedMarkers: ['captcha-delivery'], allowTab: true }));
  expect(r).toMatchObject({ ok: true, via: 'fetch' });
  expect(r.html).toContain('article');
});

test('a captcha opens a tab, the person solves it, and the page arrives', async () => {
  const result = page.evaluate(() => new Promise((ok) => {
    let asked = false;
    (window as any).ext.extensionFetchPage()({ url: 'http://localhost:4599/captcha', portal: 'fake2',  // eslint-disable-line @typescript-eslint/no-explicit-any
      blockedMarkers: ['captcha-delivery'], allowTab: true, timeoutMs: 60000 }, () => { asked = true; (window as any).asked = true; })  // eslint-disable-line @typescript-eslint/no-explicit-any
      .then((r: object) => ok({ ...r, asked }));
  }));
  const tab = await ctx.waitForEvent('page', (p) => p.url().includes('/captcha'));
  // Como una persona: se resuelve cuando la web ha avisado de que hace falta.
  await page.waitForFunction(() => (window as any).asked === true);  // eslint-disable-line @typescript-eslint/no-explicit-any
  await tab.click('#solve');
  const r = await result as Record<string, unknown>;
  expect(r).toMatchObject({ ok: true, via: 'tab', asked: true });
  expect(String(r.html)).not.toContain('captcha-delivery');
});

test('URLs outside the portals are refused', async () => {
  const r = await page.evaluate(() => (window as any).ext.extensionFetchPage()({  // eslint-disable-line @typescript-eslint/no-explicit-any
    url: 'https://example.com/', portal: 'x', blockedMarkers: [], allowTab: true }));
  expect(r).toEqual({ ok: false, reason: 'not-allowed' });
});

test('stopping closes the work tabs', async () => {
  const before = ctx.pages().length;
  await run('cancelExtension');
  await expect.poll(() => ctx.pages().length).toBeLessThanOrEqual(before);
  expect(ctx.pages().some((p) => p.url().includes('localhost:4599'))).toBe(false);
});
