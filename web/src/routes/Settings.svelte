<script lang="ts">
  import AISettings from '../lib/components/AISettings.svelte';
  import AutoSettings from '../lib/components/AutoSettings.svelte';
  import DataSettings from '../lib/components/DataSettings.svelte';
  import TravelSettings from '../lib/components/TravelSettings.svelte';
  import Profile from './Profile.svelte';
  import { SECTIONS, href, type Section } from '../lib/router.svelte';
  import { t } from '../lib/i18n';

  let { section }: { section: Section } = $props();
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
      {:else if section === 'alerts'}
        <AutoSettings part="notify" />
      {:else if section === 'ai'}
        <AISettings />
      {:else if section === 'data'}
        <DataSettings />
      {/if}
    {/key}
  </div>
</div>

<style>
  .settings { display: grid; grid-template-columns: 200px 1fr; gap: 24px; align-items: start; }
  nav { display: grid; gap: 2px; position: sticky; top: 90px; }
  nav a { padding: 8px 10px; border-radius: 8px; color: var(--muted); text-decoration: none; }
  nav a[aria-current='page'] { background: var(--surface); color: var(--ink); font-weight: 700;
    border: 1px solid var(--line); }
  .pane { min-width: 0; }
  h1 { margin-top: 0; }
  @media (max-width: 760px) {
    .settings { grid-template-columns: 1fr; gap: 12px; }
    nav { position: static; display: flex; overflow-x: auto; gap: 6px; }
    nav a { white-space: nowrap; border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; }
  }
</style>
