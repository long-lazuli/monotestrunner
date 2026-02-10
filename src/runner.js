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
  printCoverageTable,
  printVerboseCoverage,
  createInitialCoverageState,
  renderCoverageHeader,
  renderCoverageRow,
  renderCoverageTotals,
} from './ui.js';
import {
  parseVitestFinal,
  parseBunFinal,
  countVitestDots,
  countBunDots,
} from './parsers.js';
import { getPackageCoverage, getVerboseCoverageData } from './coverage.js';

/**
 * Run tests for a package with streaming dot output
 * @param {object} pkg - Package to run tests for
 * @param {object} state - State object for this package
 * @param {Function} onUpdate - Callback when state changes
 * @param {boolean} coverageEnabled - Whether to run with coverage
 */
export function runTestsWithStreaming(pkg, state, onUpdate, coverageEnabled = false) {
  return new Promise((resolve) => {
    let command, args;
    if (pkg.runner === 'vitest') {
      command = 'pnpm';
      args = ['vitest', 'run', '--reporter=dot'];
      if (coverageEnabled) {
        args.push('--coverage');
      }
    } else {
      command = 'bun';
      args = ['test', '--dots'];
      if (coverageEnabled) {
        args.push('--coverage', '--coverage-reporter=lcov', '--coverage-dir=coverage');
      }
    }

    const child = spawn(command, args, {
      cwd: pkg.path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const countDots = pkg.runner === 'vitest' ? countVitestDots : countBunDots;

    const handleData = (data) => {
      const chunk = data.toString();
      output += chunk;

      const counts = countDots(chunk);
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
      const parser = pkg.runner === 'vitest' ? parseVitestFinal : parseBunFinal;
      const final = parser(output);

      state.status = 'done';
      state.exitCode = code;
      state.files = final.files;
      state.tests = final.tests;
      state.passed = final.passed;
      state.skipped = final.skipped;
      state.failed = final.failed;
      state.duration = final.duration;
      state.output = output;

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
 */
function redrawTable(packages, states, spinnerIdx, nameWidth, lineWidth, totalLines, coverageEnabled = false) {
  process.stdout.write(term.moveUp(totalLines));

  for (const pkg of packages) {
    process.stdout.write('\r' + term.clearLine);
    console.log(renderRow(pkg, states[pkg.name], spinnerIdx, nameWidth));
  }

  process.stdout.write('\r' + term.clearLine);
  console.log(`  ${c.dim('─'.repeat(lineWidth - 2))}`);
  process.stdout.write('\r' + term.clearLine);
  console.log(renderTotals(states, nameWidth));

  // Coverage section
  if (coverageEnabled) {
    const covLineWidth = nameWidth + 2 + 7 + 8 + 8;

    // Build coverageStates from states
    const coverageStates = {};
    for (const pkg of packages) {
      const state = states[pkg.name];
      if (state.coverage) {
        coverageStates[pkg.name] = { ...state.coverage, status: 'done' };
      } else if (state.status === 'done') {
        coverageStates[pkg.name] = { status: 'done', lines: '-', branches: '-', functions: '-' };
      } else {
        coverageStates[pkg.name] = createInitialCoverageState();
      }
    }

    process.stdout.write('\r' + term.clearLine);
    console.log();  // blank line
    process.stdout.write('\r' + term.clearLine);
    console.log(`${c.bold(c.cyan('Coverage Summary'))}`);  // title (no extra newline)
    process.stdout.write('\r' + term.clearLine);
    console.log();  // blank line after title
    process.stdout.write('\r' + term.clearLine);
    console.log(renderCoverageHeader(nameWidth));
    process.stdout.write('\r' + term.clearLine);
    console.log(`  ${c.dim('─'.repeat(covLineWidth - 2))}`);

    const allRowStatuses = [];
    for (const pkg of packages) {
      process.stdout.write('\r' + term.clearLine);
      const row = renderCoverageRow(pkg.name, coverageStates[pkg.name], nameWidth);
      console.log(row.text);
      allRowStatuses.push(row.statuses);
    }

    process.stdout.write('\r' + term.clearLine);
    console.log(`  ${c.dim('─'.repeat(covLineWidth - 2))}`);
    process.stdout.write('\r' + term.clearLine);
    console.log(renderCoverageTotals(coverageStates, allRowStatuses, nameWidth));
  }
}

/**
 * Main function - TTY mode with real-time updates
 */
export async function runTTY(packages, rootDir, verbose, coverageEnabled = false) {
  // nameWidth includes space for runner suffix: "pkg-name (vitest)"
  const nameWidth = Math.max(20, ...packages.map(p => p.name.length + p.runner.length + 3));
  const lineWidth = nameWidth + 2 + 6 * 5 + 10;

  const states = {};
  for (const pkg of packages) {
    states[pkg.name] = createInitialState();
  }

  printHeader(nameWidth, lineWidth);

  for (const pkg of packages) {
    console.log(renderRow(pkg, states[pkg.name], 0, nameWidth));
  }

  printSeparator(lineWidth);
  console.log(renderTotals(states, nameWidth));

  // Initial coverage section (if enabled)
  if (coverageEnabled) {
    const covLineWidth = nameWidth + 2 + 7 + 8 + 8;
    console.log();  // blank line
    console.log(`${c.bold(c.cyan('Coverage Summary'))}`);  // title
    console.log();  // blank line after title
    console.log(renderCoverageHeader(nameWidth));
    console.log(`  ${c.dim('─'.repeat(covLineWidth - 2))}`);
    const initRowStatuses = [];
    for (const pkg of packages) {
      const row = renderCoverageRow(pkg.name, createInitialCoverageState(), nameWidth);
      console.log(row.text);
      initRowStatuses.push(row.statuses);
    }
    console.log(`  ${c.dim('─'.repeat(covLineWidth - 2))}`);
    console.log(renderCoverageTotals({}, initRowStatuses, nameWidth));
  }

  process.stdout.write(term.hideCursor);

  const cleanup = () => {
    process.stdout.write(term.showCursor);
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  // Total lines includes: packages + separator + totals row
  // Plus coverage section if enabled: blank + title + blank + header + separator + packages + separator + totals
  const testTableLines = packages.length + 2;
  const coverageTableLines = coverageEnabled ? (1 + 1 + 1 + 1 + 1 + packages.length + 1 + 1) : 0;
  const totalLines = testTableLines + coverageTableLines;
  let spinnerIdx = 0;

  const renderInterval = setInterval(() => {
    spinnerIdx++;
    redrawTable(packages, states, spinnerIdx, nameWidth, lineWidth, totalLines, coverageEnabled);
  }, 80);

  const promises = packages.map(async (pkg) => {
    states[pkg.name].status = 'running';
    await runTestsWithStreaming(pkg, states[pkg.name], () => {}, coverageEnabled);
  });

  await Promise.all(promises);

  clearInterval(renderInterval);
  redrawTable(packages, states, 0, nameWidth, lineWidth, totalLines, coverageEnabled);

  process.stdout.write(term.showCursor);

  const totals = Object.values(states).reduce((acc, s) => {
    acc.failed += s.failed || 0;
    acc.passed += s.passed || 0;
    return acc;
  }, { failed: 0, passed: 0 });

  printSummary(totals.failed);

  if (totals.failed > 0 && verbose) {
    console.log(c.dim('─'.repeat(lineWidth)));
    for (const pkg of packages) {
      const state = states[pkg.name];
      if (state.failed > 0 || state.exitCode !== 0) {
        console.log(`\n${c.bold(c.red(pkg.name))}\n`);
        console.log(state.output);
      }
    }
  }

  // Verbose coverage: show per-file details after the run
  if (coverageEnabled && verbose) {
    const pkgsWithPaths = packages.map(pkg => ({
      name: pkg.name,
      dir: pkg.dir,
      path: pkg.path,
      runner: pkg.runner,
    }));
    const verboseData = getVerboseCoverageData(rootDir, pkgsWithPaths);
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
  const nameWidth = Math.max(20, ...packages.map(p => p.name.length + p.runner.length + 3));
  const lineWidth = nameWidth + 2 + 6 * 5 + 10;

  printHeader(nameWidth, lineWidth);

  const states = {};

  for (const pkg of packages) {
    states[pkg.name] = createInitialState();
    states[pkg.name].status = 'running';

    await runTestsWithStreaming(pkg, states[pkg.name], () => {}, coverageEnabled);
    console.log(renderRow(pkg, states[pkg.name], 0, nameWidth));
  }

  printSeparator(lineWidth);
  console.log(renderTotals(states, nameWidth));

  const totals = Object.values(states).reduce((acc, s) => {
    acc.failed += s.failed || 0;
    return acc;
  }, { failed: 0 });

  printSummary(totals.failed);

  if (totals.failed > 0 && verbose) {
    console.log(c.dim('─'.repeat(lineWidth)));
    for (const pkg of packages) {
      const state = states[pkg.name];
      if (state.failed > 0 || state.exitCode !== 0) {
        console.log(`\n${c.bold(c.red(pkg.name))}\n`);
        console.log(state.output);
      }
    }
  }

  // Coverage output (CI mode - printed after all tests complete)
  if (coverageEnabled) {
    if (verbose) {
      // Verbose: show per-file coverage details
      const pkgsWithPaths = packages.map(pkg => ({
        name: pkg.name,
        dir: pkg.dir,
        path: pkg.path,
        runner: pkg.runner,
      }));
      const verboseData = getVerboseCoverageData(rootDir, pkgsWithPaths);
      if (verboseData.packageDisplayData.length > 0) {
        printVerboseCoverage(verboseData);
      }
    } else {
      // Summary: show package-level coverage table
      const coverageStates = {};
      for (const pkg of packages) {
        const state = states[pkg.name];
        if (state.coverage) {
          coverageStates[pkg.name] = { ...state.coverage, status: 'done' };
        } else {
          coverageStates[pkg.name] = { status: 'done', lines: '-', branches: '-', functions: '-' };
        }
      }
      printCoverageTable(packages, coverageStates, nameWidth);
    }
  }

  return totals.failed > 0 ? 1 : 0;
}
