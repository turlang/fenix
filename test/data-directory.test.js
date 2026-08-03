import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createNarrationMemoryFromEnv } from '../packages/narration-memory/src/index.js';
import { createCampaignMemoryFromEnv } from '../packages/memory/src/index.js';
import { createAdventureLibraryFromEnv } from '../packages/adventure-library/src/index.js';
import { createGeneratorServiceFromEnv } from '../packages/generator-service/src/index.js';
import { createMapServiceFromEnv } from '../packages/map-service/src/index.js';
import { createVoiceProfileServiceFromEnv } from '../packages/voice-profile-service/src/index.js';
import { createTutorServiceFromEnv } from '../packages/tutor-service/src/index.js';
import { createAutomationServiceFromEnv } from '../packages/automation-service/src/index.js';
import { createBackupServiceFromEnv } from '../packages/backup-service/src/index.js';

const dummyServices = {
  campaignMemory: {}, adventureLibrary: {}, generatorService: {}, mapService: {},
  voiceProfileService: {}, tutorService: {}, automationService: {}, narrationMemory: {}
};

test('MESTRE_ORC_DATA_DIRECTORY centraliza todos os armazenamentos persistentes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-data-dir-'));
  const previous = process.env.MESTRE_ORC_DATA_DIRECTORY;
  process.env.MESTRE_ORC_DATA_DIRECTORY = directory;
  try {
    const env = { MESTRE_ORC_DATA_DIRECTORY: directory };
    assert.equal(createNarrationMemoryFromEnv().filePath, resolve(directory, 'narration-history.json'));
    assert.equal(createCampaignMemoryFromEnv({ env }).filePath, resolve(directory, 'campaign-memory.json'));
    assert.equal(createAdventureLibraryFromEnv().filePath, resolve(directory, 'adventure-library.json'));
    assert.equal(createGeneratorServiceFromEnv({ env }).filePath, resolve(directory, 'generated-content.json'));
    assert.equal(createMapServiceFromEnv({ env }).filePath, resolve(directory, 'map-blueprints.json'));
    assert.equal(createVoiceProfileServiceFromEnv({ env }).filePath, resolve(directory, 'voice-profiles.json'));
    assert.equal(createTutorServiceFromEnv({ env }).filePath, resolve(directory, 'tutor-history.json'));
    assert.equal(createAutomationServiceFromEnv({ env }).filePath, resolve(directory, 'automation-proposals.json'));
    assert.equal(createBackupServiceFromEnv({ env, services: dummyServices }).backupDirectory, resolve(directory, 'backups'));
  } finally {
    if (previous === undefined) delete process.env.MESTRE_ORC_DATA_DIRECTORY;
    else process.env.MESTRE_ORC_DATA_DIRECTORY = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
