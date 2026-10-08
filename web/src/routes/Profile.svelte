<script lang="ts">
  import {
    ApiError, activateProfile, deleteProfile, getActiveProfile, getMeta, listProfiles,
    saveProfile, type Meta, type ProfileSummary, type SearchProfile,
  } from '../lib/api';
  import { fieldErrors } from '../lib/profileErrors';
  import { t } from '../lib/i18n';

  let p = $state<SearchProfile | null>(null);
  let profiles = $state<ProfileSummary[]>([]);
  let meta = $state<Meta | null>(null);
  let errors = $state<Record<string, string>>({});
  let saved = $state(false);
  let zones = $state({ exclude: '', penalize: '', prefer: '' });

  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  async function load() {
    const [perfil, lista, vocab] = await Promise.all([getActiveProfile(), listProfiles(), getMeta()]);
    p = perfil;
    profiles = lista;
    meta = vocab;
    zones = { exclude: perfil.zones.exclude.join('\n'), penalize: perfil.zones.penalize.join('\n'),
              prefer: perfil.zones.prefer.join('\n') };
  }

  async function save() {
    if (!p) return;
    errors = {};
    p.zones = { exclude: lines(zones.exclude), penalize: lines(zones.penalize), prefer: lines(zones.prefer) };
    try {
      p = await saveProfile($state.snapshot(p));
      saved = true;
      setTimeout(() => (saved = false), 1500);
    } catch (e) {
      errors = e instanceof ApiError ? fieldErrors(e.detail) : { '': String(e) };
    }
  }

  async function switchTo(name: string) {
    await activateProfile(name);
    await load();
  }

  async function duplicate() {
    const name = prompt(t('profile.newName'));
    if (!name || !p) return;
    await saveProfile({ ...$state.snapshot(p), name });
    await switchTo(name);
  }

  async function remove(name: string) {
    await deleteProfile(name);
    profiles = await listProfiles();
  }

  function toggleSource(s: string, on: boolean) {
    if (!p) return;
    p.sources = on ? [...p.sources, s] : p.sources.filter((x) => x !== s);
  }

  const err = (path: string) => errors[path];
  $effect(() => { load(); });
</script>

{#if p && meta}
  <h1>{t('profile.title')}</h1>

  <div class="profiles">
    <label>{t('profile.active')}
      <select value={p.name} onchange={(e) => switchTo((e.currentTarget as HTMLSelectElement).value)}>
        {#each profiles as pr}<option value={pr.name}>{pr.name}</option>{/each}
      </select>
    </label>
    <button onclick={duplicate}>{t('profile.duplicate')}</button>
    {#each profiles.filter((x) => !x.active) as pr}
      <button onclick={() => remove(pr.name)}>{t('profile.delete')} {pr.name}</button>
    {/each}
  </div>

  {#if err('')}<p class="error" role="alert">{err('')}</p>{/if}

  <fieldset>
    <legend>{t('profile.sources')}</legend>
    {#each meta.sources as s}
      <label class="check"><input type="checkbox" checked={p.sources.includes(s)}
        onchange={(e) => toggleSource(s, (e.currentTarget as HTMLInputElement).checked)} /> {s}</label>
    {/each}
    {#if err('sources')}<p class="error">{err('sources')}</p>{/if}
  </fieldset>

  <fieldset>
    <legend>{t('profile.budget')}</legend>
    <label>{t('profile.idealTotal')}<input type="number" bind:value={p.budget.ideal_total} /></label>
    <label>{t('profile.maxTotal')}<input type="number" bind:value={p.budget.max_total} /></label>
    <label>{t('profile.assumedExpenses')}<input type="number" bind:value={p.budget.assumed_expenses} /></label>
    {#if err('budget')}<p class="error">{err('budget')}</p>{/if}
  </fieldset>

  <fieldset>
    <legend>{t('profile.household')}</legend>
    <label>{t('profile.gender')}
      <select bind:value={p.household.gender}>
        {#each meta.genders as g}<option value={g}>{t(`gender.${g}`)}</option>{/each}
      </select>
    </label>
    <label class="check"><input type="checkbox" bind:checked={p.household.ask_if_gender_unknown} /> {t('profile.askIfUnknown')}</label>
    <label>{t('profile.minScoreToAsk')}<input type="number" bind:value={p.household.min_score_to_ask} /></label>
    <label class="check"><input type="checkbox" bind:checked={p.household.no_live_in_owner} /> {t('profile.noLiveInOwner')}</label>
    <label>{t('profile.visits')}
      <select bind:value={p.household.visits}>
        {#each ['strict', 'preferred', 'indifferent'] as v}<option value={v}>{t(`visits.${v}`)}</option>{/each}
      </select>
    </label>
  </fieldset>

  <fieldset>
    <legend>{t('profile.destinations')}</legend>
    <p class="help">{t('profile.destinationsHelp')}</p>
    {#each p.destinations as d, i}
      <div class="dest">
        <label>{t('profile.destName')}<input bind:value={d.name} /></label>
        <label>{t('profile.destLat')}<input type="number" step="any" bind:value={d.lat} /></label>
        <label>{t('profile.destLon')}<input type="number" step="any" bind:value={d.lon} /></label>
        <label>{t('profile.destMax')}<input type="number" value={d.max_minutes ?? ''}
          oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; d.max_minutes = v === '' ? null : Number(v); }} /></label>
        <label>{t('profile.destWeight')}<input type="number" step="0.1" bind:value={d.minute_weight} /></label>
        <button onclick={() => p!.destinations.splice(i, 1)}>{t('profile.remove')}</button>
        {#each ['name', 'lat', 'lon', 'max_minutes'] as f}
          {#if err(`destinations.${i}.${f}`)}<p class="error">{err(`destinations.${i}.${f}`)}</p>{/if}
        {/each}
      </div>
    {/each}
    <button onclick={() => p!.destinations.push({ name: '', lat: 41.3874, lon: 2.1686, max_minutes: null, minute_weight: 1 })}>
      {t('profile.addDestination')}</button>
    {#if err('destinations')}<p class="error">{err('destinations')}</p>{/if}
  </fieldset>

  <fieldset>
    <legend>{t('profile.zones')}</legend>
    <p class="help">{t('profile.zonesHelp')}</p>
    <label>{t('profile.zonesExclude')}<textarea rows="3" bind:value={zones.exclude}></textarea></label>
    <label>{t('profile.zonesPenalize')}<textarea rows="3" bind:value={zones.penalize}></textarea></label>
    <label>{t('profile.zonesPrefer')}<textarea rows="3" bind:value={zones.prefer}></textarea></label>
  </fieldset>

  <fieldset>
    <legend>{t('profile.crawl')}</legend>
    <label>{t('profile.maxPages')}<input type="number" min="1" max="20" bind:value={p.crawl.max_pages} /></label>
    <label>{t('profile.detailsToRead')}<input type="number" min="0" bind:value={p.crawl.details_to_read} /></label>
  </fieldset>

  <details>
    <summary>{t('profile.weights')}</summary>
    <div class="weights">
      {#each Object.keys(p.weights) as k}
        <label>{k}<input type="number" step="any" bind:value={p.weights[k]} /></label>
      {/each}
    </div>
  </details>

  <div class="save">
    <button class="primary" onclick={save}>{t('profile.save')}</button>
    {#if saved}<span class="ok">{t('profile.saved')}</span>{/if}
  </div>
{/if}

<style>
  .profiles { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 16px; }
  fieldset { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface);
    margin: 0 0 16px; padding: 12px 16px; display: grid; gap: 10px; }
  legend { font-weight: 600; padding: 0 4px; }
  label { display: grid; gap: 4px; font-size: 14px; min-width: 0; }
  label :is(input:not([type='checkbox']), select, textarea) { width: 100%; min-width: 0; }
  label.check { display: flex; gap: 8px; align-items: center; }
  .dest { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px;
    align-items: end; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
  .weights { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-top: 8px; }
  .help { color: var(--muted); font-size: 13px; margin: 0; }
  .error { color: var(--bad); margin: 0; font-size: 13px; }
  .save { position: sticky; bottom: 0; background: var(--paper); padding: 12px 0; display: flex; gap: 12px; align-items: center; }
  .ok { color: var(--ok); }
</style>
