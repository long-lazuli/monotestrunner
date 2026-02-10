/**
 * Help overlay renderer.
 *
 * Renders a full-screen help box with keyboard shortcuts.
 * Called with no arguments — computes its own width from terminal.
 */

import c from 'picocolors';
import { term } from '../ui.js';

const helpLines = [
  '',
  '  Keyboard Shortcuts',
  '  ──────────────────',
  '',
  '  Navigation',
  '    ↑/k         Move up',
  '    ↓/j         Move down',
  '    PgUp/Ctrl+U Previous package / half-page (summary)',
  '    PgDn/Ctrl+D Next package / half-page (summary)',
  '    →/l         Next screen',
  '    ←/h         Previous screen',
  '',
  '  Actions',
  '    Enter       Open popover / run configured action',
  '    Escape      Close popover / help',
  '    r           Rerun selected package',
  '    R           Rerun all packages',
  '',
  '  Modes',
  '    c           Toggle coverage (selected package)',
  '    C           Cycle coverage (all → none → restore)',
  '    w           Toggle watch mode',
  '',
  '  Other',
  '    ?           Show this help',
  '    q           Quit',
  '',
  '  Press Escape to close...',
  '',
];

/**
 * Render the help overlay to stdout.
 * Clears screen and draws a bordered box.
 */
export function renderHelp() {
  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(Math.max(44, termWidth - 4), 60);

  process.stdout.write(term.clearScreen + term.moveTo(1, 1));

  const topBorder = '┌' + '─'.repeat(boxWidth - 2) + '┐';
  const bottomBorder = '└' + '─'.repeat(boxWidth - 2) + '┘';

  let out = topBorder + '\n';
  for (const line of helpLines) {
    const paddedLine = line.padEnd(boxWidth - 4);
    out += '│ ' + paddedLine + ' │\n';
  }
  out += bottomBorder + '\n';

  process.stdout.write(out);
}
