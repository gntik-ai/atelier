/**
 * Post-merge dependency-convergence regression for issue #933.
 *
 * After `gntik-ai/falcone-charts#8` merged (PR #9) and the `falcone-knative`
 * runtime chart 0.1.0 was published, the Falcone-side artifacts must converge:
 * the CI chart pin points at a real merged commit, the proposed docs drop the
 * stale "open and unimplemented" claim while keeping their fail-closed
 * "unavailable / acceptance blocked" wording, and the OpenSpec task list checks
 * only the chart-side implementation — never the live-acceptance/archive gates.
 *
 * Stable IDs: bbx-933-charts-pin-convergence, bbx-933-proposed-docs-fail-closed,
 * bbx-933-tasks-acceptance-open.
 *
 * Pure file inspection: no cluster, network, or helm dependency. The stronger
 * "pin == sibling chart HEAD" invariant is enforced by all-core-006 in CI.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');
// Strip blockquote markers, then collapse whitespace so prose assertions are
// tolerant of line wrapping in the Markdown source.
const prose = (rel) => read(rel).replace(/^>\s?/gm, '').replace(/\s+/g, ' ');

const CI_WORKFLOW = '.github/workflows/ci.yml';
const PROPOSED_DOC = 'docs/installation/managed-knative-proposed.md';
const STATUS_DOC = 'docs/reference/architecture/knative-runtime-status.md';
const TASKS = 'openspec/changes/add-managed-knative-serving/tasks.md';
const STALE_PIN = '8237a209bf7c2ff187c2d25cd496cbc9787502e7';

test('bbx-933-charts-pin-convergence: CI pins the charts checkout to a real merged commit SHA', () => {
  const ci = read(CI_WORKFLOW);
  const match = ci.match(/FALCONE_CHARTS_REF:\s*['"]([^'"]+)['"]/);
  assert.ok(match, 'ci.yml must define FALCONE_CHARTS_REF');
  const ref = match[1];
  assert.match(ref, /^[0-9a-f]{40}$/, 'FALCONE_CHARTS_REF must be a full 40-hex commit SHA, not a branch or short ref');
  assert.notEqual(ref, STALE_PIN, 'FALCONE_CHARTS_REF must not remain the pre-merge stale pin');
});

test('bbx-933-proposed-docs-fail-closed: proposed docs converge yet stay fail-closed', () => {
  const proposed = prose(PROPOSED_DOC);
  const status = prose(STATUS_DOC);

  // Fail-closed availability wording is retained (never silently "available").
  assert.ok(
    proposed.includes('proposed and unavailable for production use'),
    'installation proposal must keep its proposed/unavailable status banner',
  );
  assert.ok(
    proposed.includes('managed acceptance remains blocked and managed mode stays unavailable'),
    'installation proposal must keep managed mode blocked/unavailable',
  );
  assert.ok(status.includes('Maturity: **proposed**'), 'runtime status reference must keep proposed maturity');
  assert.ok(
    status.includes('Managed installation remains unavailable'),
    'runtime status reference must keep managed installation unavailable',
  );
  assert.ok(
    status.includes('release availability remains blocked'),
    'runtime status reference must keep release availability blocked',
  );

  // Stale "chart #8 is open/unimplemented" claim is gone from both docs.
  for (const [label, body] of [['proposed doc', proposed], ['status doc', status]]) {
    assert.ok(!/open and unimplemented/i.test(body), `${label} must drop the stale "open and unimplemented" chart claim`);
  }

  // Post-merge convergence is recorded (chart delivered + published).
  for (const [label, body] of [['proposed doc', proposed], ['status doc', status]]) {
    assert.ok(body.includes('merged (PR #9)'), `${label} must record that chart #8 merged via PR #9`);
    assert.ok(body.includes('0.1.0 is published'), `${label} must record that runtime chart 0.1.0 is published`);
  }
});

test('bbx-933-tasks-acceptance-open: chart-side tasks close while acceptance/archive gates stay open', () => {
  const tasks = read(TASKS);

  // The merged/published chart genuinely completes the chart-side implementation.
  for (const id of ['T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11']) {
    assert.match(
      tasks,
      new RegExp(`- \\[x\\] ${id} `),
      `${id} (chart-side implementation) must be checked once the chart is merged and published`,
    );
  }

  // Environment provisioning, live acceptance, and archive must NOT be claimed
  // until a disposable cluster-admin OpenShift 4.21 target passes acceptance.
  for (const id of ['T02', 'T22', 'T23', 'T24', 'T25', 'T26', 'T27']) {
    assert.match(
      tasks,
      new RegExp(`- \\[ \\] ${id} `),
      `${id} (acceptance/archive gate) must stay open until live real-stack acceptance passes`,
    );
  }
});
