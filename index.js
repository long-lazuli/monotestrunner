#!/usr/bin/env node
/**
 * Test Summary Script
 *
 * Runs tests across all packages in parallel and displays an interactive summary table.
 * Shows real-time per-test updates using dot reporters, with a spinner for running tests.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import meow from 'meow';

import c from 'picocolors';
import {
  term,
  createInitialState,
  renderRow,
  renderTotals,
  printHeader,
  printSeparator,
  printSummary,
} from './ui.js';
import { runInteractiveMode } from './interactive.js';
import {
  parseVitestFinal,
  parseBunFinal,
  countVitestDots,
  countBunDots,
} from './parsers.js';
import { loadConfig, validateConfig } from './config.js';
import { getPackageCoverage, getVerboseCoverageData } from './coverage.js';
import {
  printCoverageTable,
  printVerboseCoverage,
  createInitialCoverageState,
  renderCoverageHeader,
  renderCoverageRow,
  renderCoverageTotals,
} from './ui.js';

const cli = meow(`
  Usage
    $ pnpm test [options]

  Options
    -i, --interactive  Interactive mode with keyboard navigation
    -w, --watch        Interactive mode with file watching (implies -i)
    -c, --coverage     Run tests with coverage enabled
    -v, --verbose      Show detailed output (failed tests + per-file coverage)

  Examples
    $ pnpm test        Run all tests once
    $ pnpm test -i     Interactive mode
    $ pnpm test -w     Interactive mode with file watching
    $ pnpm test -c     Run with coverage
`, {
  importMeta: import.meta,
  flags: {
    interactive: {
      type: 'boolean',
      shortFlag: 'i',
    },
    watch: {
      type: 'boolean',
      shortFlag: 'w',
    },
    coverage: {
      type: 'boolean',
      shortFlag: 'c',
    },
    verbose: {
      type: 'boolean',
      shortFlag: 'v',
    },
  },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const verbose = cli.flags.verbose;
const coverage = cli.flags.coverage;
const watchInitial = cli.flags.watch;
const interactive = cli.flags.interactive || watchInitial; // -w implies -i
const isCI = process.env.CI === 'true';
const isInteractiveTTY = process.stdout.isTTY && !isCI;

/**
 * Find all packages with test scripts
 */
function findPackages() {
  const packages = [];
  const dirs = ['packages', 'plugins', 'apps'];

  for (const dir of dirs) {
    const dirPath = join(rootDir, dir);
    if (!existsSync(dirPath)) continue;

    for (const name of readdirSync(dirPath)) {
      const pkgPath = join(dirPath, name);
      const pkgJsonPath = join(pkgPath, 'package.json');

      if (!existsSync(pkgJsonPath)) continue;

      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        if (pkgJson.scripts?.test) {
          packages.push({
            name,
            dir,
            path: pkgPath,
            testScript: pkgJson.scripts.test,
            runner: pkgJson.scripts.test.includes('vitest') ? 'vitest' : 'bun',
          });
        }
      } catch {
        // Skip invalid package.json
      }
    }
  }

  return packages;
}

/**
 * Run tests for a package with streaming dot output
 * @param {object} pkg - Package to run tests for
 * @param {object} state - State object for this package
 * @param {Function} onUpdate - Callback when state changes
 * @param {boolean} coverageEnabled - Whether to run with coverage
 */
function runTestsWithStreaming(pkg, state, onUpdate, coverageEnabled = false) {
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
 * Redraw all rows
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
async function runTTY(packages, coverageEnabled = false) {
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
async function runCI(packages, coverageEnabled = false) {
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

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  const packages = findPackages();

  if (packages.length === 0) {
    console.log('No packages with tests found.');
    process.exit(0);
  }

  // Load and validate config
  const config = await loadConfig(rootDir);
  if (config.watchMappings) {
    validateConfig(config, packages, rootDir);
  }

  if (interactive) {
    await runInteractiveMode(packages, rootDir, config, watchInitial, coverage);
    // Interactive mode doesn't exit normally
  } else {
    const exitCode = isInteractiveTTY ? await runTTY(packages, coverage) : await runCI(packages, coverage);
    // Only exit with error code in CI to avoid pnpm ELIFECYCLE noise locally
    process.exit(isCI ? exitCode : 0);
  }
}

main();
