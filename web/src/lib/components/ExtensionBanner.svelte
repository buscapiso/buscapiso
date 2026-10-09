<script lang="ts">
  import { ext, platform, refreshExtension, STORE, type Platform } from '../extensionState.svelte';
  import { href } from '../router.svelte';
  import { t } from '../i18n';

  let { where = platform() }: { where?: Platform } = $props();
  const status = $derived(ext.status);
  const store = $derived(where === 'firefox' || where === 'android-firefox' ? STORE.firefox : STORE.chrome);

  $effect(() => { if (!ext.status) refreshExtension(); });
</script>

{#if status && status.outdated}
  <div class="banner" role="status"><p>{t('extension.outdated')}</p></div>
{:else if status && !status.installed}
  <div class="banner" role="status">
    {#if where === 'apple' || where === 'android'}
      <p>{t('extension.noSearchHere')}</p>
      <a class="button primary" href={href({ name: 'settings', section: 'data' })}>{t('extension.import')}</a>
      {#if where === 'apple'}<p class="small">{t('extension.homeScreen')}</p>{/if}
    {:else}
      <p>{t(where === 'firefox' || where === 'android-firefox' ? 'extension.addFirefox' : 'extension.add')}</p>
      <div class="row">
        {#if store}<a class="button primary" href={store} target="_blank" rel="noopener">{t('extension.get')}</a>{/if}
        <a href={STORE.help} target="_blank" rel="noopener">{t('extension.how')}</a>
        <button onclick={refreshExtension}>{t('extension.check')}</button>
      </div>
      <p class="small">{t('extension.orImport')} <a href={href({ name: 'settings', section: 'data' })}>{t('extension.import')}</a></p>
    {/if}
  </div>
{/if}

<style>
  .banner { border-left: 3px solid var(--accent); background: var(--surface); padding: 10px 14px;
    margin-bottom: 12px; display: grid; gap: 8px; justify-items: start; }
  p { margin: 0; }
  .small { font-size: 13px; color: var(--muted); }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .button { display: inline-block; padding: 6px 12px; border-radius: 8px; text-decoration: none; }
</style>
