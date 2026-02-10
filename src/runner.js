/**
 * Test runner for non-interactive modes (TTY and CI)
 * Handles spawning test processes and displaying results
 */

import { spawn } from 'node:child_process';
import c from 'picocolors';
import {
  term,
  createInitialState,
  renderRow,
  renderTotals,
  printHeader,
  printSeparator,
  printSummary,
  printVerboseCoverage,
  renderInteractiveRowWithCoverage,
  renderInteractiveHeaderWithCoverage,
  renderSeparatorWithCoverage,
  renderTotalsWithCoverage,
} from './ui.js';
import { parseJunitFile } from './parsers.js';
import { getRunner } from './runners/index.js';
import { getPackageCoverage, getVerboseCoverageData } from './coverage.js';
import { join } from 'node:path';

/**
 * Run tests for a package with streaming dot output
 * @param {object} pkg - Package to run tests for
 * @param {object} state - State object for this package
 * @param {Function} onUpdate - Callback when state changes
 * @param {boolean} coverageEnabled - Whether to run with coverage
 */
export function runTestsWithStreaming(pkg, state, onUpdate, coverageEnabled = false) {
  return new Promise((resolve) => {
    const runner = getRunner(pkg.runner);
    if (!runner) {
      state.status = 'unknown-runner';
      onUpdate();
      resolve();
      return;
    }
    const junitPath = join(pkg.path, 'coverage', 'junit.xml');
    const { command, args } = runner.buildCommand({ coverage: coverageEnabled });

    const child = spawn(command, args, {
      cwd: pkg.path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';

    const handleData = (data) => {
      const chunk = data.toString();
      output += chunk;

      const counts = runner.countDots(chunk);
      state.passed += counts.passed;
      state.skipped += counts.skipped;
      state.failed += counts.failed;

      onUpdate();
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      const final = runner.parseFinal(output);

      state.status = 'done';
      state.exitCode = code;
      state.files = final.files;
      state.tests = final.tests;
      state.passed = final.passed;
      state.skipped = final.skipped;
      state.failed = final.failed;
      state.duration = final.duration;
      state.output = output;

      // Parse JUnit results for detail view
      state.testResults = parseJunitFile(junitPath);

      // Get coverage data if coverage is enabled
      if (coverageEnabled) {
        state.coverage = getPackageCoverage(pkg);
      }

      onUpdate();
      resolve();
    });
  });
}

/**
 * Redraw all rows (TTY mode)
 * @param {boolean} inlineCoverage - Whether to use the inline coverage table format
 */
function redrawTable(packages, states, spinnerIdx, nameWidth, lineWidth, totalLines, inlineCoverage = false) {
  process.stdout.write(term.moveUp(totalLines));

  if (inlineCoverage) {
    // Inline coverage table (same format as interactive summary)
    for (const pkg of packages) {
      process.stdout.write('\r' + term.clearLine);
      console.log(renderInteractiveRowWithCoverage(pkg, states[pkg.name], spinnerIdx, nameWidth));
    }
    process.stdout.write('\r' + term.clearLine);
    console.log(renderSeparatorWithCoverage(nameWidth));
    process.stdout.write('\r' + term.clearLine);
    console.log(renderTotalsWithCoverage(states, nameWidth));
  } else {
    for (const pkg of packages) {
      process.stdout.write('\r' + term.clearLine);
      console.log(renderRow(pkg, states[pkg.name], spinnerIdx, nameWidth));
    }
    process.stdout.write('\r' + term.clearLine);
    console.log(`  ${c.dim('─'.repeat(lineWidth - 2))}`);
    process.stdout.write('\r' + term.clearLine);
    console.log(renderTotals(states, nameWidth));
  }
}

/**
 * Main function - TTY mode with real-time updates
 */
export async function runTTY(packages, rootDir, verbose, coverageEnabled = false) {
  // nameWidth includes space for runner suffix: "pkg-name (vitest)"
  const nameWidth = Math.max(20, ...packages.map(p => p.name.length + (p.runner || '').length + 3));
  const lineWidth = nameWidth + 2 + 6 * 5 + 10;

  // Inline coverage columns only when coverage is on AND not verbose
  // (verbose gets a plain test table + detailed per-file coverage after)
  const inlineCoverage = coverageEnabled && !verbose;

  const states = {};
  for (const pkg of packages) {
    states[pkg.name] = createInitialState();
  }

  if (inlineCoverage) {
    console.log(`\n${c.bold(c.cyan('Test & Coverage Summary'))}\n`);
    console.log(renderInteractiveHeaderWithCoverage(nameWidth));
    console.log(renderSeparatorWithCoverage(nameWidth));
    for (const pkg of packages) {
      console.log(renderInteractiveRowWithCoverage(pkg, states[pkg.name], 0, nameWidth));
    }
    console.log(renderSeparatorWithCoverage(nameWidth));
    console.log(renderTotalsWithCoverage(states, nameWidth));
  } else {
    printHeader(nameWidth, lineWidth);
    for (const pkg of packages) {
      console.log(renderRow(pkg, states[pkg.name], 0, nameWidth));
    }
    printSeparator(lineWidth);
    console.log(renderTotals(states, nameWidth));
  }

  process.stdout.write(term.hideCursor);

  const cleanup = () => {
    process.stdout.write(term.showCursor);
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  // Total lines: packages + separator + totals
  const totalLines = packages.length + 2;
  let spinnerIdx = 0;

  const renderInterval = setInterval(() => {
    spinnerIdx++;
    redrawTable(packages, states, spinnerIdx, nameWidth, lineWidth, totalLines, inlineCoverage);
  }, 80);

  const promises = packages.map(async (pkg) => {
    states[pkg.name].status = 'running';
    await runTestsWithStreaming(pkg, states[pkg.name], () => {}, coverageEnabled);
  });

  await Promise.all(promises);

  clearInterval(renderInterval);
  redrawTable(packages, states, 0, nameWidth, lineWidth, totalLines, inlineCoverage);

  process.stdout.write(term.showCursor);

  const totals = Object.values(states).reduce((acc, s) => {
    acc.failed += s.failed || 0;
    acc.passed += s.passed || 0;
    return acc;
  }, { failed: 0, passed: 0 });

  printSummary(totals.failed);

  // Verbose: show failed output (only when not in coverage mode)
  if (verbose && !coverageEnabled && totals.failed > 0) {
    console.log(c.dim('─'.repeat(lineWidth)));
    for (const pkg of packages) {
      const state = states[pkg.name];
      if (state.failed > 0 || state.exitCode !== 0) {
        console.log(`\n${c.bold(c.red(pkg.name))}\n`);
        console.log(state.output);
      }
    }
  }

  // Verbose + coverage: show detailed per-file coverage table after summary
  if (coverageEnabled && verbose) {
    const verboseData = getVerboseCoverageData(rootDir, packages);
    if (verboseData.packageDisplayData.length > 0) {
      printVerboseCoverage(verboseData);
    }
  }

  return totals.failed > 0 ? 1 : 0;
}

/**
 * Main function - CI mode (no interactive updates)
 */
export async function runCI(packages, rootDir, verbose, coverageEnabled = false) {
  // nameWidth includes space for runner suffix: "pkg-name (vitest)"
  const nameWidth = Math.max(20, ...packages.map(p => p.name.length + (p.runner || '').length + 3));
  const lineWidth = nameWidth + 2 + 6 * 5 + 10;

  const inlineCoverage = coverageEnabled && !verbose;

  const states = {};

  if (inlineCoverage) {
    console.log(`\n${c.bold(c.cyan('Test & Coverage Summary'))}\n`);
    console.log(renderInteractiveHeaderWithCoverage(nameWidth));
    console.log(renderSeparatorWithCoverage(nameWidth));
  } else {
    printHeader(nameWidth, lineWidth);
  }

  for (const pkg of packages) {
    states[pkg.name] = createInitialState();
    states[pkg.name].status = 'running';

    await runTestsWithStreaming(pkg, states[pkg.name], () => {}, coverageEnabled);
    if (inlineCoverage) {
      console.log(renderInteractiveRowWithCoverage(pkg, states[pkg.name], 0, nameWidth));
    } else {
      console.log(renderRow(pkg, states[pkg.name], 0, nameWidth));
    }
  }

  if (inlineCoverage) {
    console.log(renderSeparatorWithCoverage(nameWidth));
    console.log(renderTotalsWithCoverage(states, nameWidth));
  } else {
    printSeparator(lineWidth);
    console.log(renderTotals(states, nameWidth));
  }

  const totals = Object.values(states).reduce((acc, s) => {
    acc.failed += s.failed || 0;
    return acc;
  }, { failed: 0 });

  printSummary(totals.failed);

  // Verbose: show failed output (only when not in coverage mode)
  if (verbose && !coverageEnabled && totals.failed > 0) {
    console.log(c.dim('─'.repeat(lineWidth)));
    for (const pkg of packages) {
      const state = states[pkg.name];
      if (state.failed > 0 || state.exitCode !== 0) {
        console.log(`\n${c.bold(c.red(pkg.name))}\n`);
        console.log(state.output);
      }
    }
  }

  // Verbose + coverage: show detailed per-file coverage table after summary
  if (coverageEnabled && verbose) {
    const verboseData = getVerboseCoverageData(rootDir, packages);
    if (verboseData.packageDisplayData.length > 0) {
      printVerboseCoverage(verboseData);
    }
  }

  return totals.failed > 0 ? 1 : 0;
}
