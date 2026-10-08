<script lang="ts">
  import { ApiError, getSettings, saveSettings, testRoute,
           type RouteTest, type TravelSettings } from '../api';
  import { t } from '../i18n';

  let s = $state<TravelSettings | null>(null);
  let googleKey = $state('');
  let saved = $state(false);
  let error = $state('');
  let test = $state<RouteTest | null>(null);
  let testing = $state(false);

  const PROVIDERS = ['graph', 'transitous', 'google'] as const;

  async function load() {
    try { s = await getSettings(); } catch (e) { error = String(e); }
  }

  async function save() {
    if (!s) return;
    error = '';
    const body: Partial<TravelSettings> & { google_key?: string } = {
      travel_provider: s.travel_provider,
    };
    if (s.travel_provider === 'transitous') body.transitous_contact = s.transitous_contact;
    if (googleKey.trim()) body.google_key = googleKey.trim();
    try {
      s = await saveSettings(body);
      googleKey = '';
      saved = true;
      setTimeout(() => (saved = false), 1500);
    } catch (e) {
      error = e instanceof ApiError ? String(e.detail) : String(e);
    }
  }

  async function runTest() {
    testing = true;
    error = '';
    try { test = await testRoute(); } catch (e) { error = String(e); } finally { testing = false; }
  }

  $effect(() => { load(); });
</script>

{#if s}
  <fieldset>
    <legend>{t('travel.title')}</legend>
    {#each PROVIDERS as prov}
      <label class="choice">
        <input type="radio" name="provider" value={prov} bind:group={s.travel_provider} />
        <span><strong>{t(`travel.${prov}`)}</strong><small>{t(`travel.${prov}Help`)}</small></span>
      </label>
    {/each}

    {#if s.travel_provider === 'transitous'}
      <p class="help">{t('travel.transitousTerms')}</p>
      <label>{t('travel.contact')}<input bind:value={s.transitous_contact} /></label>
    {:else if s.travel_provider === 'google'}
      <p class="help">{t('travel.googleHelp')}</p>
      <label>{t('travel.googleKey')}<input type="password" autocomplete="off" bind:value={googleKey} /></label>
      {#if s.has_google_key}<p class="help">{t('travel.keySaved')}</p>{/if}
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="actions">
      <button class="primary" onclick={save}>{t('travel.save')}</button>
      {#if saved}<span class="ok">{t('travel.saved')}</span>{/if}
      <button onclick={runTest} disabled={testing}>{t('travel.test')}</button>
    </div>

    {#if test}
      <div class="test">
        <p class="help">{t('travel.testRoute')}</p>
        {#if test.graph}<p>{t('travel.testGraph', { minutes: Math.round(test.graph.minutes) })}</p>{/if}
        {#if test.provider}
          <p>{t('travel.testProvider', { name: test.provider.name, minutes: Math.round(test.provider.minutes) })}</p>
        {/if}
        {#if test.error}<p class="error">{test.error}</p>{/if}
      </div>
    {/if}
  </fieldset>
{/if}

<style>
  fieldset { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface);
    margin: 24px 0 16px; padding: 12px 16px; display: grid; gap: 10px; }
  legend { font-weight: 600; padding: 0 4px; }
  label { display: grid; gap: 4px; font-size: 14px; }
  label input:not([type='radio']) { width: 100%; min-width: 0; }
  .choice { display: flex; gap: 10px; align-items: flex-start; }
  .choice input { margin-top: 4px; }
  .choice small { display: block; color: var(--muted); }
  .help { color: var(--muted); font-size: 13px; margin: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .test p { margin: 2px 0; }
  .error { color: var(--bad); margin: 0; font-size: 13px; }
  .ok { color: var(--ok); }
</style>
