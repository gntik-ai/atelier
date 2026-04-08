import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadSdkArtefact, buildSdkObjectKey } from '../src/sdk-storage.mjs';

const fixtureDir = join(tmpdir(), 'falcone-sdk-storage-tests');
mkdirSync(fixtureDir, { recursive: true });
const archivePath = join(fixtureDir, 'archive.zip');
writeFileSync(archivePath, 'zip');

test('upload path follows expected zip key pattern', async () => {
  const sent = [];
  const result = await uploadSdkArtefact({ archivePath, archiveType: 'zip', workspaceId: 'ws_1', language: 'typescript', specVersion: '1.2.3' }, {
    client: { send: async (command) => sent.push(command) },
    getSignedUrl: async () => 'https://signed.example/download'
  });
  assert.equal(buildSdkObjectKey({ workspaceId: 'ws_1', language: 'typescript', specVersion: '1.2.3', archiveType: 'zip' }), 'sdks/ws_1/typescript/1.2.3/workspace-sdk.zip');
  assert.equal(result.downloadUrl, 'https://signed.example/download');
  assert.ok(result.urlExpiresAt instanceof Date);
});

test('presigned URL TTL roughly matches config default', async () => {
  const before = Date.now();
  const result = await uploadSdkArtefact({ archivePath, archiveType: 'zip', workspaceId: 'ws_1', language: 'typescript', specVersion: '1.2.3' }, {
    client: { send: async () => undefined },
    getSignedUrl: async () => 'https://signed.example/download'
  });
  const ttl = Math.round((result.urlExpiresAt.getTime() - before) / 1000);
  assert.ok(ttl >= 86395 && ttl <= 86405);
});

test('python archive uses tar.gz extension', () => {
  assert.equal(buildSdkObjectKey({ workspaceId: 'ws_1', language: 'python', specVersion: '1.2.3', archiveType: 'tar.gz' }), 'sdks/ws_1/python/1.2.3/workspace-sdk.tar.gz');
});

test('python archive upload produces date about now plus ttl', async () => {
  const result = await uploadSdkArtefact({ archivePath, archiveType: 'tar.gz', workspaceId: 'ws_1', language: 'python', specVersion: '1.2.3' }, {
    client: { send: async () => undefined },
    getSignedUrl: async () => 'https://signed.example/python'
  });
  assert.equal(result.downloadUrl, 'https://signed.example/python');
});
