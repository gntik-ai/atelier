import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const results = [];

export function recordResult(result) {
  results.push({ ...result });
}

export function resetResults() {
  results.length = 0;
}

export function generateReport({ runId, startedAt, environment }) {
  const completedAt = new Date();
  const summary = results.reduce(
    (acc, result) => {
      acc.total += 1;
      if (result.status === 'pass') acc.passed += 1;
      if (result.status === 'fail') acc.failed += 1;
      if (result.status === 'skip') acc.skipped += 1;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );

  return {
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    environment,
    summary,
    results: [...results],
    exitCode: exitCode(),
  };
}

export function exitCode() {
  return results.some((result) => result.severity === 'P1' && result.status === 'fail') ? 1 : 0;
}

export async function writeReport(report) {
  const reportDir = path.resolve(process.cwd(), process.env.HARDENING_REPORT_DIR ?? 'tests/hardening/reports');
  await mkdir(reportDir, { recursive: true });
  const filePath = path.join(reportDir, `hardening-${report.runId}.json`);
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
}

export function printReport(report) {
  const grouped = new Map();
  for (const result of report.results) {
    if (!grouped.has(result.suite)) grouped.set(result.suite, []);
    grouped.get(result.suite).push(result);
  }

  for (const [suite, suiteResults] of grouped.entries()) {
    console.log(`[HARDENING] Suite: ${suite}`);
    for (const result of suiteResults) {
      const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⏭';
      const detail = result.status === 'skip'
        ? `(skipped: ${result.skipReason ?? 'unspecified'})`
        : `(${result.durationMs}ms)`;
      console.log(`  ${icon} ${result.id} ${result.name ?? ''} [${result.severity}] ${detail}`.trimEnd());
    }
    console.log('');
  }

  const p1Failures = report.results.filter((result) => result.severity === 'P1' && result.status === 'fail').length;
  console.log('[HARDENING] Summary');
  console.log(`  Total: ${report.summary.total}  Passed: ${report.summary.passed}  Failed: ${report.summary.failed}  Skipped: ${report.summary.skipped}`);
  console.log(`  P1 failures: ${p1Failures} → EXIT CODE ${report.exitCode}`);
}
