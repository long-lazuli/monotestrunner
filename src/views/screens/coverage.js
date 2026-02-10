/**
 * Coverage screen renderer.
 *
 * Renders per-file coverage data for a single package with cursor navigation.
 * Pure rendering — writes to stdout, does not mutate state.
 */

import c from 'picocolors';
import { term, formatCoveragePct, stripAnsi } from '../../ui.js';
import {
  parseLcovDetailed,
  aggregateStats,
  getPackageThresholds,
  shouldExcludeFile,
  getDisplayPath,
} from '../../coverage.js';
import { renderDetailHeader, HEADER_LINES, FOOTER_LINES } from './header.js';
import { buildCoveragePopoverContent, renderPopover, getPopoverBoxHeight } from './popover.js';
import { join, isAbsolute } from 'node:path';

/**
 * Build the flat list of coverage rows from lcov data.
 * Returns header, separator, file rows, separator, and totals.
 *
 * @param {object} pkg - Package { name, path, dir, runner }
 * @param {string} rootDir - Workspace root
 * @returns {{ rows: Array<{ text: string, type: 'header'|'separator'|'file'|'total', fileIndex?: number }>, fileWidth: number }}
 */
export function buildCoverageRows(pkg, rootDir) {
  const lcovPath = join(pkg.path, 'coverage', 'lcov.info');
  const files = parseLcovDetailed(lcovPath);
  const thresholds = getPackageThresholds(pkg);

  if (!files || files.length === 0) {
    return { rows: [], fileWidth: 40 };
  }

  const pkgRoot = join(rootDir, pkg.dir, pkg.name);
  const relevantFiles = files.filter((f) => !shouldExcludeFile(f.file));
  // Resolve SF: paths — vitest writes relative paths, bun may write absolute
  const absFiles = relevantFiles.map((f) => isAbsolute(f.file) ? f.file : join(pkgRoot, f.file));
  const displayPaths = relevantFiles.map((f, i) => getDisplayPath(absFiles[i], pkgRoot));
  const fileWidth = Math.max(40, ...displayPaths.map((p) => p.length));
  const th = thresholds || {};

  const rows = [];

  // Header
  rows.push({
    text: c.dim(`    ${'File'.padEnd(fileWidth)}  ${'Lines'.padStart(8)}  ${'Branch'.padStart(8)}  ${'Funcs'.padStart(8)}`),
    type: 'header',
  });

  // Separator
  rows.push({
    text: c.dim(`    ${'─'.repeat(fileWidth + 30)}`),
    type: 'separator',
  });

  // File rows
  for (let i = 0; i < relevantFiles.length; i++) {
    const f = relevantFiles[i];
    const relPath = displayPaths[i];
    const fLines = f.linesTotal ? ((f.linesHit / f.linesTotal) * 100).toFixed(1) : '-';
    const fBranches = f.branchesTotal ? ((f.branchesHit / f.branchesTotal) * 100).toFixed(1) : '-';
    const fFunctions = f.functionsTotal ? ((f.functionsHit / f.functionsTotal) * 100).toFixed(1) : '-';

    const fl = formatCoveragePct(fLines, 8, th.lines);
    const fb = formatCoveragePct(fBranches, 8, th.branches);
    const ff = formatCoveragePct(fFunctions, 8, th.functions);

    rows.push({
      text: `    ${c.dim(relPath.padEnd(fileWidth))}  ${fl.text}  ${fb.text}  ${ff.text}`,
      type: 'file',
      fileIndex: i,
      absFile: absFiles[i],
      displayPath: relPath,
      lineHits: f.lineHits,
      branchHits: f.branchHits,
      fileStats: {
        lines: fLines,
        branches: fBranches,
        functions: fFunctions,
      },
    });
  }

  // Separator
  rows.push({
    text: c.dim(`    ${'─'.repeat(fileWidth + 30)}`),
    type: 'separator',
  });

  // Totals
  const stats = aggregateStats(relevantFiles);
  const tl = formatCoveragePct(stats.lines, 8, th.lines);
  const tb = formatCoveragePct(stats.branches, 8, th.branches);
  const tf = formatCoveragePct(stats.functions, 8, th.functions);
  rows.push({
    text: `    ${c.bold('Total'.padEnd(fileWidth))}  ${tl.text}  ${tb.text}  ${tf.text}`,
    type: 'total',
  });

  return { rows, fileWidth };
}

/**
 * Get the indices of selectable rows (type === 'file').
 */
export function getSelectableFileIndices(rows) {
  const indices = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'file') {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Render the full coverage screen.
 *
 * @param {object} opts
 * @param {object} opts.pkg - Package { name, runner, path, dir }
 * @param {object} opts.state - Package test state
 * @param {object} opts.coverageState - viewState.coverage
 * @param {boolean} opts.cursorDimmed - Global cursor dim
 * @param {boolean} opts.coverageEnabled - Coverage enabled for this package
 * @param {number} opts.spinnerIdx - Spinner frame index
 * @param {string} opts.rootDir - Workspace root
 */
export function renderCoverageScreen({ pkg, state, coverageState, cursorDimmed, coverageEnabled, spinnerIdx, rootDir }) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  process.stdout.write(term.moveTo(1, 1));

  // Header (5 lines)
  const thresholds = coverageEnabled ? getPackageThresholds(pkg) : null;
  renderDetailHeader({
    pkg,
    state,
    currentPage: 'coverage',
    coverageEnabled,
    spinnerIdx,
    cols,
    thresholds,
  });

  // Content area
  const contentRows = rows - HEADER_LINES - FOOTER_LINES;

  if (!coverageEnabled) {
    renderCenteredMessage(contentRows, [
      '  Coverage is not enabled for this package.',
      '  Press c to enable coverage and rerun.',
    ]);
  } else {
    const { rows: covRows } = buildCoverageRows(pkg, rootDir);
    const selectableIndices = getSelectableFileIndices(covRows);

    if (covRows.length === 0) {
      // Context-aware message based on test state
      const messages = getCoverageEmptyMessage(state);
      renderCenteredMessage(contentRows, messages);
    } else if (coverageState.popoverVisible && selectableIndices.length > 0) {
      renderCoverageSplitView(covRows, selectableIndices, coverageState, cursorDimmed, contentRows, cols);
    } else {
      renderCoverageList(covRows, selectableIndices, coverageState, cursorDimmed, contentRows, cols);
    }
  }

  // Footer
  const footerParts = coverageState.popoverVisible
    ? ['←:tests', '↑↓:navigate', 'Esc:close', 'Enter:open', 'r:rerun', 'c:coverage', 'q:quit']
    : ['←:tests', '↑↓:select', 'Enter:detail', 'r:rerun', 'c:coverage', 'q:quit'];
  process.stdout.write(term.moveTo(rows, 1) + term.clearLine);
  process.stdout.write(` ${c.dim(footerParts.join('  '))}`);
}

/**
 * Render the scrollable coverage file list with cursor.
 */
function renderCoverageList(covRows, selectableIndices, coverageState, cursorDimmed, contentRows, cols) {
  // Smart scroll: keep cursor visible
  const cursorRow = coverageState.selectedIndex;
  if (cursorRow < coverageState.scrollOffset) {
    coverageState.scrollOffset = cursorRow;
  }
  if (cursorRow >= coverageState.scrollOffset + contentRows) {
    coverageState.scrollOffset = cursorRow - contentRows + 1;
  }

  // Clamp
  const maxScroll = Math.max(0, covRows.length - contentRows);
  coverageState.scrollOffset = Math.max(0, Math.min(coverageState.scrollOffset, maxScroll));

  const visible = covRows.slice(coverageState.scrollOffset, coverageState.scrollOffset + contentRows);

  for (let i = 0; i < contentRows; i++) {
    process.stdout.write(term.clearLine);
    if (i < visible.length) {
      const rowIdx = coverageState.scrollOffset + i;
      const row = visible[i];
      const isSelected = selectableIndices.includes(rowIdx) && rowIdx === cursorRow;

      if (isSelected) {
        const marker = cursorDimmed ? c.gray('▶') : '▶';
        const text = row.text.replace(/^ {4}/, '  ' + marker + ' ');
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
 * Render split view: file list on top, coverage popover at bottom.
 * Popover shows annotated source lines with coverage status.
 */
function renderCoverageSplitView(covRows, selectableIndices, coverageState, cursorDimmed, contentRows, cols) {
  const cursorRow = coverageState.selectedIndex;
  const selectedRow = covRows[cursorRow];

  // Build popover content for the selected file
  const boxInnerWidth = cols - 4; // 1 margin + 1 border on each side
  let popoverContent = { header: [], body: [], selectableBodyIndices: [] };
  if (selectedRow && selectedRow.type === 'file') {
    popoverContent = buildCoveragePopoverContent({
      absFile: selectedRow.absFile,
      displayPath: selectedRow.displayPath,
      lineHits: selectedRow.lineHits,
      branchHits: selectedRow.branchHits,
      fileStats: selectedRow.fileStats,
      innerWidth: boxInnerWidth,
    });
  }

  const hasContent = popoverContent.header.length > 0 || popoverContent.body.length > 0;

  // Popover box height: header + body + 2 borders, max half the content area
  const maxContentRowsForPopover = Math.max(1, Math.floor(contentRows / 2) - 2);
  const boxHeight = hasContent
    ? getPopoverBoxHeight(popoverContent, maxContentRowsForPopover)
    : 3;

  // Layout: topRows + 1 (divider) + boxHeight = contentRows
  const topRows = Math.max(1, contentRows - 1 - boxHeight);

  // Smart scroll for top portion
  if (cursorRow < coverageState.scrollOffset) {
    coverageState.scrollOffset = cursorRow;
  }
  if (cursorRow >= coverageState.scrollOffset + topRows) {
    coverageState.scrollOffset = cursorRow - topRows + 1;
  }

  const maxScroll = Math.max(0, covRows.length - topRows);
  coverageState.scrollOffset = Math.max(0, Math.min(coverageState.scrollOffset, maxScroll));

  // Render top portion (file list) — no cursor marker when popover owns it
  const visibleTop = covRows.slice(coverageState.scrollOffset, coverageState.scrollOffset + topRows);
  for (let i = 0; i < topRows; i++) {
    process.stdout.write(term.clearLine);
    if (i < visibleTop.length) {
      console.log(truncate(visibleTop[i].text, cols));
    } else {
      console.log('');
    }
  }

  // Divider line
  const hasHiddenRows = coverageState.scrollOffset + topRows < covRows.length;
  process.stdout.write(term.clearLine);
  console.log(hasHiddenRows ? c.dim('    ...') : '');

  // Apply cursor marker to selected body line before rendering
  if (coverageState.popoverCursorIndex >= 0 && popoverContent.selectableBodyIndices) {
    const bodyIdx = popoverContent.selectableBodyIndices[coverageState.popoverCursorIndex];
    if (bodyIdx !== undefined && bodyIdx < popoverContent.body.length) {
      const marker = cursorDimmed ? c.gray('▶') : '▶';
      // Replace leading space with marker
      const line = popoverContent.body[bodyIdx];
      popoverContent.body[bodyIdx] = marker + (line ? line.slice(1) : '');
    }
  }

  // Render popover box
  renderPopover({
    content: popoverContent,
    scrollOffset: coverageState.popoverScrollOffset,
    boxHeight,
    cols,
  });
}

// ============================================================================
// Empty state messages
// ============================================================================

/**
 * Get context-aware messages for when coverage data is empty.
 * @param {object} state - Package test state
 * @returns {string[]} - Lines to display
 */
function getCoverageEmptyMessage(state) {
  if (state.status === 'running') {
    return ['  Tests are running...'];
  }
  if (state.status === 'pending') {
    return [
      '  Tests have not run yet.',
      '  Press r to run tests.',
    ];
  }
  if (state.failed > 0 || state.exitCode !== 0) {
    return [
      '  Tests failed — coverage data was not generated.',
      '  Fix failing tests and rerun to generate coverage.',
    ];
  }
  return [
    '  No coverage data found.',
    '  The test runner may not have generated coverage output.',
  ];
}

/**
 * Render a centered dimmed message block in the content area.
 * @param {number} contentRows - Available rows
 * @param {string[]} messages - Lines to display
 */
function renderCenteredMessage(contentRows, messages) {
  const startLine = Math.max(0, Math.floor((contentRows - messages.length) / 2));
  for (let i = 0; i < contentRows; i++) {
    process.stdout.write(term.clearLine);
    const msgIdx = i - startLine;
    if (msgIdx >= 0 && msgIdx < messages.length) {
      console.log(c.dim(messages[msgIdx]));
    } else {
      console.log('');
    }
  }
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
