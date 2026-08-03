export const VOICE_PROFILE_BUTTON_ID = 'mestre-orc-voice-profiles';
export const VOICE_PROFILE_PANEL_ID = 'mestre-orc-voice-profile-panel';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function campaignId() {
  return String(game.world?.id ?? 'default');
}

function npcActors() {
  return Array.from(game.actors ?? [])
    .filter((actor) => String(actor?.type ?? '').toLowerCase() === 'npc')
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'pt-BR'));
}

function actorOptions(selected = '') {
  const options = ['<option value="">Narrador da campanha</option>'];
  for (const actor of npcActors()) {
    options.push(`<option value="${escapeHtml(actor.id)}" data-name="${escapeHtml(actor.name)}" ${actor.id === selected ? 'selected' : ''}>${escapeHtml(actor.name)}</option>`);
  }
  return options.join('');
}

function providerLabel(provider) {
  return ({ browser: 'Navegador', openai: 'OpenAI', elevenlabs: 'ElevenLabs', compatible: 'OpenAI-compatible' })[provider] ?? provider;
}

function profileCard(profile) {
  const neural = profile.provider !== 'browser';
  return `<article class="mestre-orc-voice-profile" data-profile-id="${escapeHtml(profile.id)}">
    <header>
      <div><strong>${escapeHtml(profile.npcName || 'Narrador')}</strong><span>${escapeHtml(profile.speakerType === 'NPC' ? 'NPC' : 'Narrador')}</span></div>
      <span class="mestre-orc-voice-provider">${escapeHtml(providerLabel(profile.provider))}</span>
    </header>
    <dl>
      <div><dt>Voz</dt><dd>${escapeHtml(profile.voiceId || 'automática/local')}</dd></div>
      <div><dt>Modelo</dt><dd>${escapeHtml(profile.model || 'padrão do provedor')}</dd></div>
      <div><dt>Idioma</dt><dd>${escapeHtml(profile.language || 'pt-BR')}</dd></div>
      <div><dt>Velocidade</dt><dd>${Number(profile.speed || 1).toFixed(2)}×</dd></div>
      <div><dt>Estado</dt><dd>${profile.enabled ? 'Ativo' : 'Desativado'}</dd></div>
      <div><dt>Fallback</dt><dd>${profile.fallbackToBrowser ? 'Voz local' : 'Desativado'}</dd></div>
    </dl>
    ${profile.instructions ? `<p>${escapeHtml(profile.instructions)}</p>` : ''}
    ${neural ? '<small>Voz gerada por inteligência artificial.</small>' : ''}
    <footer>
      <button type="button" data-voice-edit="${escapeHtml(profile.id)}"><i class="fa-solid fa-pen"></i> Editar</button>
      <button type="button" data-voice-preview="${escapeHtml(profile.id)}"><i class="fa-solid fa-play"></i> Testar</button>
      <button type="button" data-voice-delete="${escapeHtml(profile.id)}"><i class="fa-solid fa-trash"></i> Remover</button>
    </footer>
  </article>`;
}

function panelHtml(snapshot, providerStatus) {
  const profiles = Array.isArray(snapshot?.profiles) ? snapshot.profiles : [];
  const configuredProviders = (providerStatus?.providers ?? []).filter((entry) => entry.configured).map((entry) => entry.id);
  return `<div id="${VOICE_PROFILE_PANEL_ID}" class="mestre-orc-voice-overlay" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-voice-title">
    <section class="mestre-orc-voice-panel">
      <header class="mestre-orc-voice-header">
        <div><span>Direção de voz</span><h2 id="mestre-orc-voice-title">Vozes do narrador e dos NPCs</h2><p>Configure vozes já disponíveis nos provedores. O módulo não cria nem clona vozes.</p></div>
        <button type="button" data-voice-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="mestre-orc-voice-summary">
        <article><strong>${profiles.length}</strong><span>Perfis</span></article>
        <article><strong>${configuredProviders.length}</strong><span>Provedores neurais</span></article>
        <article><strong>${snapshot?.narratorConfigured ? 'Sim' : 'Não'}</strong><span>Narrador configurado</span></article>
      </div>
      <p class="mestre-orc-voice-disclosure"><i class="fa-solid fa-circle-info"></i> Áudios neurais devem ser apresentados aos jogadores como vozes geradas por IA. As chaves ficam somente na API.</p>
      <form class="mestre-orc-voice-form">
        <input type="hidden" name="profileId" value="">
        <label><span>Falante</span><select name="npcId">${actorOptions()}</select></label>
        <label><span>Provedor</span><select name="provider">
          <option value="browser">Voz local do navegador</option>
          <option value="openai">OpenAI</option>
          <option value="elevenlabs">ElevenLabs</option>
          <option value="compatible">OpenAI-compatible/local</option>
        </select></label>
        <label><span>Voice ID ou nome</span><input name="voiceId" maxlength="300" placeholder="Ex.: marin ou ID fornecido pelo provedor"></label>
        <label><span>Modelo</span><input name="model" maxlength="300" placeholder="Vazio usa o padrão da API"></label>
        <label><span>Idioma</span><input name="language" value="pt-BR" maxlength="30"></label>
        <label><span>Velocidade</span><input name="speed" type="number" min="0.25" max="4" step="0.05" value="1"></label>
        <label><span>Estabilidade</span><input name="stability" type="number" min="0" max="1" step="0.05" value="0.5"></label>
        <label><span>Similaridade</span><input name="similarityBoost" type="number" min="0" max="1" step="0.05" value="0.75"></label>
        <label><span>Expressividade</span><input name="style" type="number" min="0" max="1" step="0.05" value="0"></label>
        <label class="mestre-orc-voice-wide"><span>Direção vocal</span><textarea name="instructions" rows="3" maxlength="2000" placeholder="Ex.: voz grave, ritmo contido, tensão crescente, sem exagero teatral."></textarea></label>
        <label class="mestre-orc-voice-check"><input name="enabled" type="checkbox" checked><span>Perfil ativo</span></label>
        <label class="mestre-orc-voice-check"><input name="fallbackToBrowser" type="checkbox" checked><span>Usar voz local se o provedor falhar</span></label>
        <label class="mestre-orc-voice-check"><input name="useSpeakerBoost" type="checkbox" checked><span>Reforço de similaridade (quando suportado)</span></label>
        <button type="submit"><i class="fa-solid fa-floppy-disk"></i> Salvar perfil</button>
        <button type="button" data-voice-action="clear"><i class="fa-solid fa-eraser"></i> Limpar formulário</button>
      </form>
      <section class="mestre-orc-voice-list">${profiles.length ? profiles.map(profileCard).join('') : '<p class="mestre-orc-voice-empty">Nenhum perfil cadastrado. Sem perfil neural, a narração continua usando a voz local.</p>'}</section>
    </section>
  </div>`;
}

function formValue(form, name) {
  return form.elements.namedItem(name);
}

function resetForm(form) {
  form.reset();
  formValue(form, 'profileId').value = '';
  formValue(form, 'language').value = 'pt-BR';
  formValue(form, 'speed').value = '1';
  formValue(form, 'stability').value = '0.5';
  formValue(form, 'similarityBoost').value = '0.75';
  formValue(form, 'style').value = '0';
  formValue(form, 'enabled').checked = true;
  formValue(form, 'fallbackToBrowser').checked = true;
  formValue(form, 'useSpeakerBoost').checked = true;
}

function fillForm(form, profile) {
  formValue(form, 'profileId').value = profile.id ?? '';
  formValue(form, 'npcId').value = profile.npcId ?? '';
  formValue(form, 'provider').value = profile.provider ?? 'browser';
  formValue(form, 'voiceId').value = profile.voiceId ?? '';
  formValue(form, 'model').value = profile.model ?? '';
  formValue(form, 'language').value = profile.language ?? 'pt-BR';
  formValue(form, 'speed').value = String(profile.speed ?? 1);
  formValue(form, 'stability').value = String(profile.stability ?? 0.5);
  formValue(form, 'similarityBoost').value = String(profile.similarityBoost ?? 0.75);
  formValue(form, 'style').value = String(profile.style ?? 0);
  formValue(form, 'instructions').value = profile.instructions ?? '';
  formValue(form, 'enabled').checked = profile.enabled !== false;
  formValue(form, 'fallbackToBrowser').checked = profile.fallbackToBrowser !== false;
  formValue(form, 'useSpeakerBoost').checked = profile.useSpeakerBoost !== false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function playBase64Audio(result) {
  const bytes = Uint8Array.from(atob(result.audioBase64), (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: result.mimeType || 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.onerror = () => URL.revokeObjectURL(url);
  return audio.play();
}

function speakBrowserPreview(text, profile) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('SpeechSynthesis indisponível neste navegador.');
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = profile.language || 'pt-BR';
  utterance.rate = Math.min(2, Math.max(0.5, Number(profile.speed) || 1));
  const configured = String(profile.voiceId || '').toLowerCase();
  const voices = window.speechSynthesis.getVoices?.() ?? [];
  utterance.voice = voices.find((voice) => String(voice.name).toLowerCase() === configured)
    ?? voices.find((voice) => String(voice.lang).toLowerCase().startsWith('pt'))
    ?? null;
  window.speechSynthesis.speak(utterance);
}

export function closeVoiceProfilePanel() {
  document.getElementById(VOICE_PROFILE_PANEL_ID)?.remove();
}

async function reload({ request }) {
  return openVoiceProfilePanel({ request });
}

function bindPanel(panel, snapshot, request) {
  const form = panel.querySelector('.mestre-orc-voice-form');
  const profiles = new Map((snapshot?.profiles ?? []).map((entry) => [entry.id, entry]));

  panel.addEventListener('click', async (event) => {
    const actionButton = event.target instanceof Element ? event.target.closest('[data-voice-action]') : null;
    if (actionButton?.dataset.voiceAction === 'close') return closeVoiceProfilePanel();
    if (actionButton?.dataset.voiceAction === 'clear') return resetForm(form);

    const edit = event.target instanceof Element ? event.target.closest('[data-voice-edit]') : null;
    if (edit) return fillForm(form, profiles.get(edit.dataset.voiceEdit));

    const remove = event.target instanceof Element ? event.target.closest('[data-voice-delete]') : null;
    if (remove) {
      remove.disabled = true;
      try {
        await request(`/v1/voice-profiles/${encodeURIComponent(campaignId())}/${encodeURIComponent(remove.dataset.voiceDelete)}`, { method: 'DELETE' });
        ui.notifications?.info?.('Mestre Orc: perfil de voz removido.');
        return reload({ request });
      } catch (error) {
        remove.disabled = false;
        return ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
      }
    }

    const preview = event.target instanceof Element ? event.target.closest('[data-voice-preview]') : null;
    if (preview) {
      const profile = profiles.get(preview.dataset.voicePreview);
      if (!profile) return;
      preview.disabled = true;
      try {
        const sample = `Esta é a voz de ${profile.npcName || 'narrador'} no Mestre Orc.`;
        if (profile.provider === 'browser') speakBrowserPreview(sample, profile);
        else {
          const result = await request('/v1/audio/synthesize', {
            method: 'POST',
            body: JSON.stringify({ text: sample, campaignId: campaignId(), profileId: profile.id, speakerType: profile.speakerType, npcId: profile.npcId, npcName: profile.npcName })
          });
          await playBase64Audio(result);
        }
      } catch (error) {
        ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
      } finally {
        preview.disabled = false;
      }
    }
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    const npcSelect = formValue(form, 'npcId');
    const npcId = String(npcSelect.value || '');
    const npcName = npcId ? String(npcSelect.selectedOptions?.[0]?.dataset.name || npcSelect.selectedOptions?.[0]?.textContent || '') : 'Narrador';
    const payload = {
      id: String(formValue(form, 'profileId').value || '') || undefined,
      speakerType: npcId ? 'NPC' : 'NARRATOR',
      npcId: npcId || null,
      npcName,
      provider: String(formValue(form, 'provider').value || 'browser'),
      voiceId: String(formValue(form, 'voiceId').value || '').trim() || null,
      model: String(formValue(form, 'model').value || '').trim() || null,
      language: String(formValue(form, 'language').value || 'pt-BR'),
      instructions: String(formValue(form, 'instructions').value || '').trim() || null,
      speed: Number(formValue(form, 'speed').value) || 1,
      stability: Number(formValue(form, 'stability').value),
      similarityBoost: Number(formValue(form, 'similarityBoost').value),
      style: Number(formValue(form, 'style').value),
      enabled: Boolean(formValue(form, 'enabled').checked),
      fallbackToBrowser: Boolean(formValue(form, 'fallbackToBrowser').checked),
      useSpeakerBoost: Boolean(formValue(form, 'useSpeakerBoost').checked)
    };
    try {
      await request(`/v1/voice-profiles/${encodeURIComponent(campaignId())}`, { method: 'POST', body: JSON.stringify(payload) });
      ui.notifications?.info?.('Mestre Orc: perfil de voz salvo.');
      return reload({ request });
    } catch (error) {
      submit.disabled = false;
      return ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    }
  });
}

export async function openVoiceProfilePanel({ request }) {
  if (!game.user?.isGM) return;
  try {
    const [snapshot, providerStatus] = await Promise.all([
      request(`/v1/voice-profiles/${encodeURIComponent(campaignId())}`),
      request('/v1/voice/providers').catch(() => ({ providers: [] }))
    ]);
    closeVoiceProfilePanel();
    document.body.insertAdjacentHTML('beforeend', panelHtml(snapshot, providerStatus));
    const panel = document.getElementById(VOICE_PROFILE_PANEL_ID);
    if (!panel) return;
    bindPanel(panel, snapshot, request);
    panel.addEventListener('click', (event) => { if (event.target === panel) closeVoiceProfilePanel(); });
  } catch (error) {
    console.error('[Mestre Orc] falha ao abrir perfis de voz', error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  }
}

export function injectVoiceProfileButton({ root = document, request, findChatContainer }) {
  if (!game.user?.isGM || document.getElementById(VOICE_PROFILE_BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;
  const button = document.createElement('button');
  button.id = VOICE_PROFILE_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'open-voice-profiles';
  button.innerHTML = '<i class="fa-solid fa-microphone-lines"></i><span>Vozes dos NPCs</span>';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openVoiceProfilePanel({ request });
  };
  const aiButton = document.getElementById('mestre-orc-ai-providers');
  if (aiButton?.parentElement) aiButton.insertAdjacentElement('afterend', button);
  else chat.prepend(button);
  return true;
}
