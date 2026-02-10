/**
 * Runner registry.
 *
 * Imports all runner adapters and provides lookup by name or auto-detection.
 * To add a new runner (e.g. jest), create a new file in this directory
 * exporting { name, detect, buildCommand, countDots, parseFinal, getThresholds }
 * and add it to the `runners` array below.
 *
 * Each runner module must export:
 *   name: string                           — Human-readable label (e.g. 'vitest')
 *   detect(testScript: string): boolean    — Does this test script belong to this runner?
 *   buildCommand({ coverage }): { command, args }  — CLI command to spawn
 *   countDots(chunk: string): { passed, skipped, failed }  — Parse streaming dots
 *   parseFinal(output: string): { files, tests, passed, skipped, failed, duration }  — Parse final summary
 *   getThresholds(pkgPath: string): { lines?, branches?, functions? } | null  — Coverage thresholds
 */

import * as vitest from './vitest.js';
import * as bun from './bun.js';

/**
 * Ordered list of runners. Detection runs in order — first match wins.
 * Put more specific runners before less specific ones
 * (e.g. vitest before bun, since vitest is more specific).
 */
const runners = [vitest, bun];

/**
 * Get a runner adapter by name.
 * @param {string} name - Runner name (e.g. 'vitest', 'bun')
 * @returns {object|null} - Runner adapter or null
 */
export function getRunner(name) {
  return runners.find((r) => r.name === name) || null;
}

/**
 * Detect which runner a test script uses.
 * Runs detection in order — first match wins.
 * @param {string} testScript - Raw scripts.test from package.json
 * @returns {string|null} - Runner name or null if unrecognized
 */
export function detectRunner(testScript) {
  if (!testScript) return null;
  for (const runner of runners) {
    if (runner.detect(testScript)) return runner.name;
  }
  return null;
}

/**
 * Get all registered runner names.
 * @returns {string[]}
 */
export function getRunnerNames() {
  return runners.map((r) => r.name);
}
