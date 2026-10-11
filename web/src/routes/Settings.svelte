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
  nav { border-top: 3px double var(--ink); padding-top: 6px; }
  nav a { padding: 6px 0; color: var(--ink); text-decoration: none; font-family: var(--serif); font-size: 17px;
    border-bottom: 1px dotted var(--line-strong); }
  nav a:hover { color: var(--accent); }
  nav a[aria-current='page'] { color: var(--gold-ink); font-weight: 600; }
  nav a[aria-current='page']::before { content: '▸ '; font-size: 13px; }
  .pane { min-width: 0; }
  h1 { margin-top: 0; }
  @media (max-width: 760px) {
    .settings { grid-template-columns: 1fr; gap: 12px; }
    nav { position: static; display: flex; overflow-x: auto; gap: 6px; }
    nav { border-top: 0; padding-top: 0; border-bottom: 1px solid var(--ink); }
    nav a { white-space: nowrap; border: 0; padding: 6px 12px 6px 0; font-size: 16px; }
  }
</style>
