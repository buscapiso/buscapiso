<script lang="ts">
  import { ApiError, suggestProfile, type ProfileSuggestion } from '../api';
  import { t } from '../i18n';

  let { onapply }: { onapply: (s: ProfileSuggestion) => void } = $props();
  let text = $state('');
  let suggestion = $state<ProfileSuggestion | null>(null);
  let busy = $state(false);
  let error = $state('');
  let applied = $state(false);

  const lines = $derived.by(() => {
    const s = suggestion;
    if (!s) return [];
    const out: string[] = [];
    if (s.budget_ideal !== null) out.push(t('describe.budgetIdeal', { value: s.budget_ideal }));
    if (s.budget_max !== null) out.push(t('describe.budgetMax', { value: s.budget_max }));
    if (s.household_gender) out.push(t('describe.household', { value: t(`gender.${s.household_gender}`) }));
    if (s.owner_must_not_live_in) out.push(t('describe.owner'));
    if (s.visits) out.push(t('describe.visits', { value: t(`visits.${s.visits}`) }));
    for (const p of s.places) {
      out.push(p.max_minutes !== null
        ? t('describe.placeLimit', { name: p.name, address: p.address, minutes: p.max_minutes })
        : t('describe.place', { name: p.name, address: p.address }));
    }
    return out;
  });

  async function suggest() {
    busy = true; error = ''; suggestion = null; applied = false;
    try { suggestion = await suggestProfile(text); } catch (e) {
      error = e instanceof ApiError ? String(e.detail) : String(e);
    } finally { busy = false; }
  }

  function apply() {
    if (suggestion) onapply(suggestion);
    suggestion = null;
    applied = true;
  }
</script>

<div class="describe">
  <label>{t('describe.label')}
    <textarea rows="3" bind:value={text} placeholder={t('describe.placeholder')}></textarea>
  </label>
  <button onclick={suggest} disabled={busy || !text.trim()}>{t('describe.suggest')}</button>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if applied}<p class="help">{t('describe.review')}</p>{/if}
  {#if suggestion}
    {#if lines.length}
      <ul>{#each lines as l}<li>{l}</li>{/each}</ul>
      <button class="primary" onclick={apply}>{t('describe.apply')}</button>
    {:else}
      <p class="help">{t('describe.nothing')}</p>
    {/if}
  {/if}
</div>

<style>
  .describe { display: grid; gap: 8px; justify-items: start; margin-bottom: 16px; }
  label { display: grid; gap: 4px; width: 100%; font-size: 14px; }
  textarea { width: 100%; }
  ul { margin: 0; padding-left: 18px; }
  .help { color: var(--muted); font-size: 13px; margin: 0; }
  .error { color: var(--bad); margin: 0; font-size: 13px; }
</style>
