/**
 * State management for interactive mode.
 *
 * Owns: viewState (navigation/UI), coverageFlags (per-package),
 * coverage snapshot (for C cycle), and global cursor dim timer.
 */

const CURSOR_DIM_DELAY = 3000;

/**
 * Create the initial view state for interactive mode.
 */
export function createViewState() {
  return {
    currentScreen: 'summary', // 'summary' | 'tests' | 'coverage'
    helpVisible: false,
    cursorDimmed: false, // global — any keypress undims
    spinnerIdx: 0,

    summary: {
      selectedIndex: 0,
    },

    tests: {
      selectedIndex: 0,
      scrollOffset: 0,
      popoverVisible: false,
      popoverScrollOffset: 0,
    },

    coverage: {
      selectedIndex: 0,
      scrollOffset: 0,
    },
  };
}

/**
 * Create per-package coverage flags.
 * @param {Array} packages - Package list
 * @param {boolean} initialValue - Initial coverage state (from CLI --coverage flag)
 * @returns {{ flags: object, snapshot: object }}
 */
export function createCoverageFlags(packages, initialValue = false) {
  const flags = {};
  for (const pkg of packages) {
    flags[pkg.name] = initialValue;
  }
  return {
    flags,
    snapshot: { ...flags },
  };
}

/**
 * Get the current coverage mode across all packages.
 * @param {object} flags - Coverage flags { [pkgName]: boolean }
 * @returns {'all' | 'none' | 'some'}
 */
export function getCoverageMode(flags) {
  const values = Object.values(flags);
  if (values.length === 0) return 'none';
  const allOn = values.every((v) => v);
  const allOff = values.every((v) => !v);
  if (allOn) return 'all';
  if (allOff) return 'none';
  return 'some';
}

/**
 * Apply the global coverage cycle (C key).
 * some -> all -> none -> restore snapshot -> ...
 *
 * @param {object} flags - Coverage flags (mutated in place)
 * @param {object} snapshot - Snapshot to save/restore (mutated in place)
 * @returns {string[]} - Package names whose coverage was turned ON (need rerun)
 */
export function cycleCoverage(flags, snapshot) {
  const mode = getCoverageMode(flags);
  const changedToOn = [];

  if (mode === 'some') {
    // Save current mixed state, turn all on
    Object.assign(snapshot, { ...flags });
    for (const name of Object.keys(flags)) {
      if (!flags[name]) {
        flags[name] = true;
        changedToOn.push(name);
      }
    }
  } else if (mode === 'all') {
    // Turn all off
    for (const name of Object.keys(flags)) {
      flags[name] = false;
    }
  } else {
    // none -> restore snapshot
    for (const name of Object.keys(flags)) {
      const was = flags[name];
      flags[name] = !!snapshot[name];
      if (!was && flags[name]) {
        changedToOn.push(name);
      }
    }
  }

  return changedToOn;
}

/**
 * Toggle coverage for a single package (c key).
 * Updates snapshot if result is a 'some' state.
 *
 * @param {string} pkgName - Package name
 * @param {object} flags - Coverage flags (mutated)
 * @param {object} snapshot - Snapshot (mutated if result is 'some')
 * @returns {boolean} - New value (true = turned on, false = turned off)
 */
export function togglePackageCoverage(pkgName, flags, snapshot) {
  flags[pkgName] = !flags[pkgName];
  const mode = getCoverageMode(flags);
  if (mode === 'some') {
    Object.assign(snapshot, { ...flags });
  }
  return flags[pkgName];
}

/**
 * Reset tests page state for a new package.
 */
export function resetTestsState(viewState) {
  viewState.tests.selectedIndex = 0;
  viewState.tests.scrollOffset = 0;
  viewState.tests.popoverVisible = false;
  viewState.tests.popoverScrollOffset = 0;
}

/**
 * Reset coverage page state for a new package.
 */
export function resetCoverageState(viewState) {
  viewState.coverage.selectedIndex = 0;
  viewState.coverage.scrollOffset = 0;
}

// ============================================================================
// Global cursor dim timer
// ============================================================================

/**
 * Create a single global cursor dim timer.
 * Any keypress resets it. After 3s of inactivity, cursorDimmed = true.
 *
 * @param {object} viewState - The viewState (has cursorDimmed field)
 * @param {Function} onDimChange - Called when dim state changes (to trigger render)
 * @returns {{ reset: Function, stop: Function }}
 */
export function createCursorDimTimer(viewState, onDimChange) {
  let timeout = null;

  const reset = () => {
    if (timeout) clearTimeout(timeout);
    if (viewState.cursorDimmed) {
      viewState.cursorDimmed = false;
      onDimChange();
    }
    timeout = setTimeout(() => {
      viewState.cursorDimmed = true;
      onDimChange();
    }, CURSOR_DIM_DELAY);
  };

  const stop = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return { reset, stop };
}
