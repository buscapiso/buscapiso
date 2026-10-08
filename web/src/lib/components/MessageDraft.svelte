<script lang="ts">
  import { ApiError, draftMessage } from '../api';
  import { t } from '../i18n';

  let { id }: { id: string } = $props();
  let text = $state('');
  let busy = $state(false);
  let error = $state('');
  let copied = $state(false);

  async function draft() {
    busy = true; error = '';
    try { text = (await draftMessage(id)).text; } catch (e) {
      error = e instanceof ApiError ? String(e.detail) : String(e);
    } finally { busy = false; }
  }

  async function copy() {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="draft">
  <button onclick={draft} disabled={busy}>{t('draft.button')}</button>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if text}
    <label>{t('draft.label')}<textarea rows="7" bind:value={text}></textarea></label>
    <button onclick={copy}>{copied ? t('draft.copied') : t('draft.copy')}</button>
  {/if}
</div>

<style>
  .draft { display: grid; gap: 8px; justify-items: start; }
  label { display: grid; gap: 4px; width: 100%; font-size: 14px; }
  textarea { width: 100%; }
  .error { color: var(--bad); margin: 0; font-size: 13px; }
</style>
