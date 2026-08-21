import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shellUrl = new URL('../apps/fenix-vtt/components/vtt-shell.jsx', import.meta.url);
const providerUrl = new URL('../apps/fenix-vtt/components/session-provider.jsx', import.meta.url);
const catalogUrl = new URL('../apps/fenix-vtt/components/actor-scene-catalog.jsx', import.meta.url);
const stateUrl = new URL('../apps/fenix-vtt/lib/session-state.js', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('painel Em cena usa catálogo persistente e não personagens hardcoded', async () => {
  const shell = await source(shellUrl);
  const catalog = await source(catalogUrl);

  assert.match(shell, /ActorSceneCatalog/);
  assert.match(shell, /actors,/);
  assert.match(shell, /createActor/);
  assert.match(shell, /placeActorToken/);
  assert.doesNotMatch(shell, /const actors\s*=\s*\[/);
  assert.doesNotMatch(shell, /hp:\s*'28 \/ 34'/);

  assert.match(catalog, /\+ Ator/);
  assert.match(catalog, /Criar ficha/);
  assert.match(catalog, /Colocar/);
  assert.match(catalog, /token\.actorId/);
});

test('provider carrega atores reais e cria Token ↔ Ator com ids separados', async () => {
  const provider = await source(providerUrl);

  assert.match(provider, /client\.listActors\(campaign\.id\)/);
  assert.match(provider, /client\.upsertActor\(campaign\.id, actorId/);
  assert.match(provider, /const placeActorToken = useCallback/);
  assert.match(provider, /id: `token-\$\{actor\.id\}`/);
  assert.match(provider, /actorId: actor\.id/);
  assert.match(provider, /sheetId: actor\.sheetId/);
  assert.match(provider, /systemId: actor\.systemId/);
  assert.match(provider, /realtimeRef\.current\.moveToken\(token/);
  assert.match(provider, /client\.upsertSceneToken\(campaign\.id, activeScene\.id, token\)/);
});

test('sessão nasce com atores da campanha e não semeia demoTokens no realtime', async () => {
  const provider = await source(providerUrl);
  const state = await source(stateUrl);

  assert.match(provider, /visibleActors: \(Array\.isArray\(actors\)/);
  assert.match(provider, /const actors = await refreshActors\(\)/);
  assert.doesNotMatch(provider, /demoTokens/);
  assert.doesNotMatch(provider, /for \(const token of demoTokens\)/);
  assert.doesNotMatch(state, /selectedActorId: 'hero-ayla'/);
  assert.match(state, /selectedActorId: null/);
});

test('convite é derivado do catálogo e NPC não vira identidade de jogador', async () => {
  const shell = await source(shellUrl);
  const provider = await source(providerUrl);

  assert.match(shell, /actors\.filter\(\(actor\) => actor\.kind !== 'npc'\)/);
  assert.match(provider, /actor\.kind === 'npc'/);
  assert.match(provider, /Convites só podem ser vinculados a personagens de jogador/);
});
