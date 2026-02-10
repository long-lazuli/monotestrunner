/**
 * Interactive mode for test summary
 * Keyboard handlers and interactive UI logic
 */

import { emitKeypressEvents } from 'node:readline';
import { spawn } from 'node:child_process';
import c from 'picocolors';
import {
  term,
  spinner,
  createInitialState,
  renderInteractiveRow,
  renderTotals,
  renderHelp,
  renderInteractiveHeaderWithCoverage,
  renderInteractiveRowWithCoverage,
  renderSeparatorWithCoverage,
  renderTotalsWithCoverage,
} from '../ui.js';
import { getPackageCoverage } from '../coverage.js';
import { createWatcherManager } from '../watcher.js';
import {
  parseVitestFinal,
  parseBunFinal,
  countVitestDots,
  countBunDots,
} from '../parsers.js';

/**
 * Run tests for a single package with streaming
 * @param {object} pkg - Package to run tests for
 * @param {object} state - State object for this package
 * @param {Function} onUpdate - Callback when state changes
 * @param {Map} childProcesses - Map of running child processes
 * @param {Set} pendingReruns - Set of package names queued for rerun
 * @param {Function} onComplete - Callback when tests complete (for deferred reruns)
 * @param {boolean} coverageEnabled - Whether to run with coverage
 */
function runPackageTests(pkg, state, onUpdate, childProcesses, pendingReruns, onComplete, coverageEnabled = false) {
  return new Promise((resolve) => {
    // Reset state
    state.status = 'running';
    state.passed = 0;
    state.skipped = 0;
    state.failed = 0;
    state.files = null;
    state.tests = null;
    state.duration = null;
    state.exitCode = null;
    state.output = '';
    state.coverage = null;

    onUpdate();

    // Build command
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

    childProcesses.set(pkg.name, child);

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

      childProcesses.delete(pkg.name);
      onUpdate();
      
      // Check for pending rerun after completion
      if (onComplete) {
        onComplete(pkg);
      }
      
      resolve();
    });
  });
}

/**
 * Run all packages in parallel
 */
function runAllPackages(packages, states, onUpdate, childProcesses, pendingReruns, onComplete, coverageEnabled = false) {
  const promises = packages.map((pkg) =>
    runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, onComplete, coverageEnabled)
  );
  return Promise.all(promises);
}

/**
 * Main interactive mode
 * @param {Array} packages - Package list
 * @param {string} rootDir - Workspace root directory
 * @param {object} config - Config object with optional watchMappings
 * @param {boolean} initialWatchEnabled - Whether to start with watch enabled
 * @param {boolean} initialCoverageEnabled - Whether to start with coverage enabled
 */
export async function runInteractiveMode(packages, rootDir, config = {}, initialWatchEnabled = false, initialCoverageEnabled = false) {
  // nameWidth includes space for runner suffix: "pkg-name (vitest)"
  const nameWidth = Math.max(20, ...packages.map((p) => p.name.length + p.runner.length + 3));
  const lineWidth = nameWidth + 2 + 6 * 5 + 10;

  // Initialize states
  const states = {};
  for (const pkg of packages) {
    states[pkg.name] = createInitialState();
  }

  // UI state
  const uiState = {
    selectedIndex: 0,
    showingHelp: false,
    currentCommand: '',
    watchEnabled: initialWatchEnabled,
    coverageEnabled: initialCoverageEnabled,
    cursorDimmed: false,
  };
  
  // Cursor dimming timeout (dim after 3 seconds of inactivity)
  const CURSOR_DIM_DELAY = 3000;
  let cursorDimTimeout = null;
  
  const resetCursorDimTimer = () => {
    if (cursorDimTimeout) {
      clearTimeout(cursorDimTimeout);
    }
    if (uiState.cursorDimmed) {
      uiState.cursorDimmed = false;
      redraw();
    }
    cursorDimTimeout = setTimeout(() => {
      uiState.cursorDimmed = true;
      redraw();
    }, CURSOR_DIM_DELAY);
  };

  // Track child processes
  const childProcesses = new Map();
  
  // Track pending reruns (packages queued for rerun after current run completes)
  const pendingReruns = new Set();
  // Track if "run all" is pending
  let pendingRunAll = false;

  // Spinner
  let spinnerIdx = 0;
  let spinnerInterval = null;

  /**
   * Full redraw of the UI
   */
  const redraw = () => {
    if (uiState.showingHelp) {
      renderHelp(lineWidth);
      return;
    }

    const cov = uiState.coverageEnabled;

    // Move to top and clear
    process.stdout.write(term.moveTo(1, 1));

    // Header
    const modeLabel = uiState.watchEnabled
      ? `(${c.yellow('watching')})`
      : '(interactive)';
    const title = cov ? 'Test & Coverage Summary' : 'Test Summary';
    process.stdout.write(term.clearLine);
    console.log(`${c.bold(c.cyan(title))} ${c.dim(modeLabel)}\n`);

    if (cov) {
      console.log(renderInteractiveHeaderWithCoverage(nameWidth));
      console.log(renderSeparatorWithCoverage(nameWidth));
    } else {
      console.log(c.dim(`  ${'Package'.padEnd(nameWidth)}${'Files'.padStart(6)}${'Tests'.padStart(6)}${'Pass'.padStart(6)}${'Skip'.padStart(6)}${'Fail'.padStart(6)}${'Duration'.padStart(10)}`));
      console.log(`  ${c.dim('─'.repeat(lineWidth - 2))}`);
    }

    // Package rows
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      const selected = i === uiState.selectedIndex;
      process.stdout.write(term.clearLine);
      if (cov) {
        console.log(renderInteractiveRowWithCoverage(pkg, states[pkg.name], spinnerIdx, nameWidth, selected, uiState.cursorDimmed));
      } else {
        console.log(renderInteractiveRow(pkg, states[pkg.name], spinnerIdx, nameWidth, selected, uiState.cursorDimmed));
      }
    }

    // Separator and totals
    if (cov) {
      console.log(renderSeparatorWithCoverage(nameWidth));
      process.stdout.write(term.clearLine);
      console.log(renderTotalsWithCoverage(states, nameWidth));
    } else {
      console.log(`  ${c.dim('─'.repeat(lineWidth - 2))}`);
      process.stdout.write(term.clearLine);
      console.log(renderTotals(states, nameWidth));
    }

    // Status lines
    console.log();
    process.stdout.write(term.clearLine);
    console.log(c.dim(uiState.currentCommand || ' '));
    process.stdout.write(term.clearLine);
    console.log(c.dim('↑↓ navigate  r:rerun  a:rerun all  c:coverage  w:watch  h:help  q:quit'));
  };

  const onUpdate = () => {
    if (!uiState.showingHelp) {
      redraw();
    }
  };

  /**
   * Handle completion of a package test run - check for pending reruns
   */
  const onPackageComplete = (pkg) => {
    // If "run all" is pending, don't run individual packages yet
    if (pendingRunAll) {
      return;
    }
    
    // Check if this package has a pending rerun
    if (pendingReruns.has(pkg.name)) {
      pendingReruns.delete(pkg.name);
      uiState.currentCommand = `[${pkg.name}] Rerunning (queued)...`;
      runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, onPackageComplete, uiState.coverageEnabled);
    }
  };
  
  /**
   * Check if all tests are done, then handle pending "run all"
   */
  const checkPendingRunAll = () => {
    if (!pendingRunAll) return;
    
    const allDone = packages.every((pkg) => states[pkg.name].status !== 'running');
    if (allDone) {
      pendingRunAll = false;
      pendingReruns.clear(); // Clear individual pending since we're running all
      runAllNow();
    }
  };
  
  /**
   * Actually run all packages now
   */
  const runAllNow = () => {
    uiState.currentCommand = uiState.coverageEnabled ? 'Running all packages with coverage...' : 'Running all packages...';
    const promises = packages.map((pkg) =>
      runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, (completedPkg) => {
        onPackageComplete(completedPkg);
        checkPendingRunAll();
      }, uiState.coverageEnabled)
    );
    Promise.all(promises);
  };

  /**
   * Run selected package (queue if already running)
   */
  const runSelected = () => {
    const pkg = packages[uiState.selectedIndex];
    if (states[pkg.name].status === 'running') {
      // Queue for rerun after current run completes
      pendingReruns.add(pkg.name);
      uiState.currentCommand = `[${pkg.name}] Queued for rerun...`;
      onUpdate();
      return;
    }
    const covSuffix = uiState.coverageEnabled ? ' --coverage' : '';
    uiState.currentCommand = `[${pkg.name}] ${pkg.runner === 'vitest' ? 'pnpm vitest run --reporter=dot' : 'bun test --dots'}${covSuffix}`;
    runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, onPackageComplete, uiState.coverageEnabled);
  };
  
  /**
   * Run a specific package (used by watcher)
   */
  const runPackage = (pkg, message) => {
    if (states[pkg.name].status === 'running') {
      // Queue for rerun after current run completes
      pendingReruns.add(pkg.name);
      uiState.currentCommand = `[${pkg.name}] Queued for rerun...`;
      onUpdate();
      return;
    }
    uiState.currentCommand = message || `[${pkg.name}] Running...`;
    runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, onPackageComplete, uiState.coverageEnabled);
  };

  /**
   * Run all packages (queue if any running)
   */
  const runAll = () => {
    const anyRunning = packages.some((pkg) => states[pkg.name].status === 'running');
    if (anyRunning) {
      // Queue "run all" for when all current runs complete
      pendingRunAll = true;
      uiState.currentCommand = 'Queued: rerun all after current tests...';
      onUpdate();
      return;
    }
    runAllNow();
  };

  // Create watcher manager with config watchMappings
  const watchMappings = config.watchMappings || [];
  const watcherManager = createWatcherManager(rootDir, packages, watchMappings, (pkg, filePath, type) => {
    if (type === 'all') {
      // triggers: "*" - run all packages
      runAll();
    } else {
      // Direct or mapped change - run specific package
      const source = type === 'mapped' ? ' (mapped)' : '';
      runPackage(pkg, `[${pkg.name}] File changed${source} → rerunning...`);
    }
  });

  /**
   * Cleanup resources
   */
  const cleanup = () => {
    // Kill all child processes
    for (const [, child] of childProcesses) {
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    }
    childProcesses.clear();

    // Stop spinner
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
    }
    
    // Stop cursor dim timer
    if (cursorDimTimeout) {
      clearTimeout(cursorDimTimeout);
    }

    // Stop file watcher
    watcherManager.stop();

    // Restore terminal
    process.stdout.write(term.showCursor);
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
  };

  /**
   * Setup keyboard handlers
   */
  const setupKeyboard = () => {
    if (!process.stdin.setRawMode) {
      console.error('Interactive mode requires a TTY. Run in a terminal.');
      process.exit(1);
    }
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on('keypress', (str, key) => {
      // Handle help overlay - any key closes it
      if (uiState.showingHelp) {
        uiState.showingHelp = false;
        process.stdout.write(term.clearScreen);
        redraw();
        return;
      }

      // Handle Ctrl+C
      if (key && key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }

      // Navigation - arrow keys (reset cursor dim)
      if (key && key.name === 'up') {
        resetCursorDimTimer();
        uiState.selectedIndex = Math.max(0, uiState.selectedIndex - 1);
        redraw();
        return;
      }

      if (key && key.name === 'down') {
        resetCursorDimTimer();
        uiState.selectedIndex = Math.min(packages.length - 1, uiState.selectedIndex + 1);
        redraw();
        return;
      }

      // Navigation - vim keys (j/k) (reset cursor dim)
      if (str === 'k') {
        resetCursorDimTimer();
        uiState.selectedIndex = Math.max(0, uiState.selectedIndex - 1);
        redraw();
        return;
      }

      if (str === 'j') {
        resetCursorDimTimer();
        uiState.selectedIndex = Math.min(packages.length - 1, uiState.selectedIndex + 1);
        redraw();
        return;
      }

      // Run selected package (reset cursor dim)
      if (str === 'r' || (key && key.name === 'return')) {
        resetCursorDimTimer();
        runSelected();
        return;
      }

      if (str === 'a') {
        runAll();
        return;
      }

      // Toggle coverage mode
      if (str === 'c') {
        uiState.coverageEnabled = !uiState.coverageEnabled;
        if (uiState.coverageEnabled) {
          uiState.currentCommand = 'Coverage enabled - rerunning all packages...';
          // Clear screen to accommodate coverage section
          process.stdout.write(term.clearScreen);
          runAll();
        } else {
          uiState.currentCommand = 'Coverage disabled';
          // Clear screen since we're removing coverage section
          process.stdout.write(term.clearScreen);
          redraw();
        }
        return;
      }

      // Toggle watch mode
      if (str === 'w') {
        uiState.watchEnabled = !uiState.watchEnabled;
        if (uiState.watchEnabled) {
          watcherManager.start();
          uiState.currentCommand = 'File watching enabled';
        } else {
          watcherManager.stop();
          uiState.currentCommand = 'File watching disabled';
        }
        redraw();
        return;
      }

      // Help
      if (str === 'h') {
        uiState.showingHelp = true;
        redraw();
        return;
      }

      // Quit
      if (str === 'q') {
        cleanup();
        process.exit(0);
      }
    });
  };

  // Setup cleanup handlers
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  // Hide cursor
  process.stdout.write(term.hideCursor);

  // Clear screen
  process.stdout.write(term.clearScreen);

  // Setup keyboard handlers BEFORE running tests
  setupKeyboard();

  // Initial render
  redraw();
  
  // Start cursor dim timer
  resetCursorDimTimer();

  // Start spinner interval (use interval from cli-spinners)
  spinnerInterval = setInterval(() => {
    spinnerIdx++;
    const hasRunning = Object.values(states).some((s) => s.status === 'running');
    if (hasRunning && !uiState.showingHelp) {
      redraw();
    }
  }, spinner.interval);

  // Run all tests initially
  uiState.currentCommand = uiState.coverageEnabled ? 'Running all packages with coverage...' : 'Running all packages...';
  await runAllPackages(packages, states, onUpdate, childProcesses, pendingReruns, (completedPkg) => {
    onPackageComplete(completedPkg);
    checkPendingRunAll();
  }, uiState.coverageEnabled);

  // Clear the "Running all packages..." message
  uiState.currentCommand = '';
  redraw();

  // Start file watcher if enabled
  if (uiState.watchEnabled) {
    watcherManager.start();
  }

  // Keep the process alive (stdin raw mode keeps it alive)
}
