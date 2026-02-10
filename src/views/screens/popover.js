/**
 * Popover renderer for test detail.
 *
 * Renders a bottom-half panel showing details for the selected test.
 * Pure rendering — writes to stdout, does not mutate state.
 */

import c from 'picocolors';
import { term, stripAnsi } from '../../ui.js';

/**
 * Number of fixed header lines in the popover (pinned, never scroll).
 * Line 1: separator ─
 * Line 2: test name with icon
 * Line 3: ▶ filepath (colored)
 * Line 4: separator ─ (joins box edges via ├─┤)
 */
export const POPOVER_HEADER_LINES = 4;

/**
 * Build the popover content as header (pinned) + body (scrollable).
 *
 * @param {object} test - { name, status, duration, failureMessage }
 * @param {string} file - Source file path
 * @param {number} innerWidth - Inner width available for content (cols minus box borders/padding)
 * @returns {{ header: string[], body: string[] }}
 */
export function buildPopoverContent(test, file, innerWidth = 74) {
  const sepWidth = Math.max(10, innerWidth - 2);

  // ── Header (pinned, 4 lines) ──

  const header = [];

  // Line 1: status icon + test name
  let icon;
  if (test.status === 'passed') icon = c.green('✓');
  else if (test.status === 'failed') icon = c.red('✗');
  else icon = c.yellow('⊘');
  header.push(` ${icon} ${c.bold(test.name)}`);

  // Line 2: separator
  header.push(c.dim(` ${'─'.repeat(sepWidth)}`));

  // Line 3: white cursor marker + file path colored by status
  if (file) {
    let coloredFile;
    if (test.status === 'passed') coloredFile = c.green(file);
    else if (test.status === 'failed') coloredFile = c.red(file);
    else coloredFile = c.yellow(file);
    header.push(` ${c.white('▶')} ${coloredFile}`);
  } else {
    header.push('');
  }

  // Line 4: full-width separator (rendered as ├─┤ by renderPopover)
  header.push(null); // sentinel: renderPopover draws ├─┤ for this

  // ── Body (scrollable) ──

  const body = [];

  // Duration
  const durationStr =
    test.duration >= 1 ? `${test.duration.toFixed(2)}s` : `${Math.round(test.duration * 1000)}ms`;
  body.push(` ${c.dim(durationStr)}`);

  // Failure message (for failed tests)
  if (test.status === 'failed' && test.failureMessage) {
    body.push('');
    for (const msgLine of test.failureMessage.split('\n')) {
      body.push(` ${c.dim(msgLine)}`);
    }
  }

  return { header, body };
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
