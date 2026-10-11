<script lang="ts">
  import { LATEST_EXTENSION, stale } from '../extension';
  import { ext, platform, refreshExtension, STORE, type Platform } from '../extensionState.svelte';
  import { href } from '../router.svelte';
  import { t } from '../i18n';

  let { where = platform() }: { where?: Platform } = $props();
  const status = $derived(ext.status);
  const store = $derived(where === 'firefox' || where === 'android-firefox' ? STORE.firefox : STORE.chrome);

  $effect(() => { if (!ext.status) refreshExtension(); });

  // "Ahora no" se recuerda por version: la siguiente vuelve a avisar.
  const KEY = 'buscapiso.extensionNotice';
  let dismissed = $state((() => { try { return localStorage.getItem(KEY) === LATEST_EXTENSION; } catch { return false; } })());
  function notNow() {
    dismissed = true;
    try { localStorage.setItem(KEY, LATEST_EXTENSION); } catch { /* sin almacenamiento: solo esta vez */ }
  }
</script>

{#if status && status.outdated}
  <div class="banner" role="status"><p>{t('extension.outdated')}</p>
    <a class="button primary" href={STORE.help}>{t('extension.howUpdate')}</a></div>
{:else if stale(status) && !dismissed}
  <div class="banner" role="status">
    <p>{t('extension.newVersion', { version: LATEST_EXTENSION, whatsNew: t('extension.whatsNew') })}</p>
    <div class="row">
      <a class="button primary" href={STORE.help}>{t('extension.howUpdate')}</a>
      <button onclick={notNow}>{t('extension.notNow')}</button>
    </div>
  </div>
{:else if status && !status.installed}
  <div class="banner" role="status">
    {#if where === 'apple' || where === 'android'}
      <p>{t('extension.noSearchHere')}</p>
      <a class="button primary" href={href({ name: 'settings', section: 'data' })}>{t('extension.import')}</a>
      {#if where === 'apple'}<p class="small">{t('extension.homeScreen')}</p>{/if}
    {:else}
      <p>{t(where === 'firefox' || where === 'android-firefox' ? 'extension.addFirefox' : 'extension.add')}</p>
      <div class="row">
        <a class="button primary" href={STORE.help}>{t('extension.how')}</a>
        {#if store}<a href={store}>{t('extension.get')}</a>{/if}
        <button onclick={refreshExtension}>{t('extension.check')}</button>
      </div>
      <p class="small">{t('extension.orImport')} <a href={href({ name: 'settings', section: 'data' })}>{t('extension.import')}</a></p>
    {/if}
  </div>
{/if}

<style>
  /* Un aviso del editor: recuadro de tinta con una esquina mostaza. */
  .banner { border: 1.5px solid var(--ink); border-left-width: 6px; border-left-color: var(--gold); background: var(--surface);
    padding: 12px 16px; margin-bottom: 18px; display: grid; gap: 8px; justify-items: start; }
  p { margin: 0; font-family: var(--serif); font-size: 17px; }
  .small { font-family: var(--text); font-size: 13px; color: var(--muted); }
  .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .button { display: inline-block; padding: 6px 14px; border-radius: var(--radius); text-decoration: none; }
  .button.primary { background: var(--ink); color: var(--paper); font-family: var(--display); font-stretch: 80%; font-weight: 700;
    letter-spacing: .03em; }
  .button.primary:hover { background: #2d3e5f; }
</style>
