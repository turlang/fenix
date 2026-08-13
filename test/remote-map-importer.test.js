import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPublicAddress,
  parseRemoteMapUrl,
  RemoteMapImporter
} from '../packages/remote-map-importer/src/index.js';

function fakePng(width = 2048, height = 1536) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('RemoteMapImporter importa PNG público, detecta dimensões e não depende de CORS', async () => {
  const importer = new RemoteMapImporter({
    lookupImpl: publicLookup,
    fetchBinary: async (url, resolved) => {
      assert.equal(url.href, 'https://cdn.example.com/maps/templo.png?sig=abc');
      assert.equal(resolved.address, '93.184.216.34');
      return {
        statusCode: 200,
        headers: { 'content-type': 'image/png' },
        body: fakePng(2400, 1600)
      };
    }
  });

  const result = await importer.importUrl('https://cdn.example.com/maps/templo.png?sig=abc');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.fileName, 'templo.png');
  assert.equal(result.width, 2400);
  assert.equal(result.height, 1600);
  assert.equal(result.sourceHost, 'cdn.example.com');
});

test('RemoteMapImporter bloqueia localhost, IP privado e DNS que resolve para rede privada', async () => {
  assert.throws(
    () => parseRemoteMapUrl('http://localhost:3000/map.png'),
    (error) => error.code === 'REMOTE_MAP_PRIVATE_HOST_FORBIDDEN' && error.statusCode === 403
  );

  const direct = new RemoteMapImporter({
    fetchBinary: async () => { throw new Error('não deveria baixar'); }
  });
  await assert.rejects(
    () => direct.importUrl('http://127.0.0.1/map.png'),
    (error) => error.code === 'REMOTE_MAP_PRIVATE_HOST_FORBIDDEN' && error.statusCode === 403
  );

  let downloads = 0;
  const dnsPrivate = new RemoteMapImporter({
    lookupImpl: async () => [{ address: '10.0.0.25', family: 4 }],
    fetchBinary: async () => { downloads += 1; return {}; }
  });
  await assert.rejects(
    () => dnsPrivate.importUrl('https://maps.example.com/dungeon.webp'),
    (error) => error.code === 'REMOTE_MAP_PRIVATE_HOST_FORBIDDEN' && error.statusCode === 403
  );
  assert.equal(downloads, 0);
});

test('RemoteMapImporter revalida redirect e impede pivot para rede interna', async () => {
  let downloads = 0;
  const importer = new RemoteMapImporter({
    lookupImpl: publicLookup,
    fetchBinary: async () => {
      downloads += 1;
      return {
        statusCode: 302,
        headers: { location: 'http://192.168.1.50/private-map.png' },
        body: Buffer.alloc(0)
      };
    }
  });

  await assert.rejects(
    () => importer.importUrl('https://cdn.example.com/redirect.png'),
    (error) => error.code === 'REMOTE_MAP_PRIVATE_HOST_FORBIDDEN' && error.statusCode === 403
  );
  assert.equal(downloads, 1);
});

test('RemoteMapImporter rejeita conteúdo disfarçado e URLs com credenciais', async () => {
  const importer = new RemoteMapImporter({
    lookupImpl: publicLookup,
    fetchBinary: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('<html>não é imagem</html>')
    })
  });

  await assert.rejects(
    () => importer.importUrl('https://cdn.example.com/fake.png'),
    (error) => error.code === 'REMOTE_MAP_SIGNATURE_INVALID' && error.statusCode === 415
  );

  assert.throws(
    () => parseRemoteMapUrl('https://user:secret@example.com/map.png'),
    (error) => error.code === 'REMOTE_MAP_URL_CREDENTIALS_FORBIDDEN'
  );
});

test('isPublicAddress bloqueia faixas reservadas usadas em SSRF', () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('10.1.2.3'), false);
  assert.equal(isPublicAddress('172.16.1.1'), false);
  assert.equal(isPublicAddress('192.168.1.1'), false);
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('::1'), false);
  assert.equal(isPublicAddress('fd00::1'), false);
});
