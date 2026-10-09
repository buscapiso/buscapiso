// Compila la extension para Chrome y Firefox desde la misma fuente.
//   node build.mjs          -> dist/chrome, dist/firefox (+ .zip si hay `zip`)
//   node build.mjs --dev    -> ademas permite localhost (tests y vite dev)
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
const SITE = ['https://buscapiso.github.io/*'];
const DEV_SITE = ['http://localhost/*', 'http://127.0.0.1/*'];
const PORTALS = ['idealista.com', 'fotocasa.es', 'habitaclia.com', 'roomgo.es', 'depisoenpiso.com']
  .flatMap((h) => [`https://${h}/*`, `https://*.${h}/*`]);

function manifest(target) {
  const m = {
    manifest_version: 3,
    name: 'buscapiso',
    version: '1.0.0',
    description: 'Lets the buscapiso website read rental listings from Idealista, Fotocasa, Habitaclia, Roomgo and De Piso en Piso in your own browser.',
    icons: { 128: 'icon-128.png', 512: 'icon-512.png' },
    permissions: ['tabs', 'scripting'],
    host_permissions: [...PORTALS, ...(dev ? DEV_SITE : [])],
    content_scripts: [{ matches: [...SITE, ...(dev ? DEV_SITE : [])], js: ['bridge.js'], run_at: 'document_start' }],
  };
  if (target === 'chrome') m.background = { service_worker: 'background.js', type: 'module' };
  else {
    m.background = { scripts: ['background.js'], type: 'module' };
    m.browser_specific_settings = { gecko: { id: 'extension@buscapiso.github.io', strict_min_version: '128.0' } };
  }
  return m;
}

for (const target of ['chrome', 'firefox']) {
  const out = join(HERE, 'dist', dev ? `${target}-dev` : target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of ['background.js', 'bridge.js', 'fetcher.js', 'protocol.js']) cpSync(join(HERE, 'src', f), join(out, f));
  writeFileSync(join(out, 'config.js'), `export const DEV_HOSTS = ${JSON.stringify(dev ? ['localhost', '127.0.0.1'].flatMap((h) => [h]) : [])};\n`);
  cpSync(join(HERE, '..', 'web', 'public', 'icon-192.png'), join(out, 'icon-128.png'));
  cpSync(join(HERE, '..', 'web', 'public', 'icon-512.png'), join(out, 'icon-512.png'));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest(target), null, 2));
  if (!dev) {
    try {
      execFileSync('zip', ['-qr', join(HERE, 'dist', `buscapiso-${target}.zip`), '.'], { cwd: out });
    } catch { console.warn('zip not found: packages left unzipped'); }
  }
  console.log(`built ${out}`);
}
