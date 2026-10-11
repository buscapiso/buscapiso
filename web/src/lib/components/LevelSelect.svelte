<script lang="ts">
  import type { Level } from '../api';
  import { t } from '../i18n';

  // Una preferencia con su nivel: imprescindible, mejor si, me da igual.
  let { label, value = $bindable('any') }: { label: string; value?: Level } = $props();
</script>

<label class="level">
  <span>{label}</span>
  <select bind:value>
    {#each ['required', 'preferred', 'any'] as l}<option value={l}>{t(`level.${l}`)}</option>{/each}
  </select>
</label>

<style>
  .level { display: grid; grid-template-columns: minmax(0, 1fr) 9.5em; gap: 10px; align-items: center; font-size: 14px; }
  select { width: 100%; }
</style>
