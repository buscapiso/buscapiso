<script lang="ts">
  import AISettings from '../lib/components/AISettings.svelte';
  import AutoSettings from '../lib/components/AutoSettings.svelte';
  import PhonePanel from '../lib/components/PhonePanel.svelte';
  import TravelSettings from '../lib/components/TravelSettings.svelte';
  import Profile from './Profile.svelte';
  import { SECTIONS, href, type Section } from '../lib/router.svelte';
  import { t } from '../lib/i18n';
  import { quitApp } from '../lib/api';

  let { section }: { section: Section } = $props();
  let closed = $state(false);

  async function quit() {
    try { await quitApp(); } finally { closed = true; }
  }
</script>

<div class="settings">
  <nav aria-label={t('settings.sections')}>
    {#each SECTIONS as s}
      <a href={href({ name: 'settings', section: s })} aria-current={s === section ? 'page' : undefined}>
        {t(`settings.${s}`)}</a>
    {/each}
  </nav>
  <div class="pane">
    <h1>{t(`settings.${section}`)}</h1>
    {#key section}
      {#if section === 'search'}
        <Profile part="basics" />
      {:else if section === 'places'}
        <Profile part="places" />
        <TravelSettings />
      {:else if section === 'zones'}
        <Profile part="zones" />
      {:else if section === 'auto'}
        <AutoSettings part="schedule" />
      {:else if section === 'phone'}
        <PhonePanel />
        <AutoSettings part="notify" />
      {:else if section === 'ai'}
        <AISettings />
      {/if}
    {/key}
    <footer>
      {#if closed}<p class="closed">{t('settings.closed')}</p>
      {:else}<button onclick={quit}>{t('settings.quit')}</button> <small>{t('settings.quitHelp')}</small>{/if}
    </footer>
  </div>
</div>

<style>
  .settings { display: grid; grid-template-columns: 200px 1fr; gap: 24px; align-items: start; }
  nav { display: grid; gap: 2px; position: sticky; top: 90px; }
  nav a { padding: 8px 10px; border-radius: 8px; color: var(--muted); text-decoration: none; }
  nav a[aria-current='page'] { background: var(--surface); color: var(--ink); font-weight: 700;
    border: 1px solid var(--line); }
  .pane { min-width: 0; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--line); }
  footer small { color: var(--muted); }
  .closed { font-weight: 700; }
  h1 { margin-top: 0; }
  @media (max-width: 760px) {
    .settings { grid-template-columns: 1fr; gap: 12px; }
    nav { position: static; display: flex; overflow-x: auto; gap: 6px; }
    nav a { white-space: nowrap; border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; }
  }
</style>
