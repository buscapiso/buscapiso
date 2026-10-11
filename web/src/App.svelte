<script lang="ts">
  import { router } from './lib/router.svelte';
  import { getCities } from './lib/api';
  import Nav from './lib/components/Nav.svelte';
  import { LOCALES, locale, setLocale, t, type Locale } from './lib/i18n';
  import ExtensionGuide from './routes/ExtensionGuide.svelte';
  import ListingDetail from './routes/ListingDetail.svelte';
  import Rooms from './routes/Rooms.svelte';
  import Settings from './routes/Settings.svelte';
  import Welcome from './routes/Welcome.svelte';

  // Las "orejas" de la cabecera, como en un diario: la fecha y la edicion.
  const today = new Date().toLocaleDateString(locale() === 'en' ? 'en-GB' : locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  let city = $state('');
  $effect(() => {
    void router.route;
    getCities().then((c) => { city = c.active.name; }).catch(() => {});
  });
</script>

<header class="masthead">
  <p class="ear">{today}</p>
  <a class="brand" href="#/">{t('app.name')}</a>
  <p class="ear right">{city ? t('masthead.edition', { city }) : ''}</p>
</header>
<Nav route={router.route} />

<main class:wide={router.route.name === 'rooms'}>
  {#if router.route.name === 'listing'}
    <ListingDetail id={router.route.id} />
  {:else if router.route.name === 'settings'}
    <Settings section={router.route.section} />
  {:else if router.route.name === 'extension'}
    <ExtensionGuide />
  {:else if router.route.name === 'welcome'}
    <Welcome />
  {:else}
    <Rooms filter={router.route.filter} view={router.route.view} />
  {/if}
</main>

<footer>
  <p class="motto">{t('footer.privacy')}</p>
  <p>
    <a href="#/extension">{t('footer.extension')}</a> ·
    <a href="https://github.com/buscapiso/buscapiso" target="_blank" rel="noopener">{t('footer.source')}</a> ·
    <a href="https://github.com/buscapiso/buscapiso/issues" target="_blank" rel="noopener">{t('footer.contact')}</a> ·
    {t('footer.travel')} <a href="https://transitous.org/sources/" target="_blank" rel="noopener">Transitous</a> ·
    {t('footer.maps')} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
  </p>
  <p class="langs">
    {#each Object.entries(LOCALES) as [code, name]}
      {#if code === locale()}<strong lang={code}>{name}</strong>{:else}<button class="lang" lang={code}
        onclick={() => setLocale(code as Locale)}>{name}</button>{/if}
    {/each}
  </p>
</footer>

<style>
  .masthead {
    max-width: 1440px; margin: 0 auto; padding: 18px 20px 8px;
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 16px;
  }
  .brand {
    font-family: var(--masthead); font-style: italic; font-weight: 400; color: var(--ink); text-decoration: none;
    font-size: clamp(44px, 7vw, 76px); line-height: .9; letter-spacing: -0.015em;
  }
  .ear {
    margin: 0 0 6px; font-family: var(--serif); font-style: italic; font-size: 15px; color: var(--muted);
    line-height: 1.3;
  }
  .ear.right { text-align: right; }
  main { max-width: 960px; margin: 0 auto; padding: 18px 20px; }
  main.wide { max-width: 1440px; }
  footer { max-width: 1440px; margin: 32px auto 0; padding: 10px 20px 28px; border-top: 3px double var(--ink);
    font-size: 13px; color: var(--muted); }
  footer p { margin: 4px 0; }
  .motto { font-family: var(--serif); font-style: italic; font-size: 16px; color: var(--ink); }
  @media (max-width: 640px) {
    .masthead { grid-template-columns: 1fr; justify-items: center; text-align: center; gap: 0; padding: 12px 16px 8px;
      border-bottom: 3px double var(--ink); }
    .brand { padding-bottom: 6px; }
    .ear { margin: 0; font-size: 13px; }
    .ear:first-child { order: 2; }
    .ear.right { order: 3; text-align: center; }
    main { padding: 14px 16px; }
    footer { padding-inline: 16px; padding-bottom: 96px; }
  }
  .langs { display: flex; gap: 12px; align-items: center; }
  .lang { border: 0; background: none; padding: 0; min-height: 0; text-decoration: underline; color: inherit; font: inherit; }
</style>
