import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRotationProcedureSection } from '../src/rotation-procedure-section.mjs';
import { assembleWorkspaceDocs } from '../src/doc-assembler.mjs';

test('buildRotationProcedureSection includes heading, code blocks and baseUrl', () => {
  const output = buildRotationProcedureSection({ baseUrl: 'https://atelier.example.test' });
  assert.match(output, /## API Key Rotation Procedure/);
  assert.ok((output.match(/```/g) ?? []).length >= 4);
  assert.match(output, /https:\/\/atelier\.example\.test/);
  assert.match(output, /JavaScript example/);
  assert.match(output, /Python example/);
});

test('assembleWorkspaceDocs injects the rotation procedure section', async () => {
  const docs = await assembleWorkspaceDocs(
    { tenantId: 'ten_1', workspaceId: 'wrk_1' },
    { query: async () => ({ rows: [] }) },
    {
      getApiSurface: async () => ({ baseUrl: 'https://atelier.example.test' }),
      getEffectiveCapabilities: async () => []
    }
  );

  assert.match(docs.rotationProcedureSection, /## API Key Rotation Procedure/);
  assert.match(docs.rotationProcedureSection, /https:\/\/atelier\.example\.test/);
});
