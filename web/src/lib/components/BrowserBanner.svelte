<script lang="ts">
  import { getBrowser, installBrowser, type BrowserState } from '../api';
  import { t } from '../i18n';

  let { every = 2000 }: { every?: number } = $props();
  let s = $state<BrowserState | null>(null);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    try {
      s = await getBrowser();
      if (!s.installing && timer) { clearInterval(timer); timer = undefined; }
    } catch { /* sin servidor: no se ensena nada */ }
  }

  async function install() {
    await installBrowser();
    await refresh();
    timer = setInterval(refresh, every);
  }

  $effect(() => { refresh(); return () => timer && clearInterval(timer); });
</script>

{#if s && !s.installed}
  <div class="banner" role="status">
    {#if s.installing}
      <p><strong>{t('browser.installing')}</strong></p>
      {#if s.log.length}<p class="log">{s.log.at(-1)}</p>{/if}
    {:else}
      <p>{t('browser.missing')}</p>
      {#if s.error}<p class="error">{t('browser.failed', { message: s.error })}</p>{/if}
      <button class="primary" onclick={install}>{t('browser.install')}</button>
    {/if}
  </div>
{/if}

<style>
  .banner { border-left: 3px solid var(--accent); background: var(--surface); padding: 10px 14px;
    margin-bottom: 12px; display: grid; gap: 6px; justify-items: start; }
  p { margin: 0; font-size: 14px; }
  .log { color: var(--muted); font-size: 13px; }
  .error { color: var(--bad); }
</style>
