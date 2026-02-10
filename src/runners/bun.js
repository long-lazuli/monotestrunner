/**
 * Bun test runner adapter.
 *
 * Provides the runner interface for bun-based test packages.
 * To add a new runner, create a file in this directory exporting the same shape.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripAnsi } from '../ui.js';

/** Human-readable label shown in the UI */
export const name = 'bun';

/**
 * Detect whether a test script belongs to this runner.
 * @param {string} testScript - The raw scripts.test string from package.json
 * @returns {boolean}
 */
export function detect(testScript) {
  return testScript.includes('bun');
}

/**
 * Build the command and args to spawn a test run.
 * @param {object} opts
 * @param {boolean} opts.coverage - Whether coverage is enabled
 * @returns {{ command: string, args: string[] }}
 */
export function buildCommand({ coverage = false } = {}) {
  const args = ['test', '--dots', '--reporter=junit', '--reporter-outfile=coverage/junit.xml'];
  if (coverage) {
    args.push('--coverage', '--coverage-reporter=lcov', '--coverage-dir=coverage');
  }
  return { command: 'bun', args };
}

/**
 * Count dots from streaming output.
 * Bun dots reporter: . = pass (no skip/fail characters)
 * @param {string} chunk - Raw stdout chunk
 * @returns {{ passed: number, skipped: number, failed: number }}
 */
export function countDots(chunk) {
  const clean = stripAnsi(chunk);
  return {
    passed: (clean.match(/\./g) || []).length,
    skipped: 0,
    failed: 0,
  };
}

/**
 * Parse the final summary output after a test run completes.
 * @param {string} output - Full stdout+stderr
 * @returns {{ files: number, tests: number, passed: number, skipped: number, failed: number, duration: number }}
 */
export function parseFinal(output) {
  const result = { files: 0, tests: 0, passed: 0, skipped: 0, failed: 0, duration: 0 };
  const clean = stripAnsi(output);

  const passMatch = clean.match(/(\d+)\s+pass/);
  if (passMatch) result.passed = parseInt(passMatch[1], 10);

  const failMatch = clean.match(/(\d+)\s+fail/);
  if (failMatch) result.failed = parseInt(failMatch[1], 10);

  const skipMatch = clean.match(/(\d+)\s+skip/);
  if (skipMatch) result.skipped = parseInt(skipMatch[1], 10);

  const summaryMatch = clean.match(/Ran\s+(\d+)\s+tests\s+across\s+(\d+)\s+files?.*?\[([\d.]+)(ms|s)\]/);
  if (summaryMatch) {
    result.tests = parseInt(summaryMatch[1], 10);
    result.files = parseInt(summaryMatch[2], 10);
    const value = parseFloat(summaryMatch[3]);
    result.duration = summaryMatch[4] === 'ms' ? value / 1000 : value;
  }

  return result;
}

/**
 * Read coverage thresholds from the package's bunfig.toml.
 * @param {string} pkgPath - Absolute path to the package root
 * @returns {{ lines?: number, branches?: number, functions?: number } | null}
 */
export function getThresholds(pkgPath) {
  const configPath = join(pkgPath, 'bunfig.toml');
  if (!existsSync(configPath)) return null;

  const content = readFileSync(configPath, 'utf-8');
  const thresholdMatch = content.match(/coverageThreshold\s*=\s*\{([^}]+)\}/);
  if (!thresholdMatch) return null;

  const block = thresholdMatch[1];
  const result = {};

  const lineMatch = block.match(/line\s*=\s*([\d.]+)/);
  if (lineMatch) result.lines = parseFloat(lineMatch[1]);

  const funcMatch = block.match(/function\s*=\s*([\d.]+)/);
  if (funcMatch) result.functions = parseFloat(funcMatch[1]);

  return Object.keys(result).length > 0 ? result : null;
}
