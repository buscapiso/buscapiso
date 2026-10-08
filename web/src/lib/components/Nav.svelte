<script lang="ts">
  import { href, type Route } from '../router.svelte';
  import { t } from '../i18n';

  let { current }: { current: Route['name'] } = $props();

  const ALL = [
    { name: 'inbox', label: 'nav.inbox' },
    { name: 'liked', label: 'nav.liked' },
    { name: 'progress', label: 'nav.progress' },
    { name: 'ask', label: 'nav.ask' },
    { name: 'hidden', label: 'nav.hidden' },
    { name: 'board', label: 'nav.board' },
    { name: 'map', label: 'nav.map' },
    { name: 'search', label: 'nav.search' },
    { name: 'phone', label: 'nav.phone' },
    { name: 'profile', label: 'nav.profile' },
  ] as const;
  // En el movil, lo que se usa a diario a mano; el resto bajo "More".
  const PHONE = ['inbox', 'liked', 'map', 'search', 'profile'];
  const primary = ALL.filter((x) => PHONE.includes(x.name));
  const rest = ALL.filter((x) => !PHONE.includes(x.name));
  let more = $state<HTMLDetailsElement>();
</script>

<nav class="top" aria-label={t('nav.main')}>
  {#each ALL as tab}
    <a href={href({ name: tab.name })} aria-current={current === tab.name ? 'page' : undefined}>{t(tab.label)}</a>
  {/each}
</nav>

<nav class="bar" aria-label={t('nav.mainPhone')}>
  {#each primary as tab}
    <a href={href({ name: tab.name })} aria-current={current === tab.name ? 'page' : undefined}>{t(tab.label)}</a>
  {/each}
  <details bind:this={more}>
    <summary>{t('nav.more')}</summary>
    <div class="menu">
      {#each rest as tab}
        <a href={href({ name: tab.name })} onclick={() => more && (more.open = false)}
           aria-current={current === tab.name ? 'page' : undefined}>{t(tab.label)}</a>
      {/each}
    </div>
  </details>
</nav>

<style>
  .top { display: flex; gap: 14px; overflow-x: auto; margin-top: 6px; }
  a { color: var(--muted); text-decoration: none; white-space: nowrap; padding: 4px 0; }
  a[aria-current='page'] { color: var(--ink); border-bottom: 2px solid var(--accent); }
  .bar { display: none; }
  @media (max-width: 560px) {
    .top { display: none; }
    .bar {
      display: grid; grid-template-columns: repeat(6, 1fr); align-items: center;
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000;
      background: var(--surface); border-top: 1px solid var(--line);
      padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
    }
    .bar > a, summary { text-align: center; font-size: 13px; padding: 10px 2px; list-style: none; cursor: pointer; color: var(--muted); }
    .bar > a[aria-current='page'] { border-bottom: 0; color: var(--accent); font-weight: 700; }
    summary::-webkit-details-marker { display: none; }
    details { position: relative; }
    .menu { position: absolute; right: 0; bottom: 48px; background: var(--surface);
      border: 1px solid var(--line); border-radius: var(--radius); padding: 6px 12px;
      display: grid; min-width: 160px; }
    .menu a { padding: 10px 4px; }
  }
</style>
