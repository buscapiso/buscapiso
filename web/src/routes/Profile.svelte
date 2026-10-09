<script lang="ts">
  import {
    ApiError, activateProfile, deleteProfile, getActiveProfile, getMeta, listProfiles,
    geocode, saveProfile, type Meta, type Place, type ProfileSuggestion, type ProfileSummary,
    type SearchProfile,
  } from '../lib/api';
  import MapView from '../lib/components/MapView.svelte';
  import TravelSettings from '../lib/components/TravelSettings.svelte';
  import AISettings from '../lib/components/AISettings.svelte';
  import DescribeProfile from '../lib/components/DescribeProfile.svelte';
  import { fieldErrors } from '../lib/profileErrors';
  import { t } from '../lib/i18n';

  let queries = $state<string[]>([]);
  let results = $state<Place[][]>([]);
  let picking = $state(0);

  async function find(i: number) {
    try {
      results[i] = await geocode(queries[i] ?? '');
    } catch (e) {
      errors = { ...errors, [`destinations.${i}.lat`]: String(e) };
    }
  }

  function choose(i: number, r: Place) {
    const d = p!.destinations[i];
    d.lat = r.lat;
    d.lon = r.lon;
    if (!d.name) d.name = r.name.split(',')[0];
    results[i] = [];
  }

  function pick(lat: number, lon: number) {
    const d = p?.destinations[picking];
    if (d) {
      d.lat = Number(lat.toFixed(6));
      d.lon = Number(lon.toFixed(6));
    }
  }

  async function applySuggestion(s: ProfileSuggestion) {
    if (!p) return;
    if (s.budget_ideal !== null) p.budget.ideal_total = s.budget_ideal;
    if (s.budget_max !== null) p.budget.max_total = s.budget_max;
    if (s.household_gender) p.household.gender = s.household_gender;
    if (s.owner_must_not_live_in !== null) p.household.no_live_in_owner = s.owner_must_not_live_in;
    if (s.visits) p.household.visits = s.visits;
    for (const pl of s.places) {
      const found = (await geocode(pl.address).catch(() => []))[0];
      if (!found) {
        errors = { ...errors, destinations: t('describe.notFound', { address: pl.address }) };
        continue;
      }
      p.destinations.push({ name: pl.name, lat: found.lat, lon: found.lon, max_minutes: pl.max_minutes,
                            minute_weight: 1, mode: pl.mode, depart_at: '08:30' });
    }
  }

  function addPlace() {
    p!.destinations.push({ name: '', lat: 41.3874, lon: 2.1686, max_minutes: null,
                           minute_weight: 1, mode: 'transit', depart_at: '08:30' });
    picking = p!.destinations.length - 1;
  }

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
  // Pydantic senala el campo hoja (budget.ideal_total): cada bloque muestra
  // todo lo que cae dentro de el, para que ningun error quede sin ver.
  const under = (prefix: string) => Object.entries(errors)
    .filter(([k]) => k.startsWith(`${prefix}.`))
    .map(([k, m]) => `${k.slice(prefix.length + 1)}: ${m}`);
  $effect(() => { load(); });
</script>

{#if p && meta}
  <h1>{t('profile.title')}</h1>
  <DescribeProfile onapply={applySuggestion} />

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

  {#if Object.keys(errors).length}
    <p class="error" role="alert">{t('profile.fixErrors')}{err('') ? ` ${err('')}` : ''}</p>
  {/if}

  <fieldset>
    <legend>{t('profile.sources')}</legend>
    {#each meta.sources as s}
      <label class="check"><input type="checkbox" checked={p.sources.includes(s)}
        onchange={(e) => toggleSource(s, (e.currentTarget as HTMLInputElement).checked)} /> {s}</label>
    {/each}
    {#if err('sources')}<p class="error">{err('sources')}</p>{/if}
    {#each under('sources') as m}<p class="error">{m}</p>{/each}
  </fieldset>

  <fieldset>
    <legend>{t('profile.budget')}</legend>
    <label>{t('profile.idealTotal')}<input type="number" bind:value={p.budget.ideal_total} /></label>
    <label>{t('profile.maxTotal')}<input type="number" bind:value={p.budget.max_total} /></label>
    <label>{t('profile.assumedExpenses')}<input type="number" bind:value={p.budget.assumed_expenses} /></label>
    {#if err('budget')}<p class="error">{err('budget')}</p>{/if}
    {#each under('budget') as m}<p class="error">{m}</p>{/each}
  </fieldset>

  <fieldset>
    <legend>{t('profile.household')}</legend>
    {#each under('household') as m}<p class="error">{m}</p>{/each}
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
        <label>{t('profile.destMode')}
          <select bind:value={d.mode}>
            {#each ['transit', 'walk', 'bike'] as m}<option value={m}>{t(`mode.${m}`)}</option>{/each}
          </select>
        </label>
        <label>{t('profile.destDepart')}<input type="time" bind:value={d.depart_at} /></label>
        <div class="find">
          <label>{t('profile.findAddress')}<input bind:value={queries[i]} /></label>
          <button onclick={() => find(i)}>{t('profile.search')}</button>
          <button onclick={() => (picking = i)} aria-pressed={picking === i}>{t('profile.placeOnMap')}</button>
        </div>
        {#if results[i]?.length}
          <ul class="results">
            {#each results[i] as r}<li><button onclick={() => choose(i, r)}>{r.name}</button></li>{/each}
          </ul>
        {/if}
        <button onclick={() => p!.destinations.splice(i, 1)}>{t('profile.remove')}</button>
        {#each under(`destinations.${i}`) as m}<p class="error">{m}</p>{/each}
      </div>
    {/each}
    <button onclick={addPlace}>{t('profile.addDestination')}</button>
    <p class="help">{t('profile.pickHelp')}</p>
    <MapView label={t('profile.destinationsMap')} places={p.destinations} onpick={pick} height="300px" />
    {#if err('destinations')}<p class="error">{err('destinations')}</p>{/if}
  </fieldset>

  <fieldset>
    <legend>{t('profile.zones')}</legend>
    {#each under('zones') as m}<p class="error">{m}</p>{/each}
    <p class="help">{t('profile.zonesHelp')}</p>
    <label>{t('profile.zonesExclude')}<textarea rows="3" bind:value={zones.exclude}></textarea></label>
    <label>{t('profile.zonesPenalize')}<textarea rows="3" bind:value={zones.penalize}></textarea></label>
    <label>{t('profile.zonesPrefer')}<textarea rows="3" bind:value={zones.prefer}></textarea></label>
  </fieldset>

  <fieldset>
    <legend>{t('profile.crawl')}</legend>
    {#each under('crawl') as m}<p class="error">{m}</p>{/each}
    <label>{t('profile.maxPages')}<input type="number" min="1" max="20" bind:value={p.crawl.max_pages} /></label>
    <label>{t('profile.realTravelTimes')}<input type="number" min="0" max="200" bind:value={p.crawl.real_travel_times} /></label>
    <label>{t('profile.detailsToRead')}<input type="number" min="0" bind:value={p.crawl.details_to_read} /></label>
  </fieldset>

  <details>
    <summary>{t('profile.weights')}</summary>
    {#each under('weights') as m}<p class="error">{m}</p>{/each}
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

  <TravelSettings />
  <AISettings />
{/if}

<style>
  .find { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; grid-column: 1 / -1; }
  .find label { flex: 1 1 180px; }
  .results { grid-column: 1 / -1; list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
  .results button { width: 100%; text-align: left; }
  button[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
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
