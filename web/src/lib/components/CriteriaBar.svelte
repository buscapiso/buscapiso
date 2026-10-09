<script lang="ts">
  import type { SearchProfile } from '../api';
  import { href } from '../router.svelte';
  import { t } from '../i18n';

  let { profile, onsave }: { profile: SearchProfile; onsave: (p: SearchProfile) => void } = $props();

  type Editing = { kind: 'budget' } | { kind: 'gender' } | { kind: 'minutes'; index: number } | { kind: 'sources' };
  let editing = $state<Editing | null>(null);
  let draft = $state<SearchProfile | null>(null);
  const SOURCES = ['idealista', 'fotocasa', 'roomgo', 'depisoenpiso'];

  // Se edita una copia; al guardar se envia el perfil entero con un solo cambio.
  function open(e: Editing) {
    draft = structuredClone($state.snapshot(profile)) as SearchProfile;
    editing = e;
  }
  function close() { editing = null; draft = null; }
  function save() {
    if (draft) onsave(draft);
    close();
  }

  const gender = $derived(profile.household.gender === 'any' ? t('criteria.anyGender')
    : t(`gender.${profile.household.gender}`));
  const limited = $derived(profile.destinations
    .map((d, index) => ({ d, index })).filter(({ d }) => d.max_minutes !== null));
</script>

<div class="criteria">
  <button class="chip" class:on={editing?.kind === 'budget'} onclick={() => open({ kind: 'budget' })}>
    {t('criteria.budget', { value: profile.budget.max_total })}</button>
  <button class="chip" class:on={editing?.kind === 'gender'} onclick={() => open({ kind: 'gender' })}>{gender}</button>
  {#each limited as { d, index }}
    <button class="chip" class:on={editing?.kind === 'minutes' && editing.index === index}
      onclick={() => open({ kind: 'minutes', index })}>
      {t('criteria.minutes', { minutes: d.max_minutes ?? 0, place: d.name })}</button>
  {/each}
  <button class="chip" class:on={editing?.kind === 'sources'} onclick={() => open({ kind: 'sources' })}>
    {profile.sources.length === 1 ? t('criteria.portal') : t('criteria.portals', { count: profile.sources.length })}</button>
  <a href={href({ name: 'settings', section: 'search' })}>{t('criteria.all')}</a>
</div>

{#if editing && draft}
  <div class="editor">
    {#if editing.kind === 'budget'}
      <label>{t('profile.maxTotal')}<input type="number" min="1" bind:value={draft.budget.max_total} /></label>
      <label>{t('profile.idealTotal')}<input type="number" min="1" bind:value={draft.budget.ideal_total} /></label>
    {:else if editing.kind === 'gender'}
      <label>{t('profile.gender')}
        <select bind:value={draft.household.gender}>
          {#each ['female_only', 'male_only', 'mixed', 'any'] as g}<option value={g}>{t(`gender.${g}`)}</option>{/each}
        </select>
      </label>
    {:else if editing.kind === 'minutes'}
      {@const d = draft.destinations[editing.index]}
      <label>{t('criteria.maxMinutesTo', { place: d.name })}
        <input type="number" min="1" value={d.max_minutes ?? ''}
          oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; d.max_minutes = v === '' ? null : Number(v); }} />
      </label>
    {:else if editing.kind === 'sources'}
      <fieldset class="sources"><legend>{t('profile.sources')}</legend>
        {#each SOURCES as s}
          <label class="check"><input type="checkbox" checked={draft.sources.includes(s)}
            onchange={(e) => { const on = (e.currentTarget as HTMLInputElement).checked;
              draft!.sources = on ? [...draft!.sources, s] : draft!.sources.filter((x) => x !== s); }} /> {s}</label>
        {/each}
      </fieldset>
    {/if}
    <div class="actions">
      <button class="primary" onclick={save}>{t('criteria.save')}</button>
      <button onclick={close}>{t('criteria.cancel')}</button>
    </div>
  </div>
{/if}

<style>
  .criteria { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; }
  .chip { border-radius: 999px; padding: 2px 12px; min-height: 30px; font-size: 14px; }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  a { font-size: 14px; margin-left: 4px; }
  .editor { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 12px; margin: 0 0 12px; display: grid; gap: 10px; max-width: 420px; }
  label { display: grid; gap: 4px; font-size: 14px; }
  .check { display: flex; gap: 8px; align-items: center; }
  .sources { border: 0; padding: 0; margin: 0; display: grid; gap: 4px; }
  .sources legend { font-size: 14px; padding: 0; margin-bottom: 4px; }
  .actions { display: flex; gap: 8px; }
</style>
