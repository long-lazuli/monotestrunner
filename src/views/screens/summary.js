/**
 * Summary screen renderer.
 *
 * Renders the main package table with test results and coverage columns.
 * Coverage columns are always shown in interactive mode.
 * Packages with coverage disabled show centered 'off'.
 *
 * Pure rendering — writes to stdout, does not mutate state.
 */

import c from 'picocolors';
import {
  term,
  spinnerFrames,
  formatNum,
  formatDuration,
  formatColoredColumns,
  formatCoveragePct,
} from '../../ui.js';

const COV_COL_WIDTH = 8;
const COV_SECTION_WIDTH = COV_COL_WIDTH * 3;
const DUR_SECTION_WIDTH = 10;

/**
 * Render the full summary screen.
 *
 * @param {object} opts
 * @param {Array} opts.packages - Package list
 * @param {object} opts.states - { [pkgName]: state } map
 * @param {object} opts.coverageFlags - { [pkgName]: boolean }
 * @param {object} opts.summaryState - viewState.summary
 * @param {boolean} opts.cursorDimmed - Global cursor dim state
 * @param {number} opts.spinnerIdx - Spinner frame index
 * @param {boolean} opts.watchEnabled - Watch mode active
 * @param {string} opts.statusMessage - Status bar message
 */
export function renderSummary({ packages, states, coverageFlags, summaryState, cursorDimmed, spinnerIdx, watchEnabled, statusMessage }) {
  const nameWidth = Math.max(20, ...packages.map((p) => p.name.length + (p.runner || '').length + 3));
  const sep = c.dim('│');

  process.stdout.write(term.moveTo(1, 1));

  // Title
  const modeLabel = watchEnabled ? `(${c.yellow('watching')})` : '(interactive)';
  process.stdout.write(term.clearLine);
  console.log(`${c.bold(c.cyan('Test & Coverage Summary'))} ${c.dim(modeLabel)}\n`);

  // Section label row (coverage group header)
  const leftWidth = nameWidth + 31;
  const covWidth = COV_SECTION_WIDTH + 2; // +2 for padding around │
  const durWidth = DUR_SECTION_WIDTH + 1;
  const covLabel = 'Coverage';
  const covLabelPad = Math.floor((covWidth - covLabel.length) / 2);
  process.stdout.write(term.clearLine);
  console.log(c.dim(`    ${' '.repeat(leftWidth)}│${' '.repeat(covLabelPad)}${covLabel}${' '.repeat(covWidth - covLabelPad - covLabel.length)}│`));

  // Header row
  const headerLeft = `    ${'Package'.padEnd(nameWidth)}${'Files'.padStart(6)}${'Tests'.padStart(6)}${'Pass'.padStart(6)}${'Skip'.padStart(6)}${'Fail'.padStart(6)}`;
  const headerCov = `${'Lines'.padStart(COV_COL_WIDTH)}${'Branch'.padStart(COV_COL_WIDTH)}${'Funcs'.padStart(COV_COL_WIDTH)}`;
  const headerDur = `${'Duration'.padStart(DUR_SECTION_WIDTH)}`;
  console.log(c.dim(`${headerLeft} │ ${headerCov} │ ${headerDur}`));

  // Separator
  console.log(c.dim(`    ${'─'.repeat(leftWidth)}┼${'─'.repeat(covWidth)}┼${'─'.repeat(durWidth)}`));

  // Package rows
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const state = states[pkg.name];
    const selected = i === summaryState.selectedIndex;
    const covEnabled = coverageFlags[pkg.name];

    process.stdout.write(term.clearLine);
    console.log(renderSummaryRow(pkg, state, spinnerIdx, nameWidth, selected, cursorDimmed, covEnabled));
  }

  // Separator
  console.log(c.dim(`    ${'─'.repeat(leftWidth)}┼${'─'.repeat(covWidth)}┼${'─'.repeat(durWidth)}`));

  // Totals
  process.stdout.write(term.clearLine);
  console.log(renderSummaryTotals(states, coverageFlags, nameWidth));

  // Status lines
  console.log();
  process.stdout.write(term.clearLine);
  console.log(c.dim(`    ${statusMessage || ' '}`));
  process.stdout.write(term.clearLine);
  console.log(c.dim('    ↑↓:navigate  →:open  r:rerun  R:rerun all  c:coverage  C:all coverage  w:watch  ?:help  q:quit'));
}

/**
 * Render a single summary row.
 */
function renderSummaryRow(pkg, state, spinnerIdx, nameWidth, selected, cursorDimmed, covEnabled) {
  const runnerLabel = pkg.runner || '';
  const runnerSuffix = runnerLabel ? ` ${c.gray(`(${runnerLabel})`)}` : '';
  const namePadWidth = runnerLabel ? nameWidth - runnerLabel.length - 3 : nameWidth;
  const paddedName = pkg.name.padEnd(namePadWidth);
  const marker = selected ? `  ${cursorDimmed ? c.gray('▶') : '▶'}` : '   ';
  const styledName = selected && !cursorDimmed ? paddedName : c.blue(paddedName);
  const name = `${marker} ${styledName}${runnerSuffix}`;
  const sep = c.dim('│');

  // No test script — dim row with centered message
  if (state.status === 'no-tests') {
    const label = 'no tests';
    const left = c.dim(`${marker} ${paddedName}${runnerSuffix}${centerInCols(label, 30)}`);
    const cov = formatOffCov();
    const dur = c.dim(formatDuration(null));
    return `${left} ${sep} ${cov} ${sep} ${dur}`;
  }

  // Has a test script but runner not recognized — dim row with warning
  if (state.status === 'unknown-runner') {
    const label = 'unknown runner';
    const left = c.dim(`${marker} ${paddedName}${runnerSuffix}${centerInCols(label, 30)}`);
    const cov = formatOffCov();
    const dur = c.dim(formatDuration(null));
    return `${left} ${sep} ${cov} ${sep} ${dur}`;
  }

  if (state.status === 'pending') {
    const left = c.dim(
      `${marker} ${paddedName}${runnerSuffix}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatNum(null)}`,
    );
    const cov = covEnabled ? formatPendingCov() : formatOffCov();
    const dur = c.dim(formatDuration(null));
    return `${left} ${sep} ${cov} ${sep} ${dur}`;
  }

  if (state.status === 'running') {
    const frame = spinnerFrames[spinnerIdx % spinnerFrames.length];
    const { passStr, skipStr, failStr } = formatColoredColumns(state.passed, state.skipped, state.failed);
    const left = `${name}${c.dim(`${formatNum(null)}${formatNum(null)}`)}${passStr}${skipStr}${failStr}`;
    const cov = covEnabled ? formatPendingCov() : formatOffCov();
    const dur = c.dim(('  ' + frame).padStart(DUR_SECTION_WIDTH));
    return `${left} ${sep} ${cov} ${sep} ${dur}`;
  }

  // Done
  const { passStr, skipStr, failStr } = formatColoredColumns(state.passed, state.skipped, state.failed);
  const left = `${name}${c.dim(`${formatNum(state.files)}${formatNum(state.tests)}`)}${passStr}${skipStr}${failStr}`;
  const cov = covEnabled ? formatCoverageCols(state.coverage) : formatOffCov();
  const dur = c.dim(formatDuration(state.duration));
  return `${left} ${sep} ${cov} ${sep} ${dur}`;
}

/**
 * Format coverage columns when coverage data is available.
 */
function formatCoverageCols(coverage) {
  if (!coverage) return formatPendingCov();
  const th = coverage.thresholds || {};
  const lines = formatCoveragePct(coverage.lines, COV_COL_WIDTH, th.lines);
  const branches = formatCoveragePct(coverage.branches, COV_COL_WIDTH, th.branches);
  const functions = formatCoveragePct(coverage.functions, COV_COL_WIDTH, th.functions);
  return `${lines.text}${branches.text}${functions.text}`;
}

/**
 * Format coverage columns as pending (loading).
 */
function formatPendingCov() {
  return `${c.dim('-'.padStart(COV_COL_WIDTH))}${c.dim('-'.padStart(COV_COL_WIDTH))}${c.dim('-'.padStart(COV_COL_WIDTH))}`;
}

/**
 * Center a label within a fixed-width column span.
 * @param {string} label - Text to center
 * @param {number} width - Total width to fill
 * @returns {string}
 */
function centerInCols(label, width) {
  const padLeft = Math.floor((width - label.length) / 2);
  const padRight = width - label.length - padLeft;
  return `${' '.repeat(padLeft)}${label}${' '.repeat(padRight)}`;
}

/**
 * Format coverage columns as 'off' — centered across the 3-column span.
 */
function formatOffCov() {
  return c.dim(centerInCols('off', COV_SECTION_WIDTH));
}

/**
 * Render the totals row.
 */
function renderSummaryTotals(states, coverageFlags, nameWidth) {
  const totals = { files: 0, tests: 0, passed: 0, skipped: 0, failed: 0, duration: 0 };
  let hasAnyDone = false;

  const covTotals = { linesSum: 0, linesCount: 0, branchesSum: 0, branchesCount: 0, functionsSum: 0, functionsCount: 0 };
  const allStatuses = { lines: [], branches: [], functions: [] };

  for (const [pkgName, state] of Object.entries(states)) {
    totals.passed += state.passed || 0;
    totals.skipped += state.skipped || 0;
    totals.failed += state.failed || 0;

    if (state.status === 'done') {
      hasAnyDone = true;
      totals.files += state.files || 0;
      totals.tests += state.tests || 0;
      totals.duration += state.duration || 0;

      if (coverageFlags[pkgName] && state.coverage) {
        const th = state.coverage.thresholds || {};
        const ls = formatCoveragePct(state.coverage.lines, COV_COL_WIDTH, th.lines);
        const bs = formatCoveragePct(state.coverage.branches, COV_COL_WIDTH, th.branches);
        const fs = formatCoveragePct(state.coverage.functions, COV_COL_WIDTH, th.functions);
        allStatuses.lines.push(ls.status);
        allStatuses.branches.push(bs.status);
        allStatuses.functions.push(fs.status);

        if (state.coverage.lines && state.coverage.lines !== '-') {
          covTotals.linesSum += parseFloat(state.coverage.lines);
          covTotals.linesCount++;
        }
        if (state.coverage.branches && state.coverage.branches !== '-') {
          covTotals.branchesSum += parseFloat(state.coverage.branches);
          covTotals.branchesCount++;
        }
        if (state.coverage.functions && state.coverage.functions !== '-') {
          covTotals.functionsSum += parseFloat(state.coverage.functions);
          covTotals.functionsCount++;
        }
      }
    }
  }

  const filesStr = hasAnyDone ? formatNum(totals.files) : formatNum(null);
  const testsStr = hasAnyDone ? formatNum(totals.tests) : formatNum(null);
  const { passStr, skipStr, failStr } = formatColoredColumns(totals.passed, totals.skipped, totals.failed, true);
  const left = `    ${c.bold('Total'.padEnd(nameWidth))}${filesStr}${testsStr}${passStr}${skipStr}${failStr}`;

  let covText;
  if (covTotals.linesCount > 0 || covTotals.branchesCount > 0 || covTotals.functionsCount > 0) {
    const avgL = covTotals.linesCount ? (covTotals.linesSum / covTotals.linesCount).toFixed(1) : '-';
    const avgB = covTotals.branchesCount ? (covTotals.branchesSum / covTotals.branchesCount).toFixed(1) : '-';
    const avgF = covTotals.functionsCount ? (covTotals.functionsSum / covTotals.functionsCount).toFixed(1) : '-';

    const aggStatus = (arr) => {
      const real = arr.filter((s) => s !== 'none');
      if (real.length === 0) return 'none';
      if (real.includes('red')) return 'red';
      if (real.includes('yellow')) return 'yellow';
      return 'green';
    };

    const colorBy = (formatted, status) => {
      if (status === 'red') return c.red(formatted);
      if (status === 'yellow') return c.yellow(formatted);
      if (status === 'green') return c.dim(c.green(formatted));
      return c.dim(formatted);
    };

    const lStr =
      avgL === '-' ? c.dim('-'.padStart(COV_COL_WIDTH)) : colorBy((avgL + '%').padStart(COV_COL_WIDTH), aggStatus(allStatuses.lines));
    const bStr =
      avgB === '-'
        ? c.dim('-'.padStart(COV_COL_WIDTH))
        : colorBy((avgB + '%').padStart(COV_COL_WIDTH), aggStatus(allStatuses.branches));
    const fStr =
      avgF === '-'
        ? c.dim('-'.padStart(COV_COL_WIDTH))
        : colorBy((avgF + '%').padStart(COV_COL_WIDTH), aggStatus(allStatuses.functions));

    covText = `${lStr}${bStr}${fStr}`;
  } else {
    covText = formatPendingCov();
  }

  const dur = hasAnyDone ? c.dim(formatDuration(totals.duration)) : c.dim(formatDuration(null));
  const sep = c.dim('│');

  return `${left} ${sep} ${covText} ${sep} ${dur}`;
}
