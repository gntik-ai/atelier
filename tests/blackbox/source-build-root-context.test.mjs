import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fnDockerfilePath = path.join(repoRoot, 'apps/fn-runtime/Dockerfile');
const webDockerfilePath = path.join(repoRoot, 'apps/web-console/Dockerfile');
const fnDockerfile = fs.readFileSync(fnDockerfilePath, 'utf8');
const webDockerfile = fs.readFileSync(webDockerfilePath, 'utf8');
const filteredInstall = 'corepack enable && pnpm install --frozen-lockfile --filter @in-falcone/web-console...';
const boundedBuild = 'NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @in-falcone/web-console exec vite build';

function parseDockerfile(source) {
  const logicalLines = [];
  let pending = '';
  for (const physicalLine of source.split(/\r?\n/)) {
    const trimmed = physicalLine.trim();
    if (!pending && (!trimmed || trimmed.startsWith('#'))) continue;
    pending += `${pending ? ' ' : ''}${trimmed.replace(/\\$/, '').trim()}`;
    if (!trimmed.endsWith('\\')) {
      logicalLines.push(pending);
      pending = '';
    }
  }
  assert.equal(pending, '', 'Dockerfile ends with an unterminated line continuation');

  let stageIndex = -1;
  let stageName;
  return logicalLines.map((line) => {
    const match = line.match(/^([A-Z]+)\s+(.+)$/i);
    assert.ok(match, `unparseable Dockerfile instruction: ${line}`);
    const instruction = match[1].toUpperCase();
    const args = match[2].trim();
    if (instruction === 'FROM') {
      stageIndex += 1;
      stageName = args.match(/\s+AS\s+([^\s]+)$/i)?.[1];
    }
    return {instruction, args, line, stageIndex, stageName};
  });
}

function stage(instructions, index) {
  const matches = instructions.filter((entry) => entry.stageIndex === index);
  assert.ok(matches.length > 0, `Dockerfile stage ${index} is missing`);
  return matches;
}

function oneInstruction(instructions, instruction, predicate = () => true) {
  const matches = instructions.filter((entry) => entry.instruction === instruction && predicate(entry));
  assert.equal(matches.length, 1, `expected exactly one matching ${instruction}, found ${matches.length}`);
  return matches[0];
}

function assertRootContextFile(relativePath) {
  assert.equal(path.isAbsolute(relativePath), false, `COPY source must be relative to the checkout root: ${relativePath}`);
  const resolved = path.resolve(repoRoot, relativePath);
  assert.ok(resolved.startsWith(`${repoRoot}${path.sep}`), `COPY source escapes the checkout root: ${relativePath}`);
  assert.ok(fs.statSync(resolved).isFile(), `COPY source is not a file in a clean checkout root: ${relativePath}`);
}

function validateFnRootContext(source) {
  const instructions = parseDockerfile(source);
  const copy = oneInstruction(instructions, 'COPY');
  const match = copy.args.match(/^(\S+)\s+\.\/$/);
  assert.ok(match, 'fn-runtime must COPY one server file into its WORKDIR');
  assert.equal(match[1], 'apps/fn-runtime/server.mjs');
  assertRootContextFile(match[1]);
  return instructions;
}

function validateWebBuilder(source) {
  const instructions = parseDockerfile(source);
  const builder = stage(instructions, 0);
  const runtime = stage(instructions, 1);
  assert.equal(instructions.filter((entry) => entry.instruction === 'FROM').length, 2);
  assert.match(builder[0].args, /^node:22-alpine\s+AS\s+builder$/i);
  assert.equal(oneInstruction(builder, 'WORKDIR').args, '/src');

  const contextCopy = oneInstruction(builder, 'COPY');
  assert.equal(contextCopy.args, '. .', 'builder must receive the root checkout, including its workspace lockfile');
  const runs = builder.filter((entry) => entry.instruction === 'RUN');
  assert.equal(runs.length, 2, 'dependency installation and Vite build must be separate Docker layers');
  assert.deepEqual(runs.map((entry) => entry.args), [filteredInstall, boundedBuild]);
  assert.ok(builder.indexOf(contextCopy) < builder.indexOf(runs[0]));
  assert.ok(builder.indexOf(runs[0]) < builder.indexOf(runs[1]));
  assert.match(runs[0].args, /pnpm install --frozen-lockfile --filter @in-falcone\/web-console\.\.\.$/);
  assert.match(runs[1].args, /^NODE_OPTIONS=--max-old-space-size=1536\s/);

  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.match(rootPackage.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  const lockfile = fs.readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  assert.match(lockfile, /^lockfileVersion:\s*['"]?9\.0['"]?/m);
  assert.match(lockfile, /^\s{2}apps\/web-console:\s*$/m, 'root lockfile must contain the web-console workspace importer');

  const artifactCopy = oneInstruction(runtime, 'COPY', (entry) => entry.args.includes('/dist'));
  assert.equal(artifactCopy.args, '--from=builder /src/apps/web-console/dist ./dist');
  assert.equal(
    instructions.some((entry) => entry.instruction === 'COPY'
      && !entry.args.startsWith('--from=')
      && /apps\/web-console\/dist/.test(entry.args)),
    false,
    'runtime image must not depend on a pre-generated host dist directory',
  );
  return {instructions, builder, runtime};
}

function assertFinalRuntimeContract(runtime) {
  const finalFrom = runtime[0];
  assert.equal(finalFrom.instruction, 'FROM');
  assert.equal(finalFrom.args, 'node:22-alpine');
  assert.equal(oneInstruction(runtime, 'USER').args, '1000');
  assert.match(oneInstruction(runtime, 'USER').args, /^[1-9]\d*$/);
  assert.equal(oneInstruction(runtime, 'EXPOSE').args, '3000');
  assert.equal(oneInstruction(runtime, 'CMD').args, '["node", "static-server.mjs"]');
  const serverCopy = oneInstruction(runtime, 'COPY', (entry) => entry.args.endsWith('./static-server.mjs'));
  assert.equal(serverCopy.args, 'apps/web-console/static-server.mjs ./static-server.mjs');
  assertRootContextFile('apps/web-console/static-server.mjs');
}

// bbx-922-001 | fn-openshift-build-from-source | #### Scenario: Function runtime builds from the clean checkout root
test('fn-runtime Dockerfile resolves its server from the root build context', () => {
  const instructions = validateFnRootContext(fnDockerfile);
  const runtime = stage(instructions, 0);
  assert.equal(oneInstruction(runtime, 'USER').args, '1000');
  assert.equal(oneInstruction(runtime, 'EXPOSE').args, '8080');
  assert.equal(oneInstruction(runtime, 'CMD').args, '["node", "server.mjs"]');
});

// bbx-922-002 | fn-openshift-build-from-source | #### Scenario: Web console produces dist reproducibly inside a builder stage
test('web-console builds dist from the root pnpm lockfile and copies only the builder artifact into runtime', () => {
  validateWebBuilder(webDockerfile);
});

// bbx-922-003 | fn-openshift-build-from-source | #### Scenario: Web console final image preserves its restricted-runtime contract
test('web-console final stage retains numeric non-root user, port, static server, and command', () => {
  const {runtime} = validateWebBuilder(webDockerfile);
  assertFinalRuntimeContract(runtime);
});

// bbx-922-004 | fn-openshift-build-from-source | #### Scenario: Previous root-context Dockerfiles are rejected
test('contract validators are sensitive to both pre-fix Dockerfile regressions', () => {
  const oldFnDockerfile = fnDockerfile.replace('COPY apps/fn-runtime/server.mjs ./', 'COPY server.mjs ./');
  assert.notEqual(oldFnDockerfile, fnDockerfile);
  assert.throws(() => validateFnRootContext(oldFnDockerfile), /apps\/fn-runtime\/server\.mjs/);

  const oldWebDockerfile = webDockerfile
    .replace(`FROM node:22-alpine AS builder\nWORKDIR /src\nCOPY . .\nRUN ${filteredInstall}\nRUN ${boundedBuild}\n\n`, '')
    .replace('COPY --from=builder /src/apps/web-console/dist ./dist', 'COPY apps/web-console/dist ./dist');
  assert.notEqual(oldWebDockerfile, webDockerfile);
  assert.throws(() => validateWebBuilder(oldWebDockerfile), /Dockerfile stage 1 is missing/);
});

// bbx-922-005 | fn-openshift-build-from-source | #### Scenario: Web console build avoids the previously observed build-stage OOM
test('builder contract rejects 512/768 MiB heaps and a combined install/build RUN regression', () => {
  for (const insufficientHeap of [512, 768]) {
    const constrained = webDockerfile.replace(
      '--max-old-space-size=1536',
      `--max-old-space-size=${insufficientHeap}`,
    );
    assert.notEqual(constrained, webDockerfile);
    assert.throws(() => validateWebBuilder(constrained), /1536/);
  }

  const combined = webDockerfile.replace(
    `RUN ${filteredInstall}\nRUN ${boundedBuild}`,
    `RUN ${filteredInstall} && ${boundedBuild}`,
  );
  assert.notEqual(combined, webDockerfile);
  assert.throws(() => validateWebBuilder(combined), /must be separate Docker layers/);
});
