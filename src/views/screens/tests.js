/**
 * Tests screen renderer.
 *
 * Renders the per-package test list with cursor navigation.
 * When a popover is open, splits the screen: top half = test list, bottom half = popover.
 *
 * Pure rendering — writes to stdout, does not mutate state.
 */

import c from 'picocolors';
import { term, stripAnsi } from '../../ui.js';
import { renderDetailHeader, HEADER_LINES, FOOTER_LINES } from './header.js';
import { buildPopoverContent, renderPopover, getPopoverBoxHeight } from './popover.js';
import { getPackageThresholds } from '../../coverage.js';

/**
 * Build the flat list of test rows from JUnit results.
 * Each row is either a suite header or a test entry.
 *
 * @param {object|null} testResults - Parsed JUnit results { suites: [...] }
 * @returns {Array<{ text: string, type: 'blank'|'suite'|'test', test?: object, file?: string }>}
 */
export function buildTestRows(testResults) {
  const rows = [];

  if (!testResults || !testResults.suites || testResults.suites.length === 0) {
    return rows;
  }

  for (const suite of testResults.suites) {
    const testCount = suite.tests.length;

    // Blank line before suite (except first)
    if (rows.length > 0) {
      rows.push({ text: '', type: 'blank' });
    }

    // Suite header
    rows.push({
      text: `  ${c.bold(suite.file)} ${c.dim(`(${testCount} tests)`)}`,
      type: 'suite',
    });

    // Test entries
    for (const test of suite.tests) {
      const durationStr =
        test.duration >= 1 ? `${test.duration.toFixed(2)}s` : `${Math.round(test.duration * 1000)}ms`;

      let icon, nameText;
      if (test.status === 'passed') {
        icon = c.dim(c.green('✓'));
        nameText = c.dim(test.name);
      } else if (test.status === 'failed') {
        icon = c.red('✗');
        nameText = c.red(test.name);
      } else {
        icon = c.dim(c.yellow('⊘'));
        nameText = c.dim(c.yellow(test.name));
      }

      rows.push({
        text: `  ${icon} ${nameText}  ${c.dim(durationStr)}`,
        type: 'test',
        test,
        file: suite.file,
      });
    }
  }

  return rows;
}

/**
 * Get the indices of selectable rows (type === 'test').
 */
export function getSelectableIndices(rows) {
  const indices = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'test') {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Render the full tests screen.
 *
 * @param {object} opts
 * @param {object} opts.pkg - Package { name, runner, path, dir }
 * @param {object} opts.state - Package test state
 * @param {object} opts.testsState - viewState.tests
 * @param {boolean} opts.cursorDimmed - Global cursor dim
 * @param {boolean} opts.coverageEnabled - Coverage enabled for this package
 * @param {number} opts.spinnerIdx - Spinner frame index
 */
export function renderTestsScreen({ pkg, state, testsState, cursorDimmed, coverageEnabled, spinnerIdx }) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  process.stdout.write(term.moveTo(1, 1));

  // Header (5 lines)
  const thresholds = coverageEnabled ? getPackageThresholds(pkg) : null;
  renderDetailHeader({
    pkg,
    state,
    currentPage: 'tests',
    coverageEnabled,
    spinnerIdx,
    cols,
    thresholds,
  });

  // Content area
  const contentRows = rows - HEADER_LINES - FOOTER_LINES;
  const testRows = buildTestRows(state.testResults);
  const selectableIndices = getSelectableIndices(testRows);

  if (testRows.length === 0) {
    // No results yet
    for (let i = 0; i < contentRows; i++) {
      process.stdout.write(term.clearLine);
      if (i === 0) {
        console.log(c.dim('  No test results available. Press r to run tests.'));
      } else {
        console.log('');
      }
    }
  } else if (testsState.popoverVisible && selectableIndices.length > 0) {
    // Split screen: top half = test list, bottom half = popover
    renderSplitView(testRows, selectableIndices, testsState, cursorDimmed, contentRows, cols);
  } else {
    // Full screen test list
    renderFullList(testRows, selectableIndices, testsState, cursorDimmed, contentRows, cols);
  }

  // Footer
  const footerParts = testsState.popoverVisible
    ? ['←:back', '→:coverage', '↑↓:scroll', 'Esc:close', 'r:rerun', 'c:coverage', 'q:quit']
    : ['←:back', '→:coverage', '↑↓:select', 'Enter:detail', 'r:rerun', 'c:coverage', 'q:quit'];

  process.stdout.write(term.moveTo(rows, 1) + term.clearLine);
  process.stdout.write(` ${c.dim(footerParts.join('  '))}`);
}

/**
 * Render the test list using the full content area (no popover).
 */
function renderFullList(testRows, selectableIndices, testsState, cursorDimmed, contentRows, cols) {
  // Smart scroll: keep cursor visible
  const cursorRow = testsState.selectedIndex;
  if (cursorRow < testsState.scrollOffset) {
    testsState.scrollOffset = cursorRow;
  }
  if (cursorRow >= testsState.scrollOffset + contentRows) {
    testsState.scrollOffset = cursorRow - contentRows + 1;
  }

  // Clamp
  const maxScroll = Math.max(0, testRows.length - contentRows);
  testsState.scrollOffset = Math.max(0, Math.min(testsState.scrollOffset, maxScroll));

  const visible = testRows.slice(testsState.scrollOffset, testsState.scrollOffset + contentRows);

  for (let i = 0; i < contentRows; i++) {
    process.stdout.write(term.clearLine);
    if (i < visible.length) {
      const rowIdx = testsState.scrollOffset + i;
      const row = visible[i];
      const isSelected = selectableIndices.includes(rowIdx) && rowIdx === cursorRow;

      if (isSelected) {
        const marker = cursorDimmed ? c.gray('▶') : '▶';
        // Replace 2-space indent with marker + space
        const text = row.text.replace(/^ {2}/, marker + ' ');
        console.log(truncate(text, cols));
      } else {
        console.log(truncate(row.text, cols));
      }
    } else {
      console.log('');
    }
  }
}

/**
 * Render split view: test list on top, popover box at bottom.
 * Popover is sized to its content (max half the screen).
 */
function renderSplitView(testRows, selectableIndices, testsState, cursorDimmed, contentRows, cols) {
  const cursorRow = testsState.selectedIndex;
  const selectedRow = testRows[cursorRow];

  // Build popover content to determine its size
  const boxInnerWidth = cols - 4; // 1 margin + 1 border on each side
  let popoverContent = { header: [], body: [] };
  if (selectedRow && selectedRow.type === 'test') {
    popoverContent = buildPopoverContent(selectedRow.test, selectedRow.file, boxInnerWidth);
  }

  const hasContent = popoverContent.header.length > 0 || popoverContent.body.length > 0;

  // Popover box height: header + body + 2 borders, max half the content area
  const maxContentRows = Math.max(1, Math.floor(contentRows / 2) - 2); // -2 for borders within the half
  const boxHeight = hasContent
    ? getPopoverBoxHeight(popoverContent, maxContentRows)
    : 3; // minimal empty box

  // Layout: topRows + 1 (blank/... divider) + boxHeight = contentRows
  const topRows = Math.max(1, contentRows - 1 - boxHeight);

  // Smart scroll for top portion
  if (cursorRow < testsState.scrollOffset) {
    testsState.scrollOffset = cursorRow;
  }
  if (cursorRow >= testsState.scrollOffset + topRows) {
    testsState.scrollOffset = cursorRow - topRows + 1;
  }

  const maxScroll = Math.max(0, testRows.length - topRows);
  testsState.scrollOffset = Math.max(0, Math.min(testsState.scrollOffset, maxScroll));

  // Render top portion (test list) — no cursor marker, popover owns the cursor
  const visibleTop = testRows.slice(testsState.scrollOffset, testsState.scrollOffset + topRows);
  for (let i = 0; i < topRows; i++) {
    process.stdout.write(term.clearLine);
    if (i < visibleTop.length) {
      console.log(truncate(visibleTop[i].text, cols));
    } else {
      console.log('');
    }
  }

  // Divider line: blank if all rows visible, "  ..." if some hidden below
  const hasHiddenRows = testsState.scrollOffset + topRows < testRows.length;
  process.stdout.write(term.clearLine);
  console.log(hasHiddenRows ? c.dim('  ...') : '');

  // Render popover box
  renderPopover({
    content: popoverContent,
    scrollOffset: testsState.popoverScrollOffset,
    boxHeight,
    cols,
  });
}

// ============================================================================
// Utility
// ============================================================================

function truncate(str, maxCols) {
  const cleanLen = stripAnsi(str).length;
  if (cleanLen <= maxCols) return str;

  let visible = 0;
  let result = '';
  let i = 0;

  while (i < str.length && visible < maxCols - 1) {
    if (str[i] === '\x1b') {
      const end = str.indexOf('m', i);
      if (end !== -1) {
        result += str.substring(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    result += str[i];
    visible++;
    i++;
  }

  return result + '\x1b[0m…';
}
