import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCinematicScriptText,
  parseCinematicSpeechScript,
  resolveCinematicMarker,
  stripCinematicMarkers,
  toElevenLabsV3Script
} from '../apps/foundry-module/scripts/cinematic-speech.js';
import { aiProviderInternals, classifyNarrationEnvironment } from '../packages/ai-provider/src/index.js';

test('normaliza marcações em português e inglês', () => {
  assert.equal(resolveCinematicMarker('sussurro'), 'whisper');
  assert.equal(resolveCinematicMarker('PAUSA LONGA'), 'long-pause');
  assert.equal(resolveCinematicMarker('laughs'), 'laugh');
  assert.equal(resolveCinematicMarker('desconhecido'), null);
});

test('parser remove marcações da fala e cria pausas expressivas', () => {
  const segments = parseCinematicSpeechScript('[sussurro] O corredor... está vazio. [pausa] A luz termina — aqui.', {
    rate: 1,
    pitch: 1,
    volume: 1
  });

  const spoken = segments.filter((segment) => segment.type === 'speech').map((segment) => segment.text).join(' ');
  const pauses = segments.filter((segment) => segment.type === 'pause');
  assert.doesNotMatch(spoken, /sussurro|pausa/i);
  assert.match(spoken, /O corredor/);
  assert.ok(pauses.length >= 3);
  assert.ok(segments.find((segment) => segment.type === 'speech' && segment.marker === 'whisper' && segment.volume < 1));
});

test('quebras de linha preservam a respiração do roteiro', () => {
  const script = normalizeCinematicScriptText('  [foco] A trilha segue.  \n\n  [tenso] Um galho quebra.  ');
  assert.equal(script, '[foco] A trilha segue.\n\n[tenso] Um galho quebra.');
  const segments = parseCinematicSpeechScript(script);
  assert.ok(segments.some((segment) => segment.type === 'pause' && segment.reason === 'paragraph'));
});

test('texto limpo mantém colchetes que não são marcações conhecidas', () => {
  const clean = stripCinematicMarkers('[sussurro] O arco contém [runa antiga].');
  assert.equal(clean, 'O arco contém [runa antiga].');
});

test('adaptador converte roteiro para tags do ElevenLabs v3', () => {
  const converted = toElevenLabsV3Script('[sussurro] Não façam barulho. [suspiro] Ainda não. [pausa longa] Agora.');
  assert.match(converted, /\[whispers\]/);
  assert.match(converted, /\[sighs\]/);
  assert.match(converted, /\[long pause\]/);
});

test('classificador escolhe perfil pelo contexto da cena', () => {
  assert.equal(classifyNarrationEnvironment({ room: { name: 'Cripta subterrânea' } }).id, 'DUNGEON');
  assert.equal(classifyNarrationEnvironment({ scene: { name: 'Floresta de Tethyr' } }).id, 'FOREST');
  assert.equal(classifyNarrationEnvironment({ source: { text: 'A taverna está cheia de hidromel.' } }).id, 'CITY');
  assert.equal(classifyNarrationEnvironment({ scene: { name: 'Planície aberta' } }).id, 'GENERAL');
});

test('prompt de masmorra exige marcações e ritmo apropriados sem liberar invenções', () => {
  const prompt = aiProviderInternals.roomEntryPrompt({
    scene: { name: 'Masmorra antiga' },
    room: { name: 'Corredor da cripta' },
    source: { text: 'Paredes de pedra delimitam um corredor estreito iluminado pela entrada.' },
    perception: { visionAvailable: true, blinded: false },
    visibleActors: []
  });
  assert.match(prompt, /Perfil detectado: MASMORRA/i);
  assert.match(prompt, /\[sussurro\].*\[tenso\].*\[medo\]/s);
  assert.match(prompt, /Insira de 2 a 5 marcações/i);
  assert.match(prompt, /não use uma marcação para justificar a invenção/i);
});
