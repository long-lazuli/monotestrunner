/**
 * Popover renderer for test and coverage detail.
 *
 * Renders a bottom-half panel showing details for the selected item.
 * Pure rendering — writes to stdout, does not mutate state.
 */

import c from 'picocolors';
import { readFileSync } from 'node:fs';
import { term, stripAnsi } from '../../ui.js';
import { getLineCoverageStatus } from '../../coverage.js';

/**
 * Build the popover content as header (pinned) + body (scrollable).
 *
 * Passed/skipped: compact (3 header lines, no body, no ├─┤)
 *   Line 1: icon + test name
 *   Line 2: separator ─
 *   Line 3: ▶ filepath + right-aligned "pass: Nms" or "skipped"
 *
 * Failed: expanded (4 header lines + scrollable body)
 *   Line 1: icon + test name
 *   Line 2: separator ─
 *   Line 3: ▶ filepath + right-aligned "failed"
 *   Line 4: null sentinel (├─┤)
 *   Body: duration, blank, failure message lines
 *
 * @param {object} test - { name, status, duration, failureMessage }
 * @param {string} file - Source file path
 * @param {number} innerWidth - Inner width available for content (cols minus box borders/padding)
 * @returns {{ header: string[], body: string[] }}
 */
export function buildPopoverContent(test, file, innerWidth = 74) {
  const sepWidth = Math.max(10, innerWidth - 2);
  const header = [];

  // Line 1: status icon + test name
  let icon;
  if (test.status === 'passed') icon = c.green('✓');
  else if (test.status === 'failed') icon = c.red('✗');
  else icon = c.yellow('⊘');
  header.push(` ${icon} ${c.bold(test.name)}`);

  // Line 2: separator
  header.push(c.dim(` ${'─'.repeat(sepWidth)}`));

  // Line 3: ▶ filepath + right-aligned status tag
  if (file) {
    let coloredFile, statusTag;
    if (test.status === 'passed') {
      coloredFile = c.green(file);
      const durationStr = test.duration >= 1
        ? `${test.duration.toFixed(2)}s`
        : `${Math.round(test.duration * 1000)}ms`;
      statusTag = c.dim(`pass: ${durationStr}`);
    } else if (test.status === 'failed') {
      coloredFile = c.red(file);
      statusTag = c.red('failed');
    } else {
      coloredFile = c.yellow(file);
      statusTag = c.dim('skipped');
    }

    const leftPart = ` ${c.white('▶')} ${coloredFile}`;
    const leftLen = stripAnsi(leftPart).length;
    const tagLen = stripAnsi(statusTag).length;
    const gap = Math.max(2, innerWidth - leftLen - tagLen);
    header.push(`${leftPart}${' '.repeat(gap)}${statusTag}`);
  } else {
    header.push('');
  }

  // Failed: add ├─┤ sentinel + scrollable body
  if (test.status === 'failed') {
    header.push(null); // sentinel: renderPopover draws ├─┤ for this

    const body = [];
    const durationStr = test.duration >= 1
      ? `${test.duration.toFixed(2)}s`
      : `${Math.round(test.duration * 1000)}ms`;
    body.push(` ${c.dim(durationStr)}`);

    if (test.failureMessage) {
      body.push('');
      for (const msgLine of test.failureMessage.split('\n')) {
        body.push(` ${c.dim(msgLine)}`);
      }
    }

    return { header, body };
  }

  // Passed/skipped: compact — no body
  return { header, body: [] };
}

/**
 * Get the total height of the popover box.
 * Box = top border + header (pinned) + body (scrollable, clamped) + bottom border.
 *
 * @param {{ header: string[], body: string[] }} content - From buildPopoverContent
 * @param {number} maxContentRows - Max total content rows (header + body, excluding borders)
 * @returns {number} - Total box height including borders
 */
export function getPopoverBoxHeight(content, maxContentRows) {
  const headerLen = content.header.length;
  const maxBodyRows = Math.max(0, maxContentRows - headerLen);
  const bodyRows = Math.min(content.body.length, maxBodyRows);
  return headerLen + bodyRows + 2; // +2 for top and bottom border
}

/**
 * Render the popover as a bordered box with pinned header and scrollable body.
 *
 * @param {object} opts
 * @param {{ header: string[], body: string[] }} opts.content - From buildPopoverContent
 * @param {number} opts.scrollOffset - Scroll position within body
 * @param {number} opts.boxHeight - Total box height (from getPopoverBoxHeight)
 * @param {number} opts.cols - Terminal columns
 */
export function renderPopover({ content, scrollOffset, boxHeight, cols }) {
  const boxWidth = cols - 2; // 1 char margin on each side
  const innerWidth = boxWidth - 2; // inside the │ borders
  const headerLen = content.header.length;
  const bodyRows = boxHeight - 2 - headerLen; // total content - borders - header

  // Top border
  process.stdout.write(term.clearLine);
  console.log(` ${c.dim('┌' + '─'.repeat(innerWidth) + '┐')}`);

  // Pinned header lines
  for (const line of content.header) {
    process.stdout.write(term.clearLine);
    if (line === null) {
      // Full-width separator joining box edges
      console.log(` ${c.dim('├' + '─'.repeat(innerWidth) + '┤')}`);
    } else {
      renderBoxLine(line, innerWidth);
    }
  }

  // Scrollable body
  const maxScroll = Math.max(0, content.body.length - bodyRows);
  const clampedOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
  const visibleBody = content.body.slice(clampedOffset, clampedOffset + bodyRows);

  for (let i = 0; i < bodyRows; i++) {
    process.stdout.write(term.clearLine);
    const line = i < visibleBody.length ? visibleBody[i] : '';
    renderBoxLine(line, innerWidth);
  }

  // Bottom border
  process.stdout.write(term.clearLine);
  console.log(` ${c.dim('└' + '─'.repeat(innerWidth) + '┘')}`);
}

/**
 * Render a single line inside the box with │ borders and padding.
 */
function renderBoxLine(line, innerWidth) {
  const truncated = truncate(line, innerWidth);
  const truncatedLen = stripAnsi(truncated).length;
  const pad = Math.max(0, innerWidth - truncatedLen);
  console.log(` ${c.dim('│')}${truncated}${' '.repeat(pad)}${c.dim('│')}`);
}

/**
 * Calculate the max scroll offset for popover body.
 */
export function getPopoverMaxScroll(content, maxContentRows) {
  const maxBodyRows = Math.max(0, maxContentRows - content.header.length);
  return Math.max(0, content.body.length - maxBodyRows);
}

// ============================================================================
// Coverage file popover
// ============================================================================

/**
 * Build popover content for a coverage file detail view.
 *
 * Header:
 *   Line 1: ▶ filepath + right-aligned per-file coverage pcts
 *   Line 2: separator ─
 *   Line 3: null sentinel (├─┤)
 *
 * Body: ALL source lines with coverage annotations:
 *   "  12 │  3 │ const x = foo();"     covered (green dim)
 *   "  13 │  0 │ if (bar) {"           uncovered (red)
 *   "  14 │  1 │   halfCovered()"      partial (yellow)
 *   "  15 │    │ }"                     not instrumented (dim)
 *
 * @param {object} opts
 * @param {string} opts.absFile - Absolute path to source file
 * @param {string} opts.displayPath - Relative display path
 * @param {Map<number, number>} opts.lineHits - DA: data
 * @param {Map<number, {total: number, taken: number}>} opts.branchHits - BRDA: data
 * @param {object} opts.fileStats - { lines, branches, functions } percentage strings
 * @param {number} opts.innerWidth - Inner box width
 * @returns {{ header: string[], body: string[], selectableBodyIndices: number[] }}
 */
export function buildCoveragePopoverContent({ absFile, displayPath, lineHits, branchHits, fileStats, innerWidth = 74 }) {
  const sepWidth = Math.max(10, innerWidth - 2);
  const header = [];

  // Line 1: ▶ filepath + right-aligned coverage percentages
  const statsTag = c.dim(
    `L:${fileStats.lines}%  B:${fileStats.branches}%  F:${fileStats.functions}%`
  );
  const leftPart = ` ${c.white('▶')} ${c.cyan(displayPath)}`;
  const leftLen = stripAnsi(leftPart).length;
  const tagLen = stripAnsi(statsTag).length;
  const gap = Math.max(2, innerWidth - leftLen - tagLen);
  header.push(`${leftPart}${' '.repeat(gap)}${statsTag}`);

  // Line 2: separator
  header.push(c.dim(` ${'─'.repeat(sepWidth)}`));

  // Line 3: ├─┤ sentinel
  header.push(null);

  // Body: read source file and annotate each line
  const body = [];
  const selectableBodyIndices = [];

  let sourceLines;
  try {
    sourceLines = readFileSync(absFile, 'utf-8').split('\n');
  } catch {
    body.push(c.dim(' (unable to read source file)'));
    return { header, body, selectableBodyIndices };
  }

  // Calculate gutter widths
  const lineNumWidth = String(sourceLines.length).length;

  for (let i = 0; i < sourceLines.length; i++) {
    const lineNum = i + 1;
    const status = getLineCoverageStatus(lineNum, lineHits, branchHits);
    const lineNumStr = String(lineNum).padStart(lineNumWidth);
    const sourceLine = sourceLines[i];

    let hitsStr;
    if (status === null) {
      hitsStr = ' '.repeat(3);
    } else {
      const count = lineHits.get(lineNum) ?? 0;
      hitsStr = String(count).padStart(3);
    }

    const raw = ` ${lineNumStr} ${c.dim('│')} ${hitsStr} ${c.dim('│')} ${sourceLine}`;

    if (status === 'uncovered') {
      body.push(c.red(stripAnsi(raw)));
      selectableBodyIndices.push(body.length - 1);
    } else if (status === 'partial') {
      body.push(c.yellow(stripAnsi(raw)));
      selectableBodyIndices.push(body.length - 1);
    } else if (status === 'covered') {
      body.push(c.dim(c.green(stripAnsi(raw))));
    } else {
      // not instrumented
      body.push(c.dim(raw));
    }
  }

  return { header, body, selectableBodyIndices };
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Truncate a string to fit within a given column width,
 * accounting for ANSI escape codes.
 */
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
