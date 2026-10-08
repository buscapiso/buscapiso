<script lang="ts">
  import { t } from '../i18n';

  let { label, options, selected, onchange }: {
    label: string; options: string[]; selected: string[]; onchange: (names: string[]) => void;
  } = $props();
  let query = $state('');

  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const matches = $derived(query.trim().length < 2 ? [] :
    options.filter((o) => norm(o).includes(norm(query.trim())) && !selected.includes(o)).slice(0, 8));

  function add(name: string) {
    const n = name.trim();
    if (n && !selected.includes(n)) onchange([...selected, n]);
    query = '';
  }
</script>

<div class="picker">
  <label>{label}
    <input bind:value={query} placeholder={t('zones.searchPlaceholder')} autocomplete="off"
      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(matches[0] ?? query); } }} />
  </label>
  {#if matches.length}
    <ul role="listbox" aria-label={label}>
      {#each matches as m}<li role="presentation"><button role="option" aria-selected="false" onclick={() => add(m)}>{m}</button></li>{/each}
    </ul>
  {/if}
  <div class="chips">
    {#each selected as s}
      <span class="chip">{s}<button aria-label={t('zones.remove', { name: s })}
        onclick={() => onchange(selected.filter((x) => x !== s))}>×</button></span>
    {/each}
  </div>
</div>

<style>
  .picker { display: grid; gap: 6px; position: relative; }
  label { display: grid; gap: 4px; font-size: 14px; }
  input { width: 100%; }
  ul { list-style: none; margin: 0; padding: 4px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--surface); display: grid; }
  ul button { width: 100%; text-align: left; border: 0; background: none; min-height: 32px; }
  ul button:hover { background: var(--paper); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line);
    border-radius: 999px; padding: 1px 4px 1px 10px; font-size: 13px; background: var(--surface); }
  .chip button { border: 0; background: none; min-height: 24px; padding: 0 6px; font-size: 16px; line-height: 1; }
</style>
