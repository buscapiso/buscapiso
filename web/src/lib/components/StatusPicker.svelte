<script lang="ts">
  import type { Status } from '../api';
  import { STATUSES } from '../format';
  import { t } from '../i18n';

  let { value, onchange }: { value: Status; onchange: (s: Status) => void } = $props();
</script>

<!-- aria-label y no <label> envolvente: el texto de un label que envuelve un
     select incluye el de todas sus opciones, y deja de ser "Status". -->
<div class="picker">
  <span aria-hidden="true">{t('status.label')}</span>
  <select aria-label={t('status.label')} {value}
    onchange={(e) => onchange((e.currentTarget as HTMLSelectElement).value as Status)}>
    {#each STATUSES as s}
      <option value={s}>{t(`status.${s}`)}</option>
    {/each}
  </select>
</div>

<style>
  .picker { display: inline-flex; gap: 8px; align-items: center; }
  span { color: var(--muted); font-size: 13px; }
</style>
