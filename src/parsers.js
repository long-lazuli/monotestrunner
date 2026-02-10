/**
 * Output parsers for test runners
 * Parses vitest and bun test output formats
 */

import { stripAnsi } from './ui.js';

/**
 * Parse vitest final output for results
 */
export function parseVitestFinal(output) {
  const result = { files: 0, tests: 0, passed: 0, skipped: 0, failed: 0, duration: 0 };
  const clean = stripAnsi(output);

  // Test Files  11 passed (11) or Test Files  1 failed | 10 passed (11)
  const filesMatch = clean.match(/Test Files\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+passed)?\s*\((\d+)\)/);
  if (filesMatch) {
    result.files = parseInt(filesMatch[3], 10) || 0;
  }

  // Tests  516 passed | 37 skipped (553) or Tests  73 passed (73)
  const testsMatch = clean.match(/Tests\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+passed)?(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/);
  if (testsMatch) {
    result.failed = parseInt(testsMatch[1], 10) || 0;
    result.passed = parseInt(testsMatch[2], 10) || 0;
    result.skipped = parseInt(testsMatch[3], 10) || 0;
    result.tests = parseInt(testsMatch[4], 10) || 0;
  }

  // Duration  2.07s or Duration  294ms
  const durationMatch = clean.match(/Duration\s+([\d.]+)(ms|s)/);
  if (durationMatch) {
    const value = parseFloat(durationMatch[1]);
    result.duration = durationMatch[2] === 'ms' ? value / 1000 : value;
  }

  return result;
}

/**
 * Parse bun:test final output for results
 */
export function parseBunFinal(output) {
  const result = { files: 0, tests: 0, passed: 0, skipped: 0, failed: 0, duration: 0 };
  const clean = stripAnsi(output);

  // 24 pass
  const passMatch = clean.match(/(\d+)\s+pass/);
  if (passMatch) {
    result.passed = parseInt(passMatch[1], 10);
  }

  // 0 fail
  const failMatch = clean.match(/(\d+)\s+fail/);
  if (failMatch) {
    result.failed = parseInt(failMatch[1], 10);
  }

  // X skip
  const skipMatch = clean.match(/(\d+)\s+skip/);
  if (skipMatch) {
    result.skipped = parseInt(skipMatch[1], 10);
  }

  // Ran 24 tests across 1 file. [386.00ms]
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
 * Count dots in a chunk for vitest (dot reporter)
 * · = pass, - = skip, × = fail
 */
export function countVitestDots(chunk) {
  const clean = stripAnsi(chunk);
  return {
    passed: (clean.match(/·/g) || []).length,
    skipped: (clean.match(/-/g) || []).length,
    failed: (clean.match(/×/g) || []).length,
  };
}

/**
 * Count dots in a chunk for bun (dots reporter)
 * . = pass
 */
export function countBunDots(chunk) {
  const clean = stripAnsi(chunk);
  return {
    passed: (clean.match(/\./g) || []).length,
    skipped: 0,
    failed: 0,
  };
}
