/**
 * Vitest runner adapter.
 *
 * Provides the runner interface for vitest-based test packages.
 * To add a new runner, create a file in this directory exporting the same shape.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripAnsi } from '../ui.js';

/** Human-readable label shown in the UI */
export const name = 'vitest';

/**
 * Detect whether a test script belongs to this runner.
 * @param {string} testScript - The raw scripts.test string from package.json
 * @returns {boolean}
 */
export function detect(testScript) {
  return testScript.includes('vitest');
}

/**
 * Build the command and args to spawn a test run.
 * @param {object} opts
 * @param {boolean} opts.coverage - Whether coverage is enabled
 * @returns {{ command: string, args: string[] }}
 */
export function buildCommand({ coverage = false } = {}) {
  const args = ['vitest', 'run', '--reporter=dot', '--reporter=junit', '--outputFile.junit=coverage/junit.xml'];
  if (coverage) {
    args.push('--coverage', '--coverage.reporter=json-summary', '--coverage.reporter=lcov');
  }
  return { command: 'pnpm', args };
}

/**
 * Count dots from streaming output.
 * Vitest dot reporter: · = pass, - = skip, × = fail
 * @param {string} chunk - Raw stdout chunk
 * @returns {{ passed: number, skipped: number, failed: number }}
 */
export function countDots(chunk) {
  const clean = stripAnsi(chunk);
  return {
    passed: (clean.match(/·/g) || []).length,
    skipped: (clean.match(/-/g) || []).length,
    failed: (clean.match(/×/g) || []).length,
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

  const filesMatch = clean.match(/Test Files\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+passed)?\s*\((\d+)\)/);
  if (filesMatch) {
    result.files = parseInt(filesMatch[3], 10) || 0;
  }

  const testsMatch = clean.match(/Tests\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+passed)?(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/);
  if (testsMatch) {
    result.failed = parseInt(testsMatch[1], 10) || 0;
    result.passed = parseInt(testsMatch[2], 10) || 0;
    result.skipped = parseInt(testsMatch[3], 10) || 0;
    result.tests = parseInt(testsMatch[4], 10) || 0;
  }

  const durationMatch = clean.match(/Duration\s+([\d.]+)(ms|s)/);
  if (durationMatch) {
    const value = parseFloat(durationMatch[1]);
    result.duration = durationMatch[2] === 'ms' ? value / 1000 : value;
  }

  return result;
}

/**
 * Read coverage thresholds from the package's config file.
 * Tries vitest.config.ts, vitest.config.js, vite.config.ts, vite.config.js.
 * @param {string} pkgPath - Absolute path to the package root
 * @returns {{ lines?: number, branches?: number, functions?: number } | null}
 */
export function getThresholds(pkgPath) {
  for (const fileName of ['vitest.config.ts', 'vitest.config.js', 'vite.config.ts', 'vite.config.js']) {
    const configPath = join(pkgPath, fileName);
    if (!existsSync(configPath)) continue;

    const content = readFileSync(configPath, 'utf-8');
    const thresholdsMatch = content.match(/thresholds\s*:\s*\{([^}]+)\}/);
    if (!thresholdsMatch) continue;

    const block = thresholdsMatch[1];
    const result = {};

    for (const key of ['lines', 'branches', 'functions']) {
      const m = block.match(new RegExp(`${key}\\s*:\\s*([\\d.]+)`));
      if (m) result[key] = parseFloat(m[1]);
    }

    if (Object.keys(result).length > 0) return result;
  }
  return null;
}
