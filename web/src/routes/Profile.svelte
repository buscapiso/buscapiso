<script lang="ts">
  import {
    ApiError, activateProfile, deleteProfile, getActiveProfile, getCities, getMeta, listProfiles,
    geocode, getNeighbourhoods, saveProfile, type Meta, type Place, type ProfileSuggestion, type ProfileSummary,
    type SearchProfile,
  } from '../lib/api';
  import MapView from '../lib/components/MapView.svelte';
  import NeighbourhoodPicker from '../lib/components/NeighbourhoodPicker.svelte';
  import DescribeProfile from '../lib/components/DescribeProfile.svelte';
  import CityPicker from '../lib/components/CityPicker.svelte';
  import LevelSelect from '../lib/components/LevelSelect.svelte';
  import { AMENITIES, type Amenity, type Level } from '../lib/api';

  // Un extra sin nivel guardado es "me da igual"; volver a eso lo borra.
  function setAmenity(a: Amenity, l: Level) {
    if (!p) return;
    const next = { ...p.prefs.amenities };
    if (l === 'any') delete next[a]; else next[a] = l;
    p.prefs.amenities = next;
  }
  const num = (v: string) => (v === '' ? null : Number(v));
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

  function move(i: number, lat: number, lon: number) {
    const d = p?.destinations[i];
    if (d) {
      d.lat = Number(lat.toFixed(6));
      d.lon = Number(lon.toFixed(6));
    }
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
    // Lo que no dice se mueve para que ideal <= maximo siga valiendo al guardar.
    const b = p.budget;
    if (s.budget_ideal !== null) b.ideal_total = s.budget_ideal;
    if (s.budget_max !== null) b.max_total = s.budget_max;
    if (b.ideal_total > b.max_total) {
      if (s.budget_max !== null) b.ideal_total = b.max_total; else b.max_total = b.ideal_total;
    }
    if (s.household_gender) p.household.gender = s.household_gender;
    if (s.owner_must_not_live_in !== null) p.household.no_live_in_owner = s.owner_must_not_live_in;
    if (s.visits) p.household.visits = s.visits;
    // Lo que dices de ti es imprescindible; lo que te gustaria del piso, "mejor si".
    const x = p.prefs;
    if (s.pets) x.pets = s.pets;
    if (s.smokes === true) x.smoking = 'required';
    if (s.smokes === false) x.no_smokers = 'preferred';
    if (s.couple) x.couple = 'required';
    if (s.registration) x.registration = s.registration;
    if (s.move_in) x.move_in = s.move_in;
    if (s.stay_months) x.stay_months = s.stay_months;
    if (s.roommates_max != null) x.roommates_max = s.roommates_max;
    if (s.age_min != null) x.age_min = s.age_min;
    if (s.age_max != null) x.age_max = s.age_max;
    if (s.roommates_occupation) { x.occupation = s.roommates_occupation; x.occupation_level = 'preferred'; }
    if (s.private_bathroom) x.private_bathroom = 'preferred';
    for (const a of s.amenities_wanted ?? []) x.amenities[a] = 'preferred';
    for (const a of s.amenities_required ?? []) x.amenities[a] = 'required';
    const here = (await getCities().catch(() => null))?.active.name ?? '';
    const elsewhere = s.city && s.city.toLowerCase() !== here.toLowerCase() ? s.city : '';
    const notes = elsewhere ? [t('describe.otherCity', { city: elsewhere })] : [];
    for (const pl of s.places) {
      const found = (await geocode(pl.address, elsewhere || undefined).catch(() => []))[0];
      if (!found) {
        // Un aviso y no un error: en Ajustes > Search no se ven los sitios y el
        // error saldria como "nada guardado" sin decir cual.
        notes.push(t('describe.notFound', { address: pl.address }));
        continue;
      }
      p.destinations.push({ name: pl.name, lat: found.lat, lon: found.lon, max_minutes: pl.max_minutes,
                            minute_weight: 1, mode: pl.mode, depart_at: '08:30' });
    }
    notice = notes.join(' ');
  }

  function addPlace() {
    p!.destinations.push({ name: '', lat: center[0], lon: center[1], max_minutes: null,
                           minute_weight: 1, mode: 'transit', depart_at: '08:30' });
    picking = p!.destinations.length - 1;
  }

  let p = $state<SearchProfile | null>(null);
  let profiles = $state<ProfileSummary[]>([]);
  let meta = $state<Meta | null>(null);
  let errors = $state<Record<string, string>>({});
  let saved = $state(false);
  let notice = $state('');
  let names = $state<string[]>([]);
  let center = $state<[number, number]>([41.3874, 2.1686]);
  // Que parte del perfil se edita: Settings la parte en secciones.
  // `needs`: lo de basics que importa al empezar (sin ciudad, perfiles ni portales).
  // `embedded`: dentro de la bienvenida, que guarda con su boton "Next".
  let { part = 'all', embedded = false }: { part?: 'all' | 'basics' | 'places' | 'zones' | 'needs'; embedded?: boolean } = $props();
  const show = (x: 'basics' | 'places' | 'zones') => part === 'all' || part === x || (part === 'needs' && x === 'basics');
  const full = $derived(part !== 'needs');


  async function load() {
    const [perfil, lista, vocab] = await Promise.all([getActiveProfile(), listProfiles(), getMeta()]);
    p = perfil;
    profiles = lista;
    meta = vocab;
    if (show('places')) center = (await getCities().catch(() => null))?.active.center ?? center;
    if (show('zones')) names = (await getNeighbourhoods().catch(() => ({ names: [] }))).names;
  }

  /** Guarda el perfil; false si hay errores (se enseñan junto a cada campo). */
  export async function save(): Promise<boolean> {
    if (!p) return false;
    errors = {};
    try {
      p = await saveProfile($state.snapshot(p));
      saved = true;
      setTimeout(() => (saved = false), 1500);
      return true;
    } catch (e) {
      errors = e instanceof ApiError ? fieldErrors(e.detail) : { '': String(e) };
      return false;
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

  const flat = $derived(p?.listing_type === 'flat');
  const sourceKey = $derived(flat ? 'flat_sources' : 'sources');

  function toggleSource(s: string, on: boolean) {
    if (!p) return;
    const k = sourceKey;
    p[k] = on ? [...p[k], s] : p[k].filter((x) => x !== s);
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
  {#if part === 'all'}<h1>{t('profile.title')}</h1>{/if}
  {#if show('basics')}
  {#if full}<CityPicker onchange={() => load()} />{/if}
  <DescribeProfile bind:text={p.description} onapply={applySuggestion} />
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {/if}

  {#if show('basics') && full}
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
  {/if}

  {#if Object.keys(errors).length}
    <p class="error" role="alert">{t('profile.fixErrors')}{err('') ? ` ${err('')}` : ''}</p>
  {/if}

  {#if show('basics')}
  <fieldset>
    <legend>{t('profile.lookingFor')}</legend>
    {#each ['room', 'flat'] as k}
      <label class="check"><input type="radio" name="listing-type" value={k} bind:group={p.listing_type} />
        {t(`type.${k}Long`)}</label>
    {/each}
  </fieldset>

  {#if full}
  <fieldset>
    <legend>{t('profile.sources')}</legend>
    {#each flat ? meta.flat_sources : meta.sources as s}
      <label class="check"><input type="checkbox" checked={p[sourceKey].includes(s)}
        onchange={(e) => toggleSource(s, (e.currentTarget as HTMLInputElement).checked)} /> {meta.labels?.[s] ?? s}</label>
    {/each}
    {#if flat}<p class="help">{t('profile.flatSourcesHelp')}</p>{/if}
    {#if err(sourceKey)}<p class="error">{err(sourceKey)}</p>{/if}
    {#each under(sourceKey) as m}<p class="error">{m}</p>{/each}
  </fieldset>
  {/if}
  {/if}

  {#if show('basics') && flat}
  <fieldset>
    <legend>{t('profile.flatBudget')}</legend>
    <label>{t('profile.idealRent')}<input type="number" bind:value={p.flat.ideal_rent} /></label>
    <label>{t('profile.maxRent')}<input type="number" bind:value={p.flat.max_rent} /></label>
    <label>{t('profile.assumedBills')}<input type="number" bind:value={p.flat.assumed_bills} /></label>
  </fieldset>
  <fieldset>
    <legend>{t('profile.flatNeeds')}</legend>
    <label>{t('profile.minBedrooms')}<input type="number" min="0" max="10" bind:value={p.flat.min_bedrooms} /></label>
    <label>{t('profile.minSurface')}<input type="number" min="1" value={p.flat.min_surface_m2 ?? ''}
      oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; p!.flat.min_surface_m2 = v === '' ? null : Number(v); }} /></label>
    <label class="check"><input type="checkbox" bind:checked={p.flat.elevator_required} /> {t('profile.elevatorRequired')}</label>
    <label>{t('profile.furnished')}
      <select bind:value={p.flat.furnished}>
        {#each ['any', 'yes', 'no'] as f}<option value={f}>{t(`furnished.${f}`)}</option>{/each}
      </select>
    </label>
    {#each under('flat') as m}<p class="error">{m}</p>{/each}
  </fieldset>
  {/if}

  {#if show('basics') && !flat}
  <fieldset>
    <legend>{t('profile.budget')}</legend>
    <label>{t('profile.idealTotal')}<input type="number" bind:value={p.budget.ideal_total} /></label>
    <label>{t('profile.maxTotal')}<input type="number" bind:value={p.budget.max_total} /></label>
    <label>{t('profile.assumedExpenses')}<input type="number" bind:value={p.budget.assumed_expenses} /></label>
    {#if err('budget')}<p class="error">{err('budget')}</p>{/if}
    {#each under('budget') as m}<p class="error">{m}</p>{/each}
  </fieldset>
  {/if}

  {#if show('basics') && !flat}
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
  {/if}

  {#if show('basics')}
  <fieldset>
    <legend>{t('prefs.you')}</legend>
    <p class="help">{t('prefs.levelsHelp')}</p>
    <LevelSelect label={t('prefs.pets')} bind:value={p.prefs.pets} />
    <LevelSelect label={t('prefs.smoking')} bind:value={p.prefs.smoking} />
    <LevelSelect label={t('prefs.noSmokers')} bind:value={p.prefs.no_smokers} />
    {#if !flat}<LevelSelect label={t('prefs.couple')} bind:value={p.prefs.couple} />{/if}
    <LevelSelect label={t('prefs.registration')} bind:value={p.prefs.registration} />
    {#each under('prefs') as m}<p class="error">{m}</p>{/each}
  </fieldset>

  {#if !flat}
  <fieldset>
    <legend>{t('prefs.roommates')}</legend>
    <div class="row3">
      <label>{t('prefs.roommatesMax')}<input type="number" min="0" max="20" value={p.prefs.roommates_max ?? ''}
        oninput={(e) => (p!.prefs.roommates_max = num((e.currentTarget as HTMLInputElement).value))} /></label>
      <label>{t('prefs.ageMin')}<input type="number" min="16" max="99" value={p.prefs.age_min ?? ''}
        oninput={(e) => (p!.prefs.age_min = num((e.currentTarget as HTMLInputElement).value))} /></label>
      <label>{t('prefs.ageMax')}<input type="number" min="16" max="99" value={p.prefs.age_max ?? ''}
        oninput={(e) => (p!.prefs.age_max = num((e.currentTarget as HTMLInputElement).value))} /></label>
    </div>
    <div class="row2">
      <label>{t('prefs.occupation')}
        <select bind:value={p.prefs.occupation}>
          {#each ['any', 'students', 'workers'] as o}<option value={o}>{t(`occupation.${o}`)}</option>{/each}
        </select>
      </label>
      {#if p.prefs.occupation !== 'any'}<LevelSelect label={t('prefs.howMuch')} bind:value={p.prefs.occupation_level} />{/if}
    </div>
  </fieldset>

  <fieldset>
    <legend>{t('prefs.room')}</legend>
    <label>{t('prefs.roomMinM2')}<input type="number" min="1" value={p.prefs.room_min_m2 ?? ''}
      oninput={(e) => (p!.prefs.room_min_m2 = num((e.currentTarget as HTMLInputElement).value))} /></label>
    <LevelSelect label={t('prefs.privateBathroom')} bind:value={p.prefs.private_bathroom} />
    <LevelSelect label={t('prefs.doubleBed')} bind:value={p.prefs.double_bed} />
    <LevelSelect label={t('prefs.exterior')} bind:value={p.prefs.exterior} />
  </fieldset>
  {/if}

  <details class="more">
    <summary>{t('prefs.more')}</summary>
    <fieldset>
      <legend>{t('prefs.dates')}</legend>
      <div class="row2">
        <label>{t('prefs.moveIn')}<input type="date" value={p.prefs.move_in ?? ''}
          oninput={(e) => (p!.prefs.move_in = (e.currentTarget as HTMLInputElement).value || null)} /></label>
        <label>{t('prefs.stayMonths')}<input type="number" min="1" max="120" value={p.prefs.stay_months ?? ''}
          oninput={(e) => (p!.prefs.stay_months = num((e.currentTarget as HTMLInputElement).value))} /></label>
      </div>
      <LevelSelect label={t('prefs.seasonal')} bind:value={p.prefs.seasonal} />
    </fieldset>
    <fieldset>
      <legend>{t('prefs.money')}</legend>
      <label>{t('prefs.maxDeposit')}<input type="number" min="0" max="12" step="0.5" value={p.prefs.max_deposit_months ?? ''}
        oninput={(e) => (p!.prefs.max_deposit_months = num((e.currentTarget as HTMLInputElement).value))} /></label>
      <LevelSelect label={t('prefs.agencyFee')} bind:value={p.prefs.agency_fee} />
      {#if flat}<LevelSelect label={t('prefs.exterior')} bind:value={p.prefs.exterior} />{/if}
    </fieldset>
    <fieldset>
      <legend>{t('prefs.extras')}</legend>
      {#each AMENITIES as a}
        <LevelSelect label={t(`amenity.${a}`)} bind:value={() => p!.prefs.amenities[a] ?? 'any', (v) => setAmenity(a, v)} />
      {/each}
    </fieldset>
  </details>
  {/if}

  {#if show('places')}
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
    <MapView label={t('profile.destinationsMap')} places={p.destinations} onpick={pick} onmove={move} height="300px" {center} />
    {#if err('destinations')}<p class="error">{err('destinations')}</p>{/if}
  </fieldset>
  {/if}

  {#if show('zones')}
  <fieldset>
    <legend>{t('profile.zones')}</legend>
    {#each under('zones') as m}<p class="error">{m}</p>{/each}
    <p class="help">{t('profile.zonesHelp')}</p>
    <NeighbourhoodPicker label={t('profile.zonesPrefer')} options={names} selected={p.zones.prefer}
      onchange={(v) => (p!.zones.prefer = v)} />
    <NeighbourhoodPicker label={t('profile.zonesPenalize')} options={names} selected={p.zones.penalize}
      onchange={(v) => (p!.zones.penalize = v)} />
    <NeighbourhoodPicker label={t('profile.zonesExclude')} options={names} selected={p.zones.exclude}
      onchange={(v) => (p!.zones.exclude = v)} />
  </fieldset>
  {/if}

  {#if show('basics')}
  <fieldset>
    <legend>{t('profile.crawl')}</legend>
    {#each under('crawl') as m}<p class="error">{m}</p>{/each}
    <label>{t('profile.maxPages')}<input type="number" min="1" max="20" bind:value={p.crawl.max_pages} /></label>
    <label>{t('profile.realTravelTimes')}<input type="number" min="0" max="200" bind:value={p.crawl.real_travel_times} /></label>
    <label>{t('profile.detailsToRead')}<input type="number" min="0" bind:value={p.crawl.details_to_read} /></label>
  </fieldset>
  {/if}

  {#if show('basics')}
  <details>
    <summary>{t('profile.weights')}</summary>
    {#each under('weights') as m}<p class="error">{m}</p>{/each}
    <div class="weights">
      {#each Object.keys(p.weights) as k}
        <label>{k}<input type="number" step="any" bind:value={p.weights[k]} /></label>
      {/each}
    </div>
  </details>
  {/if}

  {#if !embedded}
  <div class="save">
    <button class="primary" onclick={save}>{t('profile.save')}</button>
    {#if saved}<span class="ok">{t('profile.saved')}</span>{/if}
  </div>
  {/if}

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
  label :is(input:not([type='checkbox']):not([type='radio']), select) { width: 100%; min-width: 0; }
  label.check { display: flex; gap: 8px; align-items: center; }
  .dest { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px;
    align-items: end; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
  .weights { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-top: 8px; }
  .help { color: var(--muted); font-size: 13px; margin: 0; }
  .error { color: var(--bad); margin: 0; font-size: 13px; }
  .save { position: sticky; bottom: 0; background: var(--paper); padding: 12px 0; display: flex; gap: 12px; align-items: center;
    border-top: 3px double var(--ink); z-index: 1; }
  .ok { color: var(--ok); }
  .row2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; align-items: end; }
  .row3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; align-items: end; }
  .more { margin: 0 0 16px; }
  .more > summary { cursor: pointer; font-family: var(--display); font-stretch: 80%; font-weight: 700; font-size: 17px;
    padding: 6px 0; }
  .more[open] > summary { margin-bottom: 10px; }
  .notice { border-left: 4px solid var(--gold); background: var(--box); padding: 6px 12px; margin: -8px 0 16px; font-size: 14px; }
</style>
