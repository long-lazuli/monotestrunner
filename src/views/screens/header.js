/**
 * Shared header + tab bar for detail screens (tests & coverage).
 *
 * Renders the package info header (2 lines), tab bar, and separator.
 * Pure rendering — no state mutation.
 */

import c from 'picocolors';
import { term, spinnerFrames, stripAnsi } from '../../ui.js';

/**
 * Render the detail screen header block (5 fixed lines).
 *
 * Line 1: package name + runner + file/test counts (or spinner)
 * Line 2: pass/skip/fail summary + duration (or blank)
 * Line 3: blank
 * Line 4: tab bar — [Tests]  Coverage  (with threshold info if on coverage)
 * Line 5: separator
 *
 * @param {object} opts
 * @param {object} opts.pkg - Package { name, runner }
 * @param {object} opts.state - Package test state
 * @param {string} opts.currentPage - 'tests' | 'coverage'
 * @param {boolean} opts.coverageEnabled - Whether coverage is enabled for this package
 * @param {number} opts.spinnerIdx - Spinner frame index
 * @param {number} opts.cols - Terminal columns
 * @param {object|null} opts.thresholds - Coverage thresholds { lines, branches, functions }
 */
export function renderDetailHeader({ pkg, state, currentPage, coverageEnabled, spinnerIdx, cols, thresholds }) {
  // Line 1: package name + runner + stats
  const statsRight =
    state.status === 'done'
      ? c.dim(`${state.files} files  ${state.tests} tests`)
      : state.status === 'running'
        ? `${spinnerFrames[spinnerIdx % spinnerFrames.length]} ${c.yellow('running...')}`
        : c.dim('pending');

  const nameLeft = ` ${c.bold(pkg.name)} ${c.gray(`(${pkg.runner})`)}`;
  const gap1 = Math.max(1, cols - stripAnsi(nameLeft).length - stripAnsi(statsRight).length);

  process.stdout.write(term.clearLine);
  console.log(`${nameLeft}${' '.repeat(gap1)}${statsRight}`);

  // Line 2: pass/skip/fail + duration
  if (state.status === 'done') {
    const parts = [];
    if (state.passed > 0) parts.push(c.dim(c.green(`✓ ${state.passed} passed`)));
    if (state.skipped > 0) parts.push(c.dim(c.yellow(`⊘ ${state.skipped} skipped`)));
    if (state.failed > 0) parts.push(c.red(`✗ ${state.failed} failed`));
    const durationStr =
      state.duration < 1 ? `${(state.duration * 1000).toFixed(0)}ms` : `${state.duration.toFixed(2)}s`;
    const summaryLeft = ` ${parts.join('  ')}`;
    const summaryRight = c.dim(durationStr);
    const gap2 = Math.max(1, cols - stripAnsi(summaryLeft).length - stripAnsi(summaryRight).length);
    process.stdout.write(term.clearLine);
    console.log(`${summaryLeft}${' '.repeat(gap2)}${summaryRight}`);
  } else {
    process.stdout.write(term.clearLine);
    console.log('');
  }

  // Line 3: blank
  process.stdout.write(term.clearLine);
  console.log('');

  // Line 4: tab bar
  const testsLabel = currentPage === 'tests' ? c.bold('[Tests]') : 'Tests';
  // Coverage tab: active state based on current page, dimmed only if disabled AND not selected
  let coverageLabel;
  if (currentPage === 'coverage') {
    coverageLabel = c.bold('[Coverage]');
  } else if (coverageEnabled) {
    coverageLabel = 'Coverage';
  } else {
    coverageLabel = c.dim('Coverage');
  }

  let tabLine = `  ${testsLabel}  ${coverageLabel}`;

  // Threshold info on coverage page
  if (currentPage === 'coverage' && thresholds) {
    const parts = [];
    if (thresholds.lines !== undefined) parts.push(thresholds.lines);
    if (thresholds.branches !== undefined) parts.push(thresholds.branches);
    if (thresholds.functions !== undefined) parts.push(thresholds.functions);
    if (parts.length > 0) {
      const thStr = c.dim(`Threshold: ${parts.join('/')}`);
      const gap = Math.max(1, cols - stripAnsi(tabLine).length - stripAnsi(thStr).length - 1);
      tabLine += `${' '.repeat(gap)}${thStr}`;
    }
  }

  process.stdout.write(term.clearLine);
  console.log(tabLine);

  // Line 5: separator
  process.stdout.write(term.clearLine);
  console.log(c.dim(`  ${'─'.repeat(cols - 3)}`));
}

/**
 * Number of fixed header lines (for content area calculation).
 */
export const HEADER_LINES = 5;

/**
 * Number of fixed footer lines.
 */
export const FOOTER_LINES = 1;
