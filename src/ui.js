/**
 * UI utilities for test summary
 * Colors via picocolors, terminal control via raw ANSI
 */

import c from 'picocolors';
import cliSpinners from 'cli-spinners';

// Terminal control codes (picocolors doesn't handle these)
export const term = {
  clearLine: '\x1b[K',
  clearScreen: '\x1b[2J',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  moveUp: (n) => `\x1b[${n}A`,
  moveTo: (row, col) => `\x1b[${row};${col}H`,
};



// Spinner from cli-spinners
export const spinner = cliSpinners.dots;
export const spinnerFrames = spinner.frames;

/**
 * Strip ANSI escape codes from string
 */
export function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Format a number for display, right-aligned
 */
export function formatNum(n, width = 6) {
  if (n === null || n === undefined) return '-'.padStart(width);
  return String(n).padStart(width);
}

/**
 * Format duration for display
 */
export function formatDuration(seconds, width = 10) {
  if (seconds === null || seconds === undefined) return '-'.padStart(width);
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`.padStart(width);
  return `${seconds.toFixed(2)}s`.padStart(width);
}

/**
 * Format pass/skip/fail columns with colors
 * Pass: dim when > 0 | Skip/Fail: dim when 0 | Total row: never dim
 */
export function formatColoredColumns(passed, skipped, failed, noDim = false) {
  const fmt = (n, color, dimWhenPositive) => {
    const styled = color(formatNum(n));
    const shouldDim = !noDim && (dimWhenPositive ? n > 0 : n === 0);
    return shouldDim ? c.dim(styled) : styled;
  };
  return {
    passStr: fmt(passed, c.green, true),
    skipStr: fmt(skipped, c.yellow, false),
    failStr: fmt(failed, c.red, false),
  };
}

/**
 * Create initial state for a package
 */
export function createInitialState() {
  return {
    status: 'pending',
    passed: 0,
    skipped: 0,
    failed: 0,
    files: null,
    tests: null,
    duration: null,
    exitCode: null,
    output: '',
  };
}

/**
 * Format package name with runner suffix
 */
function formatPkgName(pkg, nameWidth) {
  const paddedName = pkg.name.padEnd(nameWidth - pkg.runner.length - 3); // -3 for " ()"
  return `${c.blue(paddedName)} ${c.gray(`(${pkg.runner})`)}`;
}

/**
 * Render a single row for a package (non-interactive mode)
 */
export function renderRow(pkg, state, spinnerIdx, nameWidth) {
  const name = `  ${formatPkgName(pkg, nameWidth)}`;
  const paddedName = pkg.name.padEnd(nameWidth - pkg.runner.length - 3);

  if (state.status === 'pending') {
    return c.dim(`  ${paddedName} ${c.gray(`(${pkg.runner})`)}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatDuration(null)}`);
  }

  if (state.status === 'running') {
    const spinner = spinnerFrames[spinnerIdx % spinnerFrames.length];
    const { passStr, skipStr, failStr } = formatColoredColumns(state.passed, state.skipped, state.failed);
    return `${name}${c.dim(`${formatNum(null)}${formatNum(null)}`)}${passStr}${skipStr}${failStr}${c.dim(('  ' + spinner).padStart(10))}`;
  }

  // Done
  const { passStr, skipStr, failStr } = formatColoredColumns(state.passed, state.skipped, state.failed);
  return `${name}${c.dim(`${formatNum(state.files)}${formatNum(state.tests)}`)}${passStr}${skipStr}${failStr}${c.dim(formatDuration(state.duration))}`;
}

/**
 * Render the totals row (non-interactive mode)
 */
export function renderTotals(states, nameWidth) {
  const totals = { files: 0, tests: 0, passed: 0, skipped: 0, failed: 0, duration: 0 };
  let hasAnyDone = false;

  for (const state of Object.values(states)) {
    totals.passed += state.passed || 0;
    totals.skipped += state.skipped || 0;
    totals.failed += state.failed || 0;

    if (state.status === 'done') {
      hasAnyDone = true;
      totals.files += state.files || 0;
      totals.tests += state.tests || 0;
      totals.duration += state.duration || 0;
    }
  }

  const filesStr = hasAnyDone ? formatNum(totals.files) : formatNum(null);
  const testsStr = hasAnyDone ? formatNum(totals.tests) : formatNum(null);
  const durationStr = hasAnyDone ? formatDuration(totals.duration) : formatDuration(null);
  const { passStr, skipStr, failStr } = formatColoredColumns(totals.passed, totals.skipped, totals.failed, true);

  return `  ${c.bold('Total'.padEnd(nameWidth))}${filesStr}${testsStr}${passStr}${skipStr}${failStr}${durationStr}`;
}

/**
 * Render a row in interactive mode
 */
export function renderInteractiveRow(pkg, state, spinnerIdx, nameWidth, selected = false, cursorDimmed = false) {
  const paddedName = pkg.name.padEnd(nameWidth - pkg.runner.length - 3); // -3 for " ()"
  const runnerSuffix = c.gray(`(${pkg.runner})`);
  
  // Marker: dimmed grey when cursor dimmed, bright when active
  const marker = selected 
    ? (cursorDimmed ? c.gray('▶') : '▶')
    : ' ';
  
  // Name: white when selected+active, blue otherwise
  const styledName = selected && !cursorDimmed 
    ? paddedName 
    : c.blue(paddedName);

  const name = `${marker} ${styledName} ${runnerSuffix}`;

  if (state.status === 'pending') {
    return c.dim(`${marker} ${paddedName} ${runnerSuffix}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatDuration(null)}`);
  }

  if (state.status === 'running') {
    const frame = spinnerFrames[spinnerIdx % spinnerFrames.length];
    const { passStr, skipStr, failStr } = formatColoredColumns(state.passed, state.skipped, state.failed);
    return `${name}${c.dim(`${formatNum(null)}${formatNum(null)}`)}${passStr}${skipStr}${failStr}${c.dim(('  ' + frame).padStart(10))}`;
  }

  // Done
  const { passStr, skipStr, failStr } = formatColoredColumns(state.passed, state.skipped, state.failed);
  return `${name}${c.dim(`${formatNum(state.files)}${formatNum(state.tests)}`)}${passStr}${skipStr}${failStr}${c.dim(formatDuration(state.duration))}`;
}

// ============================================================================
// Coverage-Inline Functions (unified test + coverage table)
// ============================================================================

// Layout: Package  Files Tests  Pass  Skip  Fail │  Lines  Branch   Funcs │ Duration
const COV_COL_WIDTH = 8;
const COV_SECTION_WIDTH = COV_COL_WIDTH * 3;
const DUR_SECTION_WIDTH = 10;

/**
 * Format coverage columns with threshold-aware coloring.
 * @param {object|null} coverage - Coverage data with lines/branches/functions and optional thresholds
 * @param {boolean} isPending - Whether data is still loading
 * @returns {{ text: string, statuses: string[] }} - Formatted text and per-column statuses
 */
function formatCoverageColumns(coverage, isPending = false) {
  if (isPending || !coverage) {
    return {
      text: `${c.dim('-'.padStart(COV_COL_WIDTH))}${c.dim('-'.padStart(COV_COL_WIDTH))}${c.dim('-'.padStart(COV_COL_WIDTH))}`,
      statuses: ['none', 'none', 'none'],
    };
  }
  const th = coverage.thresholds || {};
  const lines = formatCoveragePct(coverage.lines, COV_COL_WIDTH, th.lines);
  const branches = formatCoveragePct(coverage.branches, COV_COL_WIDTH, th.branches);
  const functions = formatCoveragePct(coverage.functions, COV_COL_WIDTH, th.functions);
  return {
    text: `${lines.text}${branches.text}${functions.text}`,
    statuses: [lines.status, branches.status, functions.status],
  };
}

/**
 * Render header row with coverage columns
 * Layout: Package  Files Tests  Pass  Skip  Fail │  Lines  Branch   Funcs │ Duration
 */
export function renderInteractiveHeaderWithCoverage(nameWidth) {
  const left = `  ${'Package'.padEnd(nameWidth)}${'Files'.padStart(6)}${'Tests'.padStart(6)}${'Pass'.padStart(6)}${'Skip'.padStart(6)}${'Fail'.padStart(6)}`;
  const cov = `${'Lines'.padStart(COV_COL_WIDTH)}${'Branch'.padStart(COV_COL_WIDTH)}${'Funcs'.padStart(COV_COL_WIDTH)}`;
  const dur = `${'Duration'.padStart(DUR_SECTION_WIDTH)}`;
  return c.dim(`${left} │ ${cov} │ ${dur}`);
}

/**
 * Render separator with coverage section
 * Left width = nameWidth + 2 (indent) + 5*6 (Files..Fail) = nameWidth + 32
 */
export function renderSeparatorWithCoverage(nameWidth) {
  // Left: nameWidth + 5*6 cols + 1 trailing space before │ = nameWidth + 31
  const leftWidth = nameWidth + 31;
  // Coverage: space + 3*8 cols + space = 26
  const covWidth = COV_SECTION_WIDTH + 2;
  // Duration: space + 10 = 11
  const durWidth = DUR_SECTION_WIDTH + 1;
  return c.dim(`  ${'─'.repeat(leftWidth)}┼${'─'.repeat(covWidth)}┼${'─'.repeat(durWidth)}`);
}

/**
 * Render interactive row with inline coverage
 * Layout: marker name  files tests  pass  skip  fail │  lines  branch  funcs │ duration
 */
export function renderInteractiveRowWithCoverage(pkg, state, spinnerIdx, nameWidth, selected = false, cursorDimmed = false) {
  const paddedName = pkg.name.padEnd(nameWidth - pkg.runner.length - 3);
  const runnerSuffix = c.gray(`(${pkg.runner})`);

  const marker = selected
    ? (cursorDimmed ? c.gray('▶') : '▶')
    : ' ';

  const styledName = selected && !cursorDimmed
    ? paddedName
    : c.blue(paddedName);

  const name = `${marker} ${styledName} ${runnerSuffix}`;
  const sep = c.dim('│');

  if (state.status === 'pending') {
    const left = c.dim(`${marker} ${paddedName} ${runnerSuffix}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatNum(null)}${formatNum(null)}`);
    const cov = formatCoverageColumns(null, true).text;
    const dur = c.dim(formatDuration(null));
    return `${left} ${sep} ${cov} ${sep} ${dur}`;
  }

  if (state.status === 'running') {
    const frame = spinnerFrames[spinnerIdx % spinnerFrames.length];
    const { passStr, skipStr, failStr } = formatColoredColumns(state.passed, state.skipped, state.failed);
    const left = `${name}${c.dim(`${formatNum(null)}${formatNum(null)}`)}${passStr}${skipStr}${failStr}`;
    const cov = formatCoverageColumns(null, true).text;
    const dur = c.dim(('  ' + frame).padStart(DUR_SECTION_WIDTH));
    return `${left} ${sep} ${cov} ${sep} ${dur}`;
  }

  // Done
  const { passStr, skipStr, failStr } = formatColoredColumns(state.passed, state.skipped, state.failed);
  const left = `${name}${c.dim(`${formatNum(state.files)}${formatNum(state.tests)}`)}${passStr}${skipStr}${failStr}`;
  const cov = formatCoverageColumns(state.coverage).text;
  const dur = c.dim(formatDuration(state.duration));
  return `${left} ${sep} ${cov} ${sep} ${dur}`;
}

/**
 * Aggregate status: red if any red, yellow if any yellow, green if all green.
 * @param {string[]} statuses - Array of 'red'|'yellow'|'green'|'none'
 * @returns {'red'|'yellow'|'green'|'none'}
 */
function aggregateStatus(statuses) {
  const real = statuses.filter(s => s !== 'none');
  if (real.length === 0) return 'none';
  if (real.includes('red')) return 'red';
  if (real.includes('yellow')) return 'yellow';
  return 'green';
}

/**
 * Color a formatted percentage string according to an aggregate status.
 */
function colorByStatus(formatted, status) {
  if (status === 'red') return c.red(formatted);
  if (status === 'yellow') return c.yellow(formatted);
  if (status === 'green') return c.dim(c.green(formatted));
  return c.dim(formatted);
}

/**
 * Render totals row with inline coverage.
 * Total color per column: green if all packages green, yellow if any yellow, red if any red.
 */
export function renderTotalsWithCoverage(states, nameWidth) {
  const totals = { files: 0, tests: 0, passed: 0, skipped: 0, failed: 0, duration: 0 };
  let hasAnyDone = false;

  const covTotals = {
    linesSum: 0, linesCount: 0,
    branchesSum: 0, branchesCount: 0,
    functionsSum: 0, functionsCount: 0,
  };

  // Collect per-column statuses from all packages
  const allLinesStatuses = [];
  const allBranchesStatuses = [];
  const allFunctionsStatuses = [];

  for (const state of Object.values(states)) {
    totals.passed += state.passed || 0;
    totals.skipped += state.skipped || 0;
    totals.failed += state.failed || 0;

    if (state.status === 'done') {
      hasAnyDone = true;
      totals.files += state.files || 0;
      totals.tests += state.tests || 0;
      totals.duration += state.duration || 0;

      if (state.coverage) {
        // Get per-package statuses
        const th = state.coverage.thresholds || {};
        const ls = formatCoveragePct(state.coverage.lines, COV_COL_WIDTH, th.lines);
        const bs = formatCoveragePct(state.coverage.branches, COV_COL_WIDTH, th.branches);
        const fs = formatCoveragePct(state.coverage.functions, COV_COL_WIDTH, th.functions);
        allLinesStatuses.push(ls.status);
        allBranchesStatuses.push(bs.status);
        allFunctionsStatuses.push(fs.status);

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

  const left = `  ${c.bold('Total'.padEnd(nameWidth))}${filesStr}${testsStr}${passStr}${skipStr}${failStr}`;

  let covText;
  if (hasAnyDone) {
    const avgLines = covTotals.linesCount ? (covTotals.linesSum / covTotals.linesCount).toFixed(1) : '-';
    const avgBranches = covTotals.branchesCount ? (covTotals.branchesSum / covTotals.branchesCount).toFixed(1) : '-';
    const avgFunctions = covTotals.functionsCount ? (covTotals.functionsSum / covTotals.functionsCount).toFixed(1) : '-';

    const linesStatus = aggregateStatus(allLinesStatuses);
    const branchesStatus = aggregateStatus(allBranchesStatuses);
    const functionsStatus = aggregateStatus(allFunctionsStatuses);

    const linesStr = avgLines === '-'
      ? c.dim('-'.padStart(COV_COL_WIDTH))
      : colorByStatus((avgLines + '%').padStart(COV_COL_WIDTH), linesStatus);
    const branchStr = avgBranches === '-'
      ? c.dim('-'.padStart(COV_COL_WIDTH))
      : colorByStatus((avgBranches + '%').padStart(COV_COL_WIDTH), branchesStatus);
    const funcsStr = avgFunctions === '-'
      ? c.dim('-'.padStart(COV_COL_WIDTH))
      : colorByStatus((avgFunctions + '%').padStart(COV_COL_WIDTH), functionsStatus);

    covText = `${linesStr}${branchStr}${funcsStr}`;
  } else {
    covText = formatCoverageColumns(null, true).text;
  }

  const dur = hasAnyDone ? c.dim(formatDuration(totals.duration)) : c.dim(formatDuration(null));
  const sep = c.dim('│');

  return `${left} ${sep} ${covText} ${sep} ${dur}`;
}

/**
 * Render the help overlay
 */
export function renderHelp(lineWidth) {
  const lines = [
    '',
    '  Keyboard Shortcuts',
    '  ──────────────────',
    '',
    '  Navigation',
    '    ↑/k       Move selection up',
    '    ↓/j       Move selection down',
    '    →/l       Open package detail view',
    '',
    '  Run Tests',
    '    r/Enter   Rerun selected package',
    '    a         Rerun all packages',
    '',
    '  Modes',
    '    c         Toggle coverage',
    '    w         Toggle watch mode',
    '',
    '  Other',
    '    h         Show this help',
    '    q         Quit',
    '',
    '  Press any key to close...',
    '',
  ];

  // Clear screen and draw help
  process.stdout.write(term.clearScreen + term.moveTo(1, 1));

  const boxWidth = Math.max(40, lineWidth);
  const topBorder = '┌' + '─'.repeat(boxWidth - 2) + '┐';
  const bottomBorder = '└' + '─'.repeat(boxWidth - 2) + '┘';

  console.log(topBorder);
  for (const line of lines) {
    const paddedLine = line.padEnd(boxWidth - 4);
    console.log('│ ' + paddedLine + ' │');
  }
  console.log(bottomBorder);
}

/**
 * Print table header
 */
export function printHeader(nameWidth, lineWidth, title = 'Test Summary', subtitle = null) {
  const subtitleStr = subtitle ? ` ${c.dim(subtitle)}` : '';
  console.log(`\n${c.bold(c.cyan(title))}${subtitleStr}\n`);
  console.log(c.dim(`  ${'Package'.padEnd(nameWidth)}${'Files'.padStart(6)}${'Tests'.padStart(6)}${'Pass'.padStart(6)}${'Skip'.padStart(6)}${'Fail'.padStart(6)}${'Duration'.padStart(10)}`));
  console.log(`  ${c.dim('─'.repeat(lineWidth - 2))}`);
}

/**
 * Print separator line
 */
export function printSeparator(lineWidth) {
  console.log(`  ${c.dim('─'.repeat(lineWidth - 2))}`);
}

/**
 * Print final summary message
 */
export function printSummary(failed) {
  console.log();
  if (failed > 0) {
    console.log(`  ${c.red(`✗ ${failed} test(s) failed`)}\n`);
  } else {
    console.log(`  ${c.green('✓ All tests passed')}\n`);
  }
}

// ============================================================================
// Coverage UI Functions
// ============================================================================

/**
 * Format coverage percentage with threshold-aware coloring.
 *
 * Color rules:
 *   - Below threshold → red
 *   - Exactly at threshold → yellow
 *   - Above threshold → green dim
 *   - No threshold set → yellow dim
 *
 * @param {string} pct - Percentage string or '-'
 * @param {number} width - Column width (default 7)
 * @param {number|undefined} threshold - Threshold value from config, or undefined
 * @returns {{ text: string, status: 'red'|'yellow'|'green'|'none' }}
 */
export function formatCoveragePct(pct, width = 7, threshold = undefined) {
  if (pct === '-' || pct === null || pct === undefined) {
    return { text: c.dim('-'.padStart(width)), status: 'none' };
  }
  const num = parseFloat(pct);
  const formatted = (pct + '%').padStart(width);

  if (threshold === undefined || threshold === null) {
    // No threshold configured
    return { text: c.dim(c.yellow(formatted)), status: 'yellow' };
  }

  if (num < threshold) {
    return { text: c.red(formatted), status: 'red' };
  }
  if (num === threshold && num < 100) {
    return { text: c.yellow(formatted), status: 'yellow' };
  }
  // Above threshold, or exactly at 100%
  return { text: c.dim(c.green(formatted)), status: 'green' };
}

/**
 * Create initial coverage state for a package
 */
export function createInitialCoverageState() {
  return {
    lines: null,
    branches: null,
    functions: null,
    status: 'pending', // pending, loading, done
  };
}

/**
 * Render coverage table header
 * @param {number} nameWidth - Width for package name column
 */
export function renderCoverageHeader(nameWidth) {
  return c.dim(`  ${'Package'.padEnd(nameWidth)}${'Lines'.padStart(8)}${'Branch'.padStart(8)}${'Funcs'.padStart(8)}`);
}

/**
 * Render a single coverage row
 * @param {string} pkgName - Package name
 * @param {object} coverageState - Coverage state object (with optional thresholds)
 * @param {number} nameWidth - Width for package name column
 * @returns {{ text: string, statuses: string[] }}
 */
export function renderCoverageRow(pkgName, coverageState, nameWidth) {
  const name = `  ${c.blue(pkgName.padEnd(nameWidth))}`;
  
  if (!coverageState || coverageState.status === 'pending') {
    return {
      text: c.dim(`  ${pkgName.padEnd(nameWidth)}${'-'.padStart(8)}${'-'.padStart(8)}${'-'.padStart(8)}`),
      statuses: ['none', 'none', 'none'],
    };
  }
  
  if (coverageState.status === 'loading') {
    return {
      text: `${name}${c.dim('...'.padStart(8))}${c.dim('...'.padStart(8))}${c.dim('...'.padStart(8))}`,
      statuses: ['none', 'none', 'none'],
    };
  }
  
  const th = coverageState.thresholds || {};
  const lines = formatCoveragePct(coverageState.lines, 8, th.lines);
  const branch = formatCoveragePct(coverageState.branches, 8, th.branches);
  const funcs = formatCoveragePct(coverageState.functions, 8, th.functions);
  
  return {
    text: `${name}${lines.text}${branch.text}${funcs.text}`,
    statuses: [lines.status, branch.status, funcs.status],
  };
}

/**
 * Render coverage totals row with aggregate status coloring.
 * @param {object} coverageStates - Map of package name to coverage state
 * @param {Array<string[]>} allRowStatuses - Array of per-row [lines, branches, functions] statuses
 * @param {number} nameWidth - Width for package name column
 */
export function renderCoverageTotals(coverageStates, allRowStatuses, nameWidth) {
  const totals = {
    linesHit: 0, linesTotal: 0,
    branchesHit: 0, branchesTotal: 0,
    functionsHit: 0, functionsTotal: 0,
  };
  
  let hasAny = false;
  
  for (const state of Object.values(coverageStates)) {
    if (!state || state.status !== 'done') continue;
    hasAny = true;
    
    if (state.lines && state.lines !== '-') {
      totals.linesHit += parseFloat(state.lines);
      totals.linesTotal += 1;
    }
    if (state.branches && state.branches !== '-') {
      totals.branchesHit += parseFloat(state.branches);
      totals.branchesTotal += 1;
    }
    if (state.functions && state.functions !== '-') {
      totals.functionsHit += parseFloat(state.functions);
      totals.functionsTotal += 1;
    }
  }
  
  const avgLines = totals.linesTotal ? (totals.linesHit / totals.linesTotal).toFixed(1) : '-';
  const avgBranches = totals.branchesTotal ? (totals.branchesHit / totals.branchesTotal).toFixed(1) : '-';
  const avgFunctions = totals.functionsTotal ? (totals.functionsHit / totals.functionsTotal).toFixed(1) : '-';

  // Aggregate statuses across all rows per column
  const linesStatus = aggregateStatus(allRowStatuses.map(s => s[0]));
  const branchesStatus = aggregateStatus(allRowStatuses.map(s => s[1]));
  const functionsStatus = aggregateStatus(allRowStatuses.map(s => s[2]));

  const linesStr = hasAny && avgLines !== '-'
    ? colorByStatus((avgLines + '%').padStart(8), linesStatus)
    : c.dim('-'.padStart(8));
  const branchStr = hasAny && avgBranches !== '-'
    ? colorByStatus((avgBranches + '%').padStart(8), branchesStatus)
    : c.dim('-'.padStart(8));
  const funcsStr = hasAny && avgFunctions !== '-'
    ? colorByStatus((avgFunctions + '%').padStart(8), functionsStatus)
    : c.dim('-'.padStart(8));
  
  return `  ${c.bold('Total'.padEnd(nameWidth))}${linesStr}${branchStr}${funcsStr}`;
}

/**
 * Print coverage table (for non-interactive mode)
 * @param {Array} packages - Package list
 * @param {object} coverageStates - Map of package name to coverage state
 * @param {number} nameWidth - Width for package name column
 */
export function printCoverageTable(packages, coverageStates, nameWidth) {
  const lineWidth = nameWidth + 2 + 8 + 8 + 8;
  
  console.log(`\n${c.bold(c.cyan('Coverage Summary'))}\n`);
  console.log(renderCoverageHeader(nameWidth));
  console.log(`  ${c.dim('─'.repeat(lineWidth - 2))}`);
  
  const allRowStatuses = [];
  for (const pkg of packages) {
    const row = renderCoverageRow(pkg.name, coverageStates[pkg.name], nameWidth);
    console.log(row.text);
    allRowStatuses.push(row.statuses);
  }
  
  console.log(`  ${c.dim('─'.repeat(lineWidth - 2))}`);
  console.log(renderCoverageTotals(coverageStates, allRowStatuses, nameWidth));
}

/**
 * Print verbose coverage (per-file details)
 * @param {object} verboseData - Data from getVerboseCoverageData
 */
export function printVerboseCoverage(verboseData) {
  const { packageDisplayData, fileWidth } = verboseData;
  
  console.log(`\n${c.bold(c.cyan('Coverage Details'))}\n`);
  
  for (const { name, relevantFiles, displayPaths, stats, thresholds } of packageDisplayData) {
    const th = thresholds || {};
    const lines = formatCoveragePct(stats.lines, 8, th.lines);
    const branch = formatCoveragePct(stats.branches, 8, th.branches);
    const funcs = formatCoveragePct(stats.functions, 8, th.functions);
    
    console.log(`${c.bold(name.padEnd(fileWidth + 2))}  ${lines.text}  ${branch.text}  ${funcs.text}`);
    console.log(c.dim('─'.repeat(fileWidth + 30)));
    
    for (let i = 0; i < relevantFiles.length; i++) {
      const f = relevantFiles[i];
      const relPath = displayPaths[i];
      const fLines = f.linesTotal ? ((f.linesHit / f.linesTotal) * 100).toFixed(1) : '-';
      const fBranches = f.branchesTotal ? ((f.branchesHit / f.branchesTotal) * 100).toFixed(1) : '-';
      const fFunctions = f.functionsTotal ? ((f.functionsHit / f.functionsTotal) * 100).toFixed(1) : '-';
      
      const fl = formatCoveragePct(fLines, 8, th.lines);
      const fb = formatCoveragePct(fBranches, 8, th.branches);
      const ff = formatCoveragePct(fFunctions, 8, th.functions);
      
      console.log(
        `  ${c.dim(relPath.padEnd(fileWidth))}  ${fl.text}  ${fb.text}  ${ff.text}`
      );
    }
    console.log();
  }
}

/**
 * Print merged coverage file info
 * @param {object} mergedInfo - Object with path and sizeKb
 */
export function printMergedCoverageInfo(mergedInfo) {
  if (mergedInfo) {
    console.log(`${c.green('✓')} Merged: coverage/lcov.info (${mergedInfo.sizeKb} KB)\n`);
  } else {
    console.log(`${c.red('✗')} Failed to merge coverage files\n`);
  }
}
