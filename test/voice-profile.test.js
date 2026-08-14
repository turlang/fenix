import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileVoiceProfileService, InMemoryVoiceProfileService } from '../packages/voice-profile-service/src/index.js';

test('perfis de voz isolam narrador e NPC por campanha', async () => {
  const service = new InMemoryVoiceProfileService({ logger: { error() {} } });
  const narrator = await service.upsert('world-a', {
    speakerType: 'NARRATOR', provider: 'openai', voiceId: 'marin', instructions: 'Narração grave e contida.'
  });
  const npc = await service.upsert('world-a', {
    speakerType: 'NPC', npcId: 'npc-1', npcName: 'Sildar', provider: 'elevenlabs', voiceId: 'voice-sildar', stability: 0.7
  });

  assert.equal(narrator.profile.id, 'narrator');
  assert.equal(npc.profile.id, 'npc:npc-1');
  assert.equal((await service.resolve('world-a', { speakerType: 'NARRATOR' })).voiceId, 'marin');
  assert.equal((await service.resolve('world-a', { npcId: 'npc-1', speakerType: 'NPC' })).voiceId, 'voice-sildar');
  assert.equal(await service.resolve('world-b', { npcId: 'npc-1', speakerType: 'NPC' }), null);
});

test('perfil desativado não é selecionado e pode bloquear fallback local', async () => {
  const service = new InMemoryVoiceProfileService();
  await service.upsert('world', {
    speakerType: 'NPC', npcId: 'npc-2', npcName: 'Iarno', provider: 'openai', voiceId: 'onyx', enabled: false, fallbackToBrowser: false
  });
  assert.equal(await service.resolve('world', { npcId: 'npc-2', speakerType: 'NPC' }), null);
  const snapshot = await service.list('world');
  assert.equal(snapshot.profiles[0].fallbackToBrowser, false);
});

test('arquivo de perfis usa persistência atômica e recupera configurações', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-voice-'));
  const filePath = join(directory, 'voice-profiles.json');
  try {
    const writer = new FileVoiceProfileService({ filePath, logger: { error() {} } });
    await writer.upsert('world-persisted', {
      speakerType: 'NPC', npcId: 'npc-p', npcName: 'Rei Grol', provider: 'compatible', voiceId: 'grol', speed: 0.85
    });
    const reader = new FileVoiceProfileService({ filePath, logger: { error() {} } });
    const profile = await reader.resolve('world-persisted', { npcName: 'Rei Grol', speakerType: 'NPC' });
    assert.equal(profile.provider, 'compatible');
    assert.equal(profile.speed, 0.85);
    assert.equal((await reader.remove('world-persisted', profile.id)).removed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
