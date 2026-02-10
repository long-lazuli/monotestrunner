/**
 * Input classification helpers.
 *
 * Classifies raw keypress events into semantic categories:
 * vertical, horizontal, context (Enter/Escape), action letters.
 * No state, no side effects — pure classification.
 */

/**
 * @typedef {object} KeypressEvent
 * @property {string|undefined} str - Character string
 * @property {object|undefined} key - Key object from readline
 */

/**
 * Classify a keypress into a semantic action.
 *
 * @param {string} str - Character string
 * @param {object} key - Key object from readline
 * @returns {{ type: string, direction?: number, action?: string } | null}
 *
 * Return types:
 *   { type: 'vertical', direction: -1 | 1 }           — ↑/k or ↓/j
 *   { type: 'vertical-page', direction: -1 | 1 }       — PgUp/Ctrl+U or PgDn/Ctrl+D
 *   { type: 'horizontal', direction: -1 | 1 }           — ←/h or →/l
 *   { type: 'enter' }                                    — Enter
 *   { type: 'escape' }                                   — Escape
 *   { type: 'action', action: string }                   — r/R/c/C/w/q/?
 *   { type: 'ctrl-c' }                                   — Ctrl+C
 *   null                                                  — unrecognized
 */
export function classifyKey(str, key) {
  // Ctrl+C — always recognized
  if (key && key.ctrl && key.name === 'c') {
    return { type: 'ctrl-c' };
  }

  // Enter
  if (key && key.name === 'return') {
    return { type: 'enter' };
  }

  // Escape
  if (key && key.name === 'escape') {
    return { type: 'escape' };
  }

  // Vertical navigation
  if ((key && key.name === 'up') || str === 'k') {
    return { type: 'vertical', direction: -1 };
  }
  if ((key && key.name === 'down') || str === 'j') {
    return { type: 'vertical', direction: 1 };
  }

  // Vertical page navigation
  if ((key && key.name === 'pageup') || (key && key.ctrl && key.name === 'u')) {
    return { type: 'vertical-page', direction: -1 };
  }
  if ((key && key.name === 'pagedown') || (key && key.ctrl && key.name === 'd')) {
    return { type: 'vertical-page', direction: 1 };
  }

  // Horizontal navigation
  if ((key && key.name === 'left') || str === 'h') {
    return { type: 'horizontal', direction: -1 };
  }
  if ((key && key.name === 'right') || str === 'l') {
    return { type: 'horizontal', direction: 1 };
  }

  // Action keys
  if (str === 'r') return { type: 'action', action: 'rerun' };
  if (str === 'R') return { type: 'action', action: 'rerun-all' };
  if (str === 'c') return { type: 'action', action: 'coverage' };
  if (str === 'C') return { type: 'action', action: 'coverage-all' };
  if (str === 'w') return { type: 'action', action: 'watch' };
  if (str === 'q') return { type: 'action', action: 'quit' };
  if (str === '?') return { type: 'action', action: 'help' };

  return null;
}
