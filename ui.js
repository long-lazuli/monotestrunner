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
    '',
    '  Run Tests',
    '    r/Enter   Rerun selected package',
    '    a         Rerun all packages',
    '',
    '  Other',
    '    w         Toggle watch mode',
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
