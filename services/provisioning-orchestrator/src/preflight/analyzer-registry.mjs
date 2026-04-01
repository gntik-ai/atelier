/**
 * Analyzer registry — maps domain keys to analyzer functions based on feature flags.
 * @module preflight/analyzer-registry
 */

import { analyze as analyzeIam } from './analyzers/iam-analyzer.mjs';
import { analyze as analyzePostgres } from './analyzers/postgres-analyzer.mjs';
import { analyze as analyzeMongo } from './analyzers/mongo-analyzer.mjs';
import { analyze as analyzeKafka } from './analyzers/kafka-analyzer.mjs';
import { analyze as analyzeFunctions } from './analyzers/functions-analyzer.mjs';
import { analyze as analyzeStorage } from './analyzers/storage-analyzer.mjs';

/** Canonical analysis order. Matches APPLIER_ORDER from T03. */
export const ANALYZER_ORDER = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/**
 * Build the analyzer registry based on feature flags.
 *
 * @param {string} [deploymentProfile]
 * @returns {Map<string, (tenantId: string, domainData: Object, options: Object) => Promise<import('./types.mjs').DomainAnalysisResult>>}
 */
export function getAnalyzerRegistry(deploymentProfile = 'standard') {
  const owEnabled = process.env.CONFIG_PREFLIGHT_OW_ENABLED === 'true';
  const mongoEnabled = process.env.CONFIG_PREFLIGHT_MONGO_ENABLED === 'true';

  /** @type {Map<string, Function>} */
  const registry = new Map();

  // Always-available analyzers
  registry.set('iam', analyzeIam);
  registry.set('postgres_metadata', analyzePostgres);
  registry.set('kafka', analyzeKafka);
  registry.set('storage', analyzeStorage);

  // Feature-gated analyzers
  if (mongoEnabled) {
    registry.set('mongo_metadata', analyzeMongo);
  }

  if (owEnabled) {
    registry.set('functions', analyzeFunctions);
  }

  return registry;
}
