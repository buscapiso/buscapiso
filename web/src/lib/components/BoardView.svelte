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
    gap: var(--gap); overflow-x: auto; padding-bottom: 8px; }
  section { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px; }
  h2 { font-size: 14px; margin: 0 0 8px; }
  h2 span { color: var(--muted); font-weight: 400; }
  .mini { border-top: 1px solid var(--line); padding: 8px 0; display: grid; gap: 4px; }
  .mini a { color: var(--ink); text-decoration: none; font-weight: 600; }
  small { color: var(--muted); }
</style>
