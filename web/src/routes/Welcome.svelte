<script lang="ts">
  import { finishWelcome } from '../lib/api';
  import AISettings from '../lib/components/AISettings.svelte';
  import CityPicker from '../lib/components/CityPicker.svelte';
  import { t } from '../lib/i18n';
  import { href } from '../lib/router.svelte';
  import ExtensionGuide from './ExtensionGuide.svelte';
  import Profile from './Profile.svelte';

  // Los pasos de siempre, en orden: la extension primero porque preparar una
  // ciudad que no sea Barcelona la necesita.
  const STEPS = ['extension', 'city', 'ai', 'needs', 'places'] as const;
  let step = $state(0);
  let profile = $state<{ save: () => Promise<boolean> } | undefined>();
  let busy = $state(false);
  const name = $derived(STEPS[step]);
  const last = $derived(step === STEPS.length - 1);

  async function next() {
    busy = true;
    try {
      // Los pasos del perfil guardan al avanzar; con un error, se queda y lo enseña.
      if ((name === 'needs' || name === 'places') && profile && !(await profile.save())) return;
      if (last) await done(href({ name: 'rooms', filter: 'new', view: 'list' }));
      else { step++; window.scrollTo(0, 0); }
    } finally {
      busy = false;
    }
  }
  async function done(to: string) {
    await finishWelcome().catch(() => {});
    location.hash = to;
  }
</script>

<article class="welcome">
  <h1>{t('wizard.title')}</h1>
  {#if step === 0}<p class="intro">{t('wizard.intro')}</p>{/if}

  <ol class="steps" aria-label={t('wizard.progress')}>
    {#each STEPS as s, i}
      <li class:done={i < step} aria-current={i === step ? 'step' : undefined}>
        <button disabled={i > step} onclick={() => { step = i; }}>{t(`wizard.${s}`)}</button></li>
    {/each}
  </ol>

  <section>
    <h2>{t('wizard.stepOf', { n: step + 1, total: STEPS.length })}: {t(`wizard.${name}`)}</h2>
    {#if name !== 'extension'}<p class="help">{t(`wizard.${name}Help`)}</p>{/if}
    {#key step}
      {#if name === 'extension'}
        <ExtensionGuide />
      {:else if name === 'city'}
        <CityPicker onchange={() => {}} />
      {:else if name === 'ai'}
        <AISettings />
      {:else if name === 'needs'}
        <Profile part="needs" embedded bind:this={profile} />
      {:else}
        <Profile part="places" embedded bind:this={profile} />
      {/if}
    {/key}
  </section>

  <div class="nav">
    {#if step > 0}<button onclick={() => { step--; }}>{t('wizard.back')}</button>{/if}
    <button class="primary" disabled={busy} onclick={next}>{last ? t('wizard.finish') : t('wizard.next')}</button>
    <button class="link" onclick={() => done(href({ name: 'settings', section: 'search' }))}>{t('wizard.skip')}</button>
  </div>
</article>

<style>
  .welcome { max-width: 760px; }
  .intro { font-family: var(--serif); font-size: 18px; }
  .steps { list-style: none; padding: 0; margin: 12px 0 18px; display: flex; flex-wrap: wrap; gap: 6px; counter-reset: s; }
  .steps li { counter-increment: s; }
  .steps button { font-size: 13px; padding: 4px 10px; }
  .steps button::before { content: counter(s) ". "; font-weight: 700; color: var(--gold-ink); }
  .steps li[aria-current] button { background: var(--ink); color: var(--paper); }
  .steps li.done button { border-color: var(--ok); }
  .help { color: var(--muted); margin: 0 0 12px; }
  .nav { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 22px 0 8px; position: sticky; bottom: 0;
    background: var(--paper); padding: 10px 0; border-top: 1px solid var(--line); }
  .link { border: 0; background: none; text-decoration: underline; color: var(--muted); padding: 0; margin-left: auto; }
</style>
