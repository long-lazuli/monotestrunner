/**
 * Interactive mode orchestrator.
 *
 * Single entry point for interactive test running.
 * Owns: test state, child processes, single keypress handler,
 * screen switching, alt buffer management, redraw dispatch.
 *
 * Delegates rendering to screen modules (screens/).
 * Delegates input classification to input.js.
 * Delegates state to state.js.
 */

import { emitKeypressEvents } from 'node:readline';
import { spawn } from 'node:child_process';
import { join, basename, relative } from 'node:path';

import { term, spinner, createInitialState } from '../ui.js';
import { getPackageCoverage } from '../coverage.js';
import { createWatcherManager } from '../watcher.js';
import { parseVitestFinal, parseBunFinal, countVitestDots, countBunDots, parseJunitFile, extractFailureLine } from '../parsers.js';

import { classifyKey } from './input.js';
import {
  createViewState,
  createCoverageFlags,
  cycleCoverage,
  togglePackageCoverage,
  resetTestsState,
  resetCoverageState,
  createCursorDimTimer,
} from './state.js';

import { renderSummary } from './screens/summary.js';
import { renderTestsScreen, buildTestRows, getSelectableIndices } from './screens/tests.js';
import { renderCoverageScreen, buildCoverageRows, getSelectableFileIndices } from './screens/coverage.js';
import { renderHelp } from './help.js';

// Alternate screen buffer
const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';

// ============================================================================
// Test running (kept from original — same logic, cleaner structure)
// ============================================================================

function runPackageTests(pkg, state, onUpdate, childProcesses, pendingReruns, onComplete, coverageEnabled) {
  return new Promise((resolve) => {
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
    state.testResults = null;

    onUpdate('started', pkg.name);

    let command, args;
    const junitPath = join(pkg.path, 'coverage', 'junit.xml');

    if (pkg.runner === 'vitest') {
      command = 'pnpm';
      args = ['vitest', 'run', '--reporter=dot', '--reporter=junit', '--outputFile.junit=coverage/junit.xml'];
      if (coverageEnabled) args.push('--coverage');
    } else {
      command = 'bun';
      args = ['test', '--dots', '--reporter=junit', '--reporter-outfile=coverage/junit.xml'];
      if (coverageEnabled) args.push('--coverage', '--coverage-reporter=lcov', '--coverage-dir=coverage');
    }

    const child = spawn(command, args, { cwd: pkg.path, stdio: ['ignore', 'pipe', 'pipe'] });
    childProcesses.set(pkg.name, child);

    let output = '';
    const countDots = pkg.runner === 'vitest' ? countVitestDots : countBunDots;

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      const counts = countDots(chunk);
      state.passed += counts.passed;
      state.skipped += counts.skipped;
      state.failed += counts.failed;
      onUpdate('streaming', pkg.name);
    });

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
      state.testResults = parseJunitFile(junitPath);

      if (coverageEnabled) {
        state.coverage = getPackageCoverage(pkg);
      }

      childProcesses.delete(pkg.name);
      onUpdate('completed', pkg.name);

      if (onComplete) onComplete(pkg);
      resolve();
    });
  });
}

// ============================================================================
// Main interactive mode
// ============================================================================

/**
 * @param {Array} packages - Package list
 * @param {string} rootDir - Workspace root directory
 * @param {object} config - Config object with optional watchMappings
 * @param {boolean} initialWatchEnabled - Whether to start with watch enabled
 * @param {boolean} initialCoverageEnabled - Whether to start with coverage enabled
 */
export async function runInteractiveMode(packages, rootDir, config = {}, initialWatchEnabled = false, initialCoverageEnabled = false) {
  // ── State ──
  const states = {};
  for (const pkg of packages) {
    states[pkg.name] = createInitialState();
  }

  const viewState = createViewState();
  const { flags: coverageFlags, snapshot: coverageSnapshot } = createCoverageFlags(packages, initialCoverageEnabled);

  let statusMessage = '';

  // Child process tracking
  const childProcesses = new Map();
  const pendingReruns = new Set();
  let pendingRunAll = false;

  // ── Render dispatch ──

  const render = () => {
    if (viewState.helpVisible) {
      renderHelp();
      return;
    }

    switch (viewState.currentScreen) {
      case 'summary':
        renderSummary({
          packages,
          states,
          coverageFlags,
          summaryState: viewState.summary,
          cursorDimmed: viewState.cursorDimmed,
          spinnerIdx: viewState.spinnerIdx,
          watchEnabled: viewState.watchEnabled,
          statusMessage,
        });
        break;

      case 'tests': {
        const pkg = packages[viewState.summary.selectedIndex];
        renderTestsScreen({
          pkg,
          state: states[pkg.name],
          testsState: viewState.tests,
          cursorDimmed: viewState.cursorDimmed,
          coverageEnabled: coverageFlags[pkg.name],
          spinnerIdx: viewState.spinnerIdx,
        });
        break;
      }

      case 'coverage': {
        const pkg = packages[viewState.summary.selectedIndex];
        renderCoverageScreen({
          pkg,
          state: states[pkg.name],
          coverageState: viewState.coverage,
          cursorDimmed: viewState.cursorDimmed,
          coverageEnabled: coverageFlags[pkg.name],
          spinnerIdx: viewState.spinnerIdx,
          rootDir,
        });
        break;
      }
    }
  };

  // ── onUpdate — called by test runners ──

  const onUpdate = (type, _pkgName) => {
    if (viewState.helpVisible) return;

    if (viewState.currentScreen === 'summary') {
      // Summary redraws on every update (streaming dots, completion)
      render();
    } else {
      // Detail screens only redraw on run completion
      if (type === 'completed') {
        clampCursors();
        render();
      }
      // 'streaming' and 'started' are ignored — spinner interval handles running indicator
    }
  };

  // ── Cursor clamping after rerun ──

  const clampCursors = () => {
    const pkg = packages[viewState.summary.selectedIndex];
    if (!pkg) return;

    const testRows = buildTestRows(states[pkg.name].testResults);
    const testSelectable = getSelectableIndices(testRows);
    if (testSelectable.length > 0) {
      if (!testSelectable.includes(viewState.tests.selectedIndex)) {
        // Find nearest selectable
        const nearest = testSelectable.reduce((prev, curr) =>
          Math.abs(curr - viewState.tests.selectedIndex) < Math.abs(prev - viewState.tests.selectedIndex) ? curr : prev,
        );
        viewState.tests.selectedIndex = nearest;
      }
    } else {
      viewState.tests.selectedIndex = 0;
    }

    const { rows: covRows } = buildCoverageRows(pkg, rootDir);
    const covSelectable = getSelectableFileIndices(covRows);
    if (covSelectable.length > 0) {
      if (!covSelectable.includes(viewState.coverage.selectedIndex)) {
        const nearest = covSelectable.reduce((prev, curr) =>
          Math.abs(curr - viewState.coverage.selectedIndex) < Math.abs(prev - viewState.coverage.selectedIndex) ? curr : prev,
        );
        viewState.coverage.selectedIndex = nearest;
      }
    } else {
      viewState.coverage.selectedIndex = 0;
    }
  };

  // ── Cursor dim timer ──

  const dimTimer = createCursorDimTimer(viewState, render);
  viewState.watchEnabled = initialWatchEnabled;

  // ── Run helpers ──

  const runPkg = (pkg, message) => {
    if (states[pkg.name].status === 'running') {
      pendingReruns.add(pkg.name);
      statusMessage = `[${pkg.name}] Queued for rerun...`;
      render();
      return;
    }
    statusMessage = message || `[${pkg.name}] Running...`;
    runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, onPkgComplete, coverageFlags[pkg.name]);
  };

  const onPkgComplete = (pkg) => {
    if (pendingRunAll) return;
    if (pendingReruns.has(pkg.name)) {
      pendingReruns.delete(pkg.name);
      statusMessage = `[${pkg.name}] Rerunning (queued)...`;
      runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, onPkgComplete, coverageFlags[pkg.name]);
    }
  };

  const checkPendingRunAll = () => {
    if (!pendingRunAll) return;
    if (packages.every((pkg) => states[pkg.name].status !== 'running')) {
      pendingRunAll = false;
      pendingReruns.clear();
      runAllNow();
    }
  };

  const runAllNow = () => {
    statusMessage = 'Running all packages...';
    packages.forEach((pkg) =>
      runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, (p) => {
        onPkgComplete(p);
        checkPendingRunAll();
      }, coverageFlags[pkg.name]),
    );
  };

  const runAll = () => {
    if (packages.some((pkg) => states[pkg.name].status === 'running')) {
      pendingRunAll = true;
      statusMessage = 'Queued: rerun all after current tests...';
      render();
      return;
    }
    runAllNow();
  };

  const rerunPackages = (pkgNames) => {
    for (const name of pkgNames) {
      const pkg = packages.find((p) => p.name === name);
      if (pkg) runPkg(pkg, `[${pkg.name}] Coverage enabled, rerunning...`);
    }
  };

  // ── Screen navigation ──

  const enterDetailScreen = () => {
    resetTestsState(viewState);
    resetCoverageState(viewState);
    // Initialize cursor to first selectable test
    const pkg = packages[viewState.summary.selectedIndex];
    const testRows = buildTestRows(states[pkg.name].testResults);
    const selectable = getSelectableIndices(testRows);
    viewState.tests.selectedIndex = selectable.length > 0 ? selectable[0] : 0;
  };

  const navigateForward = () => {
    if (viewState.currentScreen === 'summary') {
      // Enter tests screen for selected package
      viewState.currentScreen = 'tests';
      enterDetailScreen();
      process.stdout.write(ALT_SCREEN_ON);
      render();
    } else if (viewState.currentScreen === 'tests') {
      // Keep popover state when switching to coverage
      viewState.currentScreen = 'coverage';
      // Initialize cursor to first selectable file
      const pkg = packages[viewState.summary.selectedIndex];
      const { rows: covRows } = buildCoverageRows(pkg, rootDir);
      const selectable = getSelectableFileIndices(covRows);
      if (selectable.length > 0 && !selectable.includes(viewState.coverage.selectedIndex)) {
        viewState.coverage.selectedIndex = selectable[0];
      }
      render();
    }
    // coverage → nothing
  };

  const navigateBack = () => {
    if (viewState.currentScreen === 'coverage') {
      viewState.currentScreen = 'tests';
      render();
    } else if (viewState.currentScreen === 'tests') {
      if (viewState.tests.popoverVisible) {
        viewState.tests.popoverVisible = false;
        viewState.tests.popoverScrollOffset = 0;
      }
      viewState.currentScreen = 'summary';
      process.stdout.write(ALT_SCREEN_OFF);
      process.stdout.write(term.clearScreen);
      render();
    }
    // summary → nothing
  };

  /**
   * Switch to adjacent package while in tests or coverage screen.
   * Updates summary.selectedIndex (the single source of truth),
   * resets per-package view state, and re-renders.
   * @param {number} direction - +1 for next, -1 for previous
   */
  const switchPackage = (direction) => {
    const newIdx = viewState.summary.selectedIndex + direction;
    if (newIdx < 0 || newIdx >= packages.length) return;
    viewState.summary.selectedIndex = newIdx;
    // Close popover if open
    if (viewState.tests.popoverVisible) {
      viewState.tests.popoverVisible = false;
      viewState.tests.popoverScrollOffset = 0;
    }
    enterDetailScreen();
    // Also reset coverage cursor for the new package
    const pkg = packages[newIdx];
    const { rows: covRows } = buildCoverageRows(pkg, rootDir);
    const covSelectable = getSelectableFileIndices(covRows);
    viewState.coverage.selectedIndex = covSelectable.length > 0 ? covSelectable[0] : 0;
    viewState.coverage.scrollOffset = 0;
    render();
  };

  // ── Vertical navigation helpers ──

  const moveTestsCursor = (direction) => {
    const pkg = packages[viewState.summary.selectedIndex];
    const testRows = buildTestRows(states[pkg.name].testResults);
    const selectable = getSelectableIndices(testRows);
    if (selectable.length === 0) return;

    const currentPos = selectable.indexOf(viewState.tests.selectedIndex);
    if (currentPos === -1) {
      // Jump to nearest
      viewState.tests.selectedIndex = direction > 0 ? selectable[0] : selectable[selectable.length - 1];
    } else {
      const newPos = currentPos + direction;
      if (newPos >= 0 && newPos < selectable.length) {
        viewState.tests.selectedIndex = selectable[newPos];
      }
    }
  };

  const moveCoverageCursor = (direction) => {
    const pkg = packages[viewState.summary.selectedIndex];
    const { rows: covRows } = buildCoverageRows(pkg, rootDir);
    const selectable = getSelectableFileIndices(covRows);
    if (selectable.length === 0) return;

    const currentPos = selectable.indexOf(viewState.coverage.selectedIndex);
    if (currentPos === -1) {
      viewState.coverage.selectedIndex = direction > 0 ? selectable[0] : selectable[selectable.length - 1];
    } else {
      const newPos = currentPos + direction;
      if (newPos >= 0 && newPos < selectable.length) {
        viewState.coverage.selectedIndex = selectable[newPos];
      }
    }
  };

  // ── Action handlers ──

  const getSelectedPkg = () => {
    return packages[viewState.summary.selectedIndex];
  };

  const handleAction = (action) => {
    switch (action) {
      case 'rerun': {
        const pkg = getSelectedPkg();
        runPkg(pkg, `[${pkg.name}] Rerunning...`);
        break;
      }

      case 'rerun-all':
        runAll();
        break;

      case 'coverage': {
        const pkg = getSelectedPkg();
        const nowOn = togglePackageCoverage(pkg.name, coverageFlags, coverageSnapshot);
        if (nowOn) {
          runPkg(pkg, `[${pkg.name}] Coverage enabled, rerunning...`);
        } else {
          statusMessage = `[${pkg.name}] Coverage disabled`;
          render();
        }
        break;
      }

      case 'coverage-all': {
        const changedToOn = cycleCoverage(coverageFlags, coverageSnapshot);
        if (changedToOn.length > 0) {
          rerunPackages(changedToOn);
        } else {
          render();
        }
        break;
      }

      case 'watch':
        viewState.watchEnabled = !viewState.watchEnabled;
        if (viewState.watchEnabled) {
          watcherManager.start();
          statusMessage = 'File watching enabled';
        } else {
          watcherManager.stop();
          statusMessage = 'File watching disabled';
        }
        render();
        break;

      case 'help':
        viewState.helpVisible = true;
        render();
        break;

      case 'quit':
        cleanup();
        process.exit(0);
        break;
    }
  };

  // ── Enter action ──

  /**
   * Resolve a command template with placeholders and foobar2000-style
   * conditional sections.
   *
   * Placeholders: {filePath}, {line}, etc. — replaced with values from the map.
   * Conditional sections: [...] — included only if every {placeholder} inside
   * resolved to a non-empty value. Sections can't nest.
   *
   * @param {string} template - Command template string
   * @param {Record<string, string>} values - Placeholder → value map
   * @returns {string} Resolved command
   */
  const resolveCommand = (template, values) => {
    // 1. Process conditional sections: [literal{placeholder}literal...]
    //    Drop the section if any placeholder inside resolved to ''
    const withSections = template.replace(/\[([^\]]*)\]/g, (_match, inner) => {
      let allPresent = true;
      const resolved = inner.replace(/\{(\w+)\}/g, (_m, key) => {
        const val = values[key] ?? '';
        if (!val) allPresent = false;
        return val;
      });
      return allPresent ? resolved : '';
    });

    // 2. Replace remaining top-level placeholders
    return withSections.replace(/\{(\w+)\}/g, (_m, key) => values[key] ?? '');
  };

  /**
   * Fire-and-forget spawn of a resolved command string.
   */
  const spawnAction = (resolved) => {
    try {
      const child = spawn(resolved, { shell: true, detached: true, stdio: 'ignore' });
      child.unref();
    } catch {
      // Silently ignore spawn errors — don't crash interactive mode
    }
  };

  const executeEnterAction = () => {
    const actionCommand = config.enterAction?.command;
    if (!actionCommand) return;

    const pkg = getSelectedPkg();
    const testRows = buildTestRows(states[pkg.name].testResults);
    const row = testRows[viewState.tests.selectedIndex];
    if (!row || row.type !== 'test') return;

    const pkgFilePath = row.file || '';
    const absFilePath = pkgFilePath ? join(pkg.path, pkgFilePath) : '';
    const filePath = absFilePath ? relative(rootDir, absFilePath) : '';
    const fileName = pkgFilePath ? basename(pkgFilePath) : '';

    const line = row.test.status === 'failed'
      ? extractFailureLine(row.test.failureMessage, row.file)
      : '';

    spawnAction(resolveCommand(actionCommand, {
      filePath,
      pkgFilePath,
      absFilePath,
      fileName,
      line,
      testName: row.test.name,
      packagePath: pkg.path,
      packageName: pkg.name,
    }));
  };

  const executeCoverageEnterAction = () => {
    const actionCommand = config.enterAction?.command;
    if (!actionCommand) return;

    const pkg = getSelectedPkg();
    const { rows: covRows } = buildCoverageRows(pkg, rootDir);
    const selectableIndices = getSelectableFileIndices(covRows);
    const cursorRow = viewState.coverage.selectedIndex;
    if (!selectableIndices.includes(cursorRow)) return;

    const row = covRows[cursorRow];
    if (!row || row.type !== 'file') return;

    const absFilePath = row.absFile || '';
    const filePath = absFilePath ? relative(rootDir, absFilePath) : '';
    const fileName = absFilePath ? basename(absFilePath) : '';
    const pkgFilePath = absFilePath ? relative(pkg.path, absFilePath) : '';

    spawnAction(resolveCommand(actionCommand, {
      filePath,
      pkgFilePath,
      absFilePath,
      fileName,
      line: '',
      testName: '',
      packagePath: pkg.path,
      packageName: pkg.name,
    }));
  };

  // ── Single keypress handler ──

  const handleKeypress = (str, key) => {
    const evt = classifyKey(str, key);
    if (!evt) return;

    // Ctrl+C always works
    if (evt.type === 'ctrl-c') {
      cleanup();
      process.exit(0);
    }

    // Any keypress resets cursor dim
    dimTimer.reset();

    // 1. Help visible — only Escape closes it
    if (viewState.helpVisible) {
      if (evt.type === 'escape') {
        viewState.helpVisible = false;
        process.stdout.write(term.clearScreen);
        render();
      }
      return;
    }

    // 2. Popover visible (tests screen only)
    if (viewState.currentScreen === 'tests' && viewState.tests.popoverVisible) {
      if (evt.type === 'escape') {
        viewState.tests.popoverVisible = false;
        viewState.tests.popoverScrollOffset = 0;
        render();
        return;
      }

      if (evt.type === 'enter') {
        executeEnterAction();
        return;
      }

      if (evt.type === 'vertical') {
        viewState.tests.popoverScrollOffset = Math.max(0, viewState.tests.popoverScrollOffset + evt.direction);
        render();
        return;
      }

      // PgUp/PgDn switches package even with popover open
      if (evt.type === 'vertical-page') {
        switchPackage(evt.direction);
        return;
      }

      // Horizontal navigation: ← closes popover and goes back, → keeps popover and goes to coverage
      if (evt.type === 'horizontal') {
        if (evt.direction === -1) {
          viewState.tests.popoverVisible = false;
          viewState.tests.popoverScrollOffset = 0;
          navigateBack();
        } else {
          navigateForward(); // popover stays open when going to coverage
        }
        return;
      }

      // Actions work with popover open
      if (evt.type === 'action') {
        handleAction(evt.action);
        return;
      }

      return;
    }

    // 3. Normal mode — no popover, no help

    // Horizontal navigation
    if (evt.type === 'horizontal') {
      if (evt.direction === 1) navigateForward();
      else navigateBack();
      return;
    }

    // Vertical navigation
    if (evt.type === 'vertical') {
      switch (viewState.currentScreen) {
        case 'summary':
          viewState.summary.selectedIndex = Math.max(
            0,
            Math.min(packages.length - 1, viewState.summary.selectedIndex + evt.direction),
          );
          render();
          break;

        case 'tests':
          moveTestsCursor(evt.direction);
          render();
          break;

        case 'coverage':
          moveCoverageCursor(evt.direction);
          render();
          break;
      }
      return;
    }

    // Vertical page navigation
    if (evt.type === 'vertical-page') {
      if (viewState.currentScreen === 'summary') {
        const halfPage = Math.floor(packages.length / 2) || 1;
        viewState.summary.selectedIndex = Math.max(
          0,
          Math.min(packages.length - 1, viewState.summary.selectedIndex + evt.direction * halfPage),
        );
        render();
      } else {
        // tests or coverage — switch package
        switchPackage(evt.direction);
      }
      return;
    }

    // Enter
    if (evt.type === 'enter') {
      if (viewState.currentScreen === 'summary') {
        // Enter on summary → go to tests screen (same as →)
        navigateForward();
      } else if (viewState.currentScreen === 'tests') {
        const pkg = packages[viewState.summary.selectedIndex];
        const testRows = buildTestRows(states[pkg.name].testResults);
        const selectable = getSelectableIndices(testRows);
        if (selectable.includes(viewState.tests.selectedIndex)) {
          viewState.tests.popoverVisible = true;
          viewState.tests.popoverScrollOffset = 0;
          render();
        }
      } else if (viewState.currentScreen === 'coverage') {
        executeCoverageEnterAction();
      }
      return;
    }

    // Escape — does nothing when no popover/help is open
    if (evt.type === 'escape') {
      return;
    }

    // Actions
    if (evt.type === 'action') {
      handleAction(evt.action);
      return;
    }
  };

  // ── Watcher ──

  const watchMappings = config.watchMappings || [];
  const watcherManager = createWatcherManager(rootDir, packages, watchMappings, (pkg, _filePath, type) => {
    if (type === 'all') {
      runAll();
    } else {
      const source = type === 'mapped' ? ' (mapped)' : '';
      runPkg(pkg, `[${pkg.name}] File changed${source} → rerunning...`);
    }
  });

  // ── Cleanup ──

  const cleanup = () => {
    for (const [, child] of childProcesses) {
      if (child && !child.killed) child.kill('SIGTERM');
    }
    childProcesses.clear();

    if (spinnerInterval) clearInterval(spinnerInterval);
    dimTimer.stop();
    watcherManager.stop();

    // Restore terminal — leave alt screen if we're in it
    if (viewState.currentScreen !== 'summary') {
      process.stdout.write(ALT_SCREEN_OFF);
    }
    process.stdout.write(term.showCursor);
    if (process.stdin.setRawMode) process.stdin.setRawMode(false);
  };

  // ── Setup ──

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  if (!process.stdin.setRawMode) {
    console.error('Interactive mode requires a TTY. Run in a terminal.');
    process.exit(1);
  }

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('keypress', handleKeypress);

  process.stdout.write(term.hideCursor + term.clearScreen);

  // Initial render
  render();
  dimTimer.reset();

  // Spinner interval
  const spinnerInterval = setInterval(() => {
    viewState.spinnerIdx++;
    if (viewState.helpVisible) return;

    if (viewState.currentScreen === 'summary') {
      const anyRunning = Object.values(states).some((s) => s.status === 'running');
      if (anyRunning) render();
    } else {
      const pkg = packages[viewState.summary.selectedIndex];
      if (pkg && states[pkg.name].status === 'running') render();
    }
  }, spinner.interval);

  // Run all tests initially
  statusMessage = 'Running all packages...';
  const initialPromises = packages.map((pkg) =>
    runPackageTests(pkg, states[pkg.name], onUpdate, childProcesses, pendingReruns, (p) => {
      onPkgComplete(p);
      checkPendingRunAll();
    }, coverageFlags[pkg.name]),
  );
  await Promise.all(initialPromises);

  statusMessage = '';
  render();

  // Start watcher if enabled
  if (viewState.watchEnabled) {
    watcherManager.start();
  }
}
