import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFileCallback);
const GENERATOR_MAP = { typescript: 'typescript-fetch', python: 'python' };

export async function archiveDirectory(outputPath, archivePath) {
  const { spawn } = await import('node:child_process');
  const ext = archivePath.endsWith('.zip') ? '.zip' : '.tar.gz';
  const args = ext === '.zip'
    ? ['-r', archivePath, '.']
    : ['-czf', archivePath, '.'];
  const cmd = ext === '.zip' ? 'zip' : 'tar';

  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: outputPath, stdio: 'ignore' });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)));
    child.on('error', reject);
  });
}

export async function buildSdk(specJson, language, workspaceId, specVersion, options = {}) {
  const execFileImpl = options.execFileAsync ?? execFileAsync;
  const generatorName = GENERATOR_MAP[language];
  if (!generatorName) throw new Error(`Unsupported SDK language: ${language}`);

  const tempRoot = await mkdtemp(join(tmpdir(), 'falcone-openapi-sdk-'));
  const specPath = join(tempRoot, 'spec.json');
  const outputPath = join(tempRoot, 'output');
  const archivePath = join(tempRoot, language === 'typescript' ? 'workspace-sdk.zip' : 'workspace-sdk.tar.gz');

  try {
    await writeFile(specPath, specJson, 'utf8');
    const args = [
      'generate',
      '-g', generatorName,
      '-i', specPath,
      '-o', outputPath,
      '--additional-properties', `packageName=workspace-${workspaceId.slice(0, 8)}-sdk,packageVersion=${specVersion}`
    ];
    await execFileImpl('openapi-generator-cli', args, { timeout: 240_000 });
    await archiveDirectory(outputPath, archivePath);
    return { archivePath, archiveType: language === 'typescript' ? 'zip' : 'tar.gz' };
  } catch (error) {
    throw error;
  } finally {
    await rm(specPath, { force: true }).catch(() => undefined);
  }
}
