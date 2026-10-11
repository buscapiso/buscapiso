<script lang="ts">
  import { onMount } from 'svelte';
  import { SOURCES } from '../engine/sources';
  import { LATEST_EXTENSION, stale } from '../lib/extension';
  import { ext, platform, STORE, watchExtension } from '../lib/extensionState.svelte';
  import { locale, t } from '../lib/i18n';
  import { href } from '../lib/router.svelte';

  type Browser = 'chrome' | 'firefox';
  let { where = platform() }: { where?: ReturnType<typeof platform> } = $props();

  // Se pregunta a la extension mientras la guia esta abierta: al terminar de
  // instalar o actualizar, la caja de arriba cambia sola.
  const since = Date.now();
  let now = $state(Date.now());
  onMount(() => {
    const stop = watchExtension();
    const clock = setInterval(() => { now = Date.now(); }, 5000);
    return () => { stop(); clearInterval(clock); };
  });

  const status = $derived(ext.status);
  const phase = $derived(!status ? 'checking' : !status.installed ? 'missing'
    : status.outdated ? 'broken' : stale(status) ? 'old' : 'ready');
  const updating = $derived(phase === 'old' || phase === 'broken');

  let picked = $state<Browser | null>(null);
  const browser = $derived<Browser>(picked
    ?? (status?.browser === 'firefox' || status?.browser === 'chrome' ? status.browser
      : where === 'firefox' || where === 'android-firefox' ? 'firefox' : 'chrome'));
  const phone = $derived(where === 'apple' || where === 'android');

  // Lo que la extension lee de verdad: los portales que no admiten CORS.
  const portals = Object.values(SOURCES).filter((s) => !s.net.direct).map((s) => s.label);
  const portalList = new Intl.ListFormat(locale(), { type: 'conjunction' }).format(portals);

  let copied = $state(false);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch { /* sin portapapeles: el texto se puede seleccionar a mano */ }
  }
  const steps = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => t(`${prefix}.${i + 1}`));
</script>

<article class="guide">
  <h1>{updating ? t('guide.updateTitle') : t('guide.title')}</h1>

  <div class="status {phase}" role="status" aria-live="polite">
    {#if phase === 'checking'}
      <p>{t('guide.checking')}</p>
    {:else if phase === 'missing'}
      <p>{t('guide.missing')}</p>
      {#if now - since > 45_000}<p class="small">{t('guide.missingLong')}</p>{/if}
    {:else if phase === 'old'}
      <p>{t('guide.old', { version: status?.version ?? '?', latest: LATEST_EXTENSION, whatsNew: t('extension.whatsNew') })}</p>
    {:else if phase === 'broken'}
      <p>{t('guide.broken', { version: status?.version ?? '?' })}</p>
    {:else}
      <p><span aria-hidden="true">✓</span> {t('guide.ready', { version: status?.version ?? '' })}</p>
      <a class="button primary" href={href({ name: 'rooms', filter: 'new', view: 'list' })}>{t('guide.goSearch')}</a>
    {/if}
  </div>

  {#if phone}
    <p class="phone">{t('guide.phone')} <a href={href({ name: 'settings', section: 'data' })}>{t('guide.importLink')}</a></p>
  {/if}

  <p class="why">{t('guide.why', { portals: portalList })}
    <a href="https://github.com/buscapiso/buscapiso/tree/main/extension" target="_blank" rel="noopener">{t('guide.code')}</a></p>

  <div class="tabs" role="group" aria-label="Browser">
    <button class:on={browser === 'chrome'} aria-pressed={browser === 'chrome'} onclick={() => { picked = 'chrome'; }}>{t('guide.chrome')}</button>
    <button class:on={browser === 'firefox'} aria-pressed={browser === 'firefox'} onclick={() => { picked = 'firefox'; }}>{t('guide.firefox')}</button>
  </div>

  {#if browser === 'chrome'}
    <ol class="steps">
      {#each steps(updating ? 'guide.chrome.update' : 'guide.chrome.install', updating ? 4 : 6) as step, i}
        <li>
          <p>{step}</p>
          {#if i === 0}
            <a class="button primary" href={STORE.chrome}>{t('guide.download', { file: 'buscapiso-chrome.zip' })}</a>
          {:else if i === 2}
            <div class="copy"><code>chrome://extensions</code>
              <button onclick={() => copy('chrome://extensions')}>{copied ? t('guide.copied') : t('guide.copy')}</button></div>
          {/if}
        </li>
      {/each}
    </ol>
    {#if !updating}<p class="note">{t('guide.chrome.note')}</p>{/if}
  {:else}
    <ol class="steps">
      {#each steps(updating ? 'guide.firefox.update' : 'guide.firefox.install', 2) as step, i}
        <li>
          <p>{step}</p>
          {#if i === 0}<a class="button primary" href={STORE.firefox}>{t('guide.download', { file: 'buscapiso-firefox.xpi' })}</a>{/if}
        </li>
      {/each}
    </ol>
    <p class="note">{updating ? t('guide.firefox.updateNote') : t('guide.firefox.note')}</p>
  {/if}

  <p class="note">{t('guide.dataSafe')}</p>
</article>

<style>
  .guide { max-width: 680px; }
  .status { border: 1.5px solid var(--ink); border-left-width: 6px; border-left-color: var(--gold); background: var(--surface);
    padding: 12px 16px; margin: 0 0 18px; display: grid; gap: 8px; justify-items: start; }
  .status.ready { border-left-color: var(--ok); }
  .status.broken { border-left-color: var(--bad); }
  .status p { margin: 0; font-family: var(--serif); font-size: 17px; }
  .status .small, .note { font-family: var(--text); font-size: 14px; color: var(--muted); }
  .why, .phone { font-family: var(--serif); font-size: 17px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 0; margin: 18px 0 6px; }
  .tabs button { border-radius: 0; }
  .tabs button + button { margin-left: -1.5px; }
  .tabs button.on { background: var(--ink); color: var(--paper); }
  .steps { padding-left: 1.4em; display: grid; gap: 12px; margin: 14px 0; }
  .steps li { padding-left: 4px; }
  .steps li::marker { font-family: var(--display); font-weight: 700; color: var(--gold-ink); }
  .steps p { margin: 0 0 6px; }
  .copy { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .copy code { font-size: 15px; padding: 3px 8px; border: 1px solid var(--line-strong); background: var(--paper); user-select: all; }
</style>
