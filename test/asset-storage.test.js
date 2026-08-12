import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAssetStorage } from '../packages/asset-storage/src/index.js';

test('LocalAssetStorage persiste e lê mapa de campanha sem permitir segmentos inseguros', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'fenix-assets-'));
  try {
    const storage = new LocalAssetStorage({ rootDir, maxBytes: 1024 });
    await storage.initialize();
    const payload = Buffer.from('fake-png-data');
    const asset = await storage.saveImage({
      campaignId: 'campaign-1',
      assetId: 'asset-1',
      fileName: 'mapa.png',
      mimeType: 'image/png',
      dataBase64: payload.toString('base64')
    });
    assert.equal(asset.id, 'asset-1');
    assert.equal(asset.mimeType, 'image/png');
    assert.deepEqual(await storage.read({ campaignId: 'campaign-1', assetId: 'asset-1' }), payload);

    await assert.rejects(
      () => storage.read({ campaignId: '../escape', assetId: 'asset-1' }),
      (error) => error.code === 'ASSET_PATH_INVALID'
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('LocalAssetStorage rejeita formato e tamanho inválidos', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'fenix-assets-'));
  try {
    const storage = new LocalAssetStorage({ rootDir, maxBytes: 4 });
    await storage.initialize();
    await assert.rejects(
      () => storage.saveImage({
        campaignId: 'campaign-1',
        fileName: 'mapa.gif',
        mimeType: 'image/gif',
        dataBase64: Buffer.from('abc').toString('base64')
      }),
      (error) => error.code === 'ASSET_TYPE_UNSUPPORTED' && error.statusCode === 415
    );
    await assert.rejects(
      () => storage.saveImage({
        campaignId: 'campaign-1',
        fileName: 'mapa.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from('12345').toString('base64')
      }),
      (error) => error.code === 'ASSET_TOO_LARGE' && error.statusCode === 413
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
