<script lang="ts">
  import { ApiError, getAI, listModels, saveAI, testAI, type AISettings } from '../api';
  import { t } from '../i18n';

  type Preset = { id: string; label: string; help: string; provider: AISettings['provider'];
                  base_url: string; needsKey: boolean };
  const PRESETS: Preset[] = [
    { id: 'none', label: 'ai.none', help: '', provider: 'none', base_url: '', needsKey: false },
    { id: 'claude', label: 'ai.claude', help: 'ai.claudeHelp', provider: 'anthropic', base_url: '', needsKey: true },
    { id: 'gemini', label: 'ai.gemini', help: 'ai.geminiHelp', provider: 'openai_compat',
      base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/', needsKey: true },
    { id: 'openai', label: 'ai.openai', help: 'ai.openaiHelp', provider: 'openai_compat',
      base_url: 'https://api.openai.com/v1', needsKey: true },
    { id: 'openrouter', label: 'ai.openrouter', help: 'ai.openrouterHelp', provider: 'openai_compat',
      base_url: 'https://openrouter.ai/api/v1', needsKey: true },
    { id: 'ollama', label: 'ai.ollama', help: 'ai.ollamaHelp', provider: 'openai_compat',
      base_url: 'http://localhost:11434/v1', needsKey: false },
  ];
  // Precios por millon de tokens (entrada / salida), de la referencia de la API de Claude.
  const CLAUDE_MODELS = [
    { id: 'claude-opus-5-5', label: 'Opus 5.5, $4 / $20 per million tokens' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5, $2 / $10 per million tokens' },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5, $0.10 / $0.50 per million tokens' },
  ];

  let s = $state<AISettings | null>(null);
  let preset = $state('none');
  let key = $state('');
  let saved = $state(false);
  let error = $state('');
  let tested = $state('');
  let models = $state<string[]>([]);
  let manual = $state(false);
  let loading = $state(false);

  async function loadModels() {
    if (!s) return;
    loading = true; error = ''; manual = false;
    try {
      models = (await listModels(s.base_url, key.trim() || undefined)).models;
      if (models.length && !models.includes(s.model)) s.model = models[0];
      // Se guarda ya: elegir el modelo no debe depender de pulsar Save despues.
      if (models.length) await save();
    } catch (e) {
      models = [];
      manual = true;
      error = e instanceof ApiError ? String(e.detail) : String(e);
    } finally { loading = false; }
  }

  const current = $derived(PRESETS.find((p) => p.id === preset)!);

  function presetFor(a: AISettings): string {
    if (a.provider === 'anthropic') return 'claude';
    if (a.provider === 'openai_compat')
      return PRESETS.find((p) => p.base_url && p.base_url === a.base_url)?.id ?? 'openai';
    return 'none';
  }

  function choose(id: string) {
    preset = id;
    const p = PRESETS.find((x) => x.id === id)!;
    if (!s) return;
    s.provider = p.provider;
    s.base_url = p.base_url;
    if (p.id === 'claude' && !s.model.startsWith('claude-')) s.model = 'claude-opus-5-5';
    if (p.id !== 'claude' && s.model.startsWith('claude-')) s.model = '';
    models = []; manual = false; error = '';
    if (p.id === 'ollama') loadModels();
  }

  async function load() {
    try { s = await getAI(); preset = presetFor(s); } catch (e) { error = String(e); }
  }

  async function save() {
    if (!s) return;
    error = '';
    const body: Partial<AISettings> & { key?: string } = {
      provider: s.provider, model: s.model, base_url: s.base_url, about_me: s.about_me };
    if (key.trim()) body.key = key.trim();
    try {
      s = await saveAI(body);
      key = '';
      saved = true;
      setTimeout(() => (saved = false), 1500);
    } catch (e) {
      error = e instanceof ApiError ? String(e.detail) : String(e);
    }
  }

  async function test() {
    tested = '';
    await save();             // se prueba lo que hay en pantalla, no lo guardado antes
    if (error) return;
    try { tested = (await testAI()).message; } catch (e) {
      error = e instanceof ApiError ? String(e.detail) : String(e);
    }
  }

  $effect(() => { load(); });
</script>

{#if s}
  <fieldset>
    <legend>{t('ai.title')}</legend>
    <p class="help">{t('ai.help')}</p>
    <div class="presets">
      {#each PRESETS as p}
        <label class="choice">
          <input type="radio" name="ai-preset" checked={preset === p.id} onchange={() => choose(p.id)} />
          {t(p.label)}
        </label>
      {/each}
    </div>

    {#if preset !== 'none'}
      <p class="help">{t(current.help)}</p>
      {#if preset === 'claude'}
        <label>{t('ai.model')}
          <select bind:value={s.model}>
            {#each CLAUDE_MODELS as m}<option value={m.id}>{m.label}</option>{/each}
          </select>
        </label>
      {:else}
        {#if current.needsKey}
          <label>{t('ai.key')}<input type="password" autocomplete="off" bind:value={key} /></label>
          {#if s.has_key}<p class="help">{t('ai.keySaved')}</p>{/if}
          <p class="help">{t('ai.keyLocal')}</p>
        {/if}
        <div class="models">
          {#if models.length}
            <label>{t('ai.model')}
              <select bind:value={s.model}>{#each models as m}<option value={m}>{m}</option>{/each}</select>
            </label>
          {:else if s.model && !manual}
            <p class="help">{t('ai.current', { model: s.model })}</p>
          {/if}
          <button onclick={loadModels} disabled={loading}>{t('ai.loadModels')}</button>
        </div>
        {#if manual}
          <label>{t('ai.modelName')}<input bind:value={s.model} /></label>
          <p class="help">{t('ai.modelHelp')}</p>
        {/if}
      {/if}
      {#if preset === 'claude'}
        <label>{t('ai.key')}<input type="password" autocomplete="off" bind:value={key} /></label>
        {#if s.has_key}<p class="help">{t('ai.keySaved')}</p>{/if}
        <p class="help">{t('ai.keyLocal')}</p>
      {/if}
      <label>{t('ai.aboutMe')}<textarea rows="2" bind:value={s.about_me}></textarea></label>
      <p class="help">{t('ai.aboutMeHelp')}</p>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button class="primary" onclick={save}>{t('ai.save')}</button>
      {#if saved}<span class="ok">{t('ai.saved')}</span>{/if}
      {#if preset !== 'none'}<button onclick={test}>{t('ai.test')}</button>{/if}
      {#if tested}<span class="ok">{tested}</span>{/if}
    </div>
  </fieldset>
{/if}

<style>
  fieldset { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface);
    margin: 24px 0 16px; padding: 12px 16px; display: grid; gap: 10px; }
  legend { font-weight: 600; padding: 0 4px; }
  label { display: grid; gap: 4px; font-size: 14px; }
  label :is(input:not([type='radio']), select, textarea) { width: 100%; min-width: 0; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .choice { display: flex; gap: 6px; align-items: center; }
  .help { color: var(--muted); font-size: 13px; margin: 0; }
  .models { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
  .models label { flex: 1 1 220px; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .error { color: var(--bad); margin: 0; font-size: 13px; }
  .ok { color: var(--ok); }
</style>
