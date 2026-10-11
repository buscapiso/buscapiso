<script lang="ts">
  import type { Listing, Status } from '../api';
  import StatusPicker from './StatusPicker.svelte';
  import { href } from '../router.svelte';
  import { t } from '../i18n';

  let { items, onmove }: { items: Listing[]; onmove: (l: Listing, s: Status) => void } = $props();
  const COLUMNS: Status[] = ['liked', 'contacted', 'visit_scheduled', 'visited', 'applied', 'got_it', 'rejected'];
</script>

<div class="board">
  {#each COLUMNS as col}
    <section aria-label={t(`status.${col}`)}>
      <h2>{t(`status.${col}`)} <span>{items.filter((l) => l.status === col).length}</span></h2>
      {#each items.filter((l) => l.status === col) as l (l.id)}
        <div class="mini">
          <a href={href({ name: 'listing', id: l.id })}>{l.title || l.neighbourhood}</a>
          <small>{l.total_cost ?? '?'} €</small>
          <StatusPicker value={l.status} onchange={(s) => onmove(l, s)} />
        </div>
      {/each}
    </section>
  {/each}
</div>

<style>
  .board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 1fr);
    gap: 18px; overflow-x: auto; padding: 4px 0 8px; }
  section { border-top: 3px double var(--ink); padding-top: 6px; }
  h2 { font-family: var(--display); font-stretch: 75%; font-weight: 800; font-size: 18px; text-transform: uppercase;
    letter-spacing: .02em; margin: 0 0 6px; display: flex; justify-content: space-between; }
  h2 span { color: var(--gold-ink); font-variant-numeric: tabular-nums; }
  .mini { border-top: 1px solid var(--line); padding: 8px 0; display: grid; gap: 4px; }
  .mini a { color: var(--ink); text-decoration: none; font-family: var(--serif); font-weight: 600; font-size: 16px; line-height: 1.25; }
  .mini a:hover { text-decoration: underline; }
  small { color: var(--muted); }
</style>
