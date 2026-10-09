<script lang="ts">
  import type { SearchProfile } from '../api';
  import { href } from '../router.svelte';
  import { t } from '../i18n';

  let { profile, onsave }: { profile: SearchProfile; onsave: (p: SearchProfile) => void } = $props();

  type Editing = { kind: 'type' } | { kind: 'budget' } | { kind: 'gender' } | { kind: 'flat' }
    | { kind: 'minutes'; index: number } | { kind: 'sources' };
  let editing = $state<Editing | null>(null);
  let draft = $state<SearchProfile | null>(null);
  const SOURCES = ['idealista', 'fotocasa', 'roomgo', 'depisoenpiso'];
  const FLAT_SOURCES = ['fotocasa', 'habitaclia'];

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

  const flat = $derived(profile.listing_type === 'flat');
  const sources = $derived(flat ? profile.flat_sources : profile.sources);
  const flatChip = $derived([
    t(profile.flat.min_bedrooms === 1 ? 'criteria.bedroom' : 'criteria.bedrooms', { count: profile.flat.min_bedrooms }),
    profile.flat.min_surface_m2 ? t('criteria.surface', { m2: profile.flat.min_surface_m2 }) : '',
    profile.flat.elevator_required ? t('criteria.lift') : '',
  ].filter(Boolean).join(' · '));
  const gender = $derived(profile.household.gender === 'any' ? t('criteria.anyGender')
    : t(`gender.${profile.household.gender}`));
  const limited = $derived(profile.destinations
    .map((d, index) => ({ d, index })).filter(({ d }) => d.max_minutes !== null));
</script>

<div class="criteria">
  <button class="chip type" class:on={editing?.kind === 'type'} onclick={() => open({ kind: 'type' })}>
    {t(`type.${profile.listing_type}`)}</button>
  <button class="chip" class:on={editing?.kind === 'budget'} onclick={() => open({ kind: 'budget' })}>
    {t('criteria.budget', { value: flat ? profile.flat.max_rent : profile.budget.max_total })}</button>
  {#if flat}
    <button class="chip" class:on={editing?.kind === 'flat'} onclick={() => open({ kind: 'flat' })}>{flatChip}</button>
  {:else}
    <button class="chip" class:on={editing?.kind === 'gender'} onclick={() => open({ kind: 'gender' })}>{gender}</button>
  {/if}
  {#each limited as { d, index }}
    <button class="chip" class:on={editing?.kind === 'minutes' && editing.index === index}
      onclick={() => open({ kind: 'minutes', index })}>
      {t('criteria.minutes', { minutes: d.max_minutes ?? 0, place: d.name })}</button>
  {/each}
  <button class="chip" class:on={editing?.kind === 'sources'} onclick={() => open({ kind: 'sources' })}>
    {sources.length === 1 ? t('criteria.portal') : t('criteria.portals', { count: sources.length })}</button>
  <a href={href({ name: 'settings', section: 'search' })}>{t('criteria.all')}</a>
</div>

{#if editing && draft}
  <div class="editor">
    {#if editing.kind === 'type'}
      <fieldset class="sources"><legend>{t('profile.lookingFor')}</legend>
        {#each ['room', 'flat'] as k}
          <label class="check"><input type="radio" name="listing-type" value={k} bind:group={draft.listing_type} />
            {t(`type.${k}Long`)}</label>
        {/each}
      </fieldset>
    {:else if editing.kind === 'budget' && draft.listing_type === 'flat'}
      <label>{t('profile.maxRent')}<input type="number" min="1" bind:value={draft.flat.max_rent} /></label>
      <label>{t('profile.idealRent')}<input type="number" min="1" bind:value={draft.flat.ideal_rent} /></label>
    {:else if editing.kind === 'budget'}
      <label>{t('profile.maxTotal')}<input type="number" min="1" bind:value={draft.budget.max_total} /></label>
      <label>{t('profile.idealTotal')}<input type="number" min="1" bind:value={draft.budget.ideal_total} /></label>
    {:else if editing.kind === 'flat'}
      <label>{t('profile.minBedrooms')}<input type="number" min="0" max="10" bind:value={draft.flat.min_bedrooms} /></label>
      <label>{t('profile.minSurface')}<input type="number" min="1" value={draft.flat.min_surface_m2 ?? ''}
        oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; draft!.flat.min_surface_m2 = v === '' ? null : Number(v); }} /></label>
      <label class="check"><input type="checkbox" bind:checked={draft.flat.elevator_required} /> {t('profile.elevatorRequired')}</label>
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
      {@const key = draft.listing_type === 'flat' ? 'flat_sources' : 'sources'}
      <fieldset class="sources"><legend>{t('profile.sources')}</legend>
        {#each key === 'flat_sources' ? FLAT_SOURCES : SOURCES as s}
          <label class="check"><input type="checkbox" checked={draft[key].includes(s)}
            onchange={(e) => { const on = (e.currentTarget as HTMLInputElement).checked;
              draft![key] = on ? [...draft![key], s] : draft![key].filter((x) => x !== s); }} /> {s}</label>
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
  .chip.type { font-weight: 700; }
  a { font-size: 14px; margin-left: 4px; }
  .editor { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 12px; margin: 0 0 12px; display: grid; gap: 10px; max-width: 420px; }
  label { display: grid; gap: 4px; font-size: 14px; }
  .check { display: flex; gap: 8px; align-items: center; }
  .sources { border: 0; padding: 0; margin: 0; display: grid; gap: 4px; }
  .sources legend { font-size: 14px; padding: 0; margin-bottom: 4px; }
  .actions { display: flex; gap: 8px; }
</style>
