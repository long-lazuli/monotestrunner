#!/usr/bin/env node
/**
 * CLI entry point for monotestrunner
 *
 * Parses CLI flags, discovers packages, and dispatches to the appropriate mode:
 * interactive, TTY, or CI.
 */

import meow from 'meow';

import { loadConfig, validateConfig } from './config.js';
import { discoverPackages } from './packages.js';
import { runInteractiveMode } from './views/interactive.js';
import { runTTY, runCI } from './runner.js';

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

const rootDir = process.cwd();
const verbose = cli.flags.verbose;
const coverage = cli.flags.coverage;
const watchInitial = cli.flags.watch;
const interactive = cli.flags.interactive || watchInitial; // -w implies -i
const isCI = process.env.CI === 'true';
const isInteractiveTTY = process.stdout.isTTY && !isCI;

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  const packages = discoverPackages(rootDir);

  if (packages.length === 0) {
    console.log('No packages found.');
    process.exit(0);
  }

  // Load and validate config
  const config = await loadConfig(rootDir);
  if (config.watchMappings) {
    validateConfig(config, packages, rootDir);
  }

  // Fallback mode: single package with no workspace config → skip summary
  const isSinglePackage = packages.length === 1 && packages[0].path === rootDir;
  // Packages that actually have tests and a recognized runner (for non-interactive modes)
  const testablePackages = packages.filter((p) => p.testScript !== null && p.runner !== null);

  if (interactive) {
    await runInteractiveMode(packages, rootDir, config, watchInitial, coverage, isSinglePackage);
    // Interactive mode doesn't exit normally
  } else {
    if (testablePackages.length === 0) {
      console.log('No packages with tests found.');
      process.exit(0);
    }
    const exitCode = isInteractiveTTY
      ? await runTTY(testablePackages, rootDir, verbose, coverage)
      : await runCI(testablePackages, rootDir, verbose, coverage);
    // Only exit with error code in CI to avoid pnpm ELIFECYCLE noise locally
    process.exit(isCI ? exitCode : 0);
  }
}

main();
