<script lang="ts">
  import { ApiError, getNotify, getSchedule, saveNotify, saveSchedule, testNotify,
           type NotifySettings, type Schedule } from '../api';
  import { t } from '../i18n';

  let { part = 'all' }: { part?: 'all' | 'schedule' | 'notify' } = $props();
  let sched = $state<Schedule | null>(null);
  let note = $state<NotifySettings | null>(null);
  let saved = $state(false);
  let sent = $state(false);
  let error = $state('');

  const HOURS = [0, 2, 3, 4, 6, 8, 12, 24];

  async function load() {
    try { [sched, note] = [await getSchedule(), await getNotify()]; } catch (e) { error = String(e); }
  }

  const fail = (e: unknown) => { error = e instanceof ApiError ? String(e.detail) : String(e); };

  async function saveAuto() {
    if (!sched) return;
    try {
      sched = await saveSchedule({ hours: Number(sched.hours), from: sched.from, to: sched.to });
      saved = true;
      setTimeout(() => (saved = false), 1500);
    } catch (e) { fail(e); }
  }

  async function toggle(on: boolean) {
    try { note = await saveNotify({ enabled: on }); } catch (e) { fail(e); }
  }

  async function saveScore() {
    if (!note) return;
    try { note = await saveNotify({ min_score: Number(note.min_score) }); } catch (e) { fail(e); }
  }

  async function test() {
    sent = false;
    try { await testNotify(); sent = true; } catch (e) { fail(e); }
  }

  $effect(() => { load(); });
</script>

{#if sched && note}
  {#if part !== 'notify'}
  <fieldset>
    <legend>{t('auto.title')}</legend>
    <p class="help">{t('auto.help')}</p>
    <label>{t('auto.every')}
      <select bind:value={sched.hours}>
        {#each HOURS as h}<option value={h}>{h ? t('auto.hours', { hours: h }) : t('auto.off')}</option>{/each}
      </select>
    </label>
    <div class="row">
      <label>{t('auto.from')}<input type="time" bind:value={sched.from} /></label>
      <label>{t('auto.to')}<input type="time" bind:value={sched.to} /></label>
    </div>
    {#if sched.last_run}<p class="help">{t('auto.lastRun', { when: sched.last_run.replace('T', ' ') })}</p>{/if}
    <div class="actions">
      <button class="primary" onclick={saveAuto}>{t('auto.save')}</button>
      {#if saved}<span class="ok">{t('auto.saved')}</span>{/if}
    </div>
  </fieldset>
  {/if}

  {#if part !== 'schedule'}
  <fieldset>
    <legend>{t('notify.title')}</legend>
    <label class="check"><input type="checkbox" checked={Boolean(note.topic)}
      onchange={(e) => toggle((e.currentTarget as HTMLInputElement).checked)} /> {t('notify.enable')}</label>
    {#if note.topic}
      <p class="help">{t('notify.help')}</p>
      <p class="topic"><code>{note.topic}</code>
        <button onclick={() => navigator.clipboard.writeText(note!.topic)}>{t('notify.copy')}</button></p>
      <p class="help">{t('notify.private')}</p>
      <label>{t('notify.minScore')}<input type="number" bind:value={note.min_score} onchange={saveScore} /></label>
      <div class="actions">
        <button onclick={test}>{t('notify.test')}</button>
        {#if sent}<span class="ok">{t('notify.sent')}</span>{/if}
      </div>
    {/if}
  </fieldset>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  fieldset { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface);
    margin: 24px 0 16px; padding: 12px 16px; display: grid; gap: 10px; }
  legend { font-weight: 600; padding: 0 4px; }
  label { display: grid; gap: 4px; font-size: 14px; }
  label :is(input:not([type='checkbox']), select) { width: 100%; min-width: 0; }
  .check { display: flex; gap: 8px; align-items: center; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .topic { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0; }
  code { font-size: 15px; font-weight: 700; }
  .help { color: var(--muted); font-size: 13px; margin: 0; }
  .actions { display: flex; gap: 10px; align-items: center; }
  .error { color: var(--bad); }
  .ok { color: var(--ok); }
</style>
