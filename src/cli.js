#!/usr/bin/env node
/**
 * CLI entry point for monotestrunner
 *
 * Parses CLI flags, discovers packages, and dispatches to the appropriate mode:
 * interactive, TTY, or CI.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import meow from 'meow';

import { loadConfig, validateConfig } from './config.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../../..');
const verbose = cli.flags.verbose;
const coverage = cli.flags.coverage;
const watchInitial = cli.flags.watch;
const interactive = cli.flags.interactive || watchInitial; // -w implies -i
const isCI = process.env.CI === 'true';
const isInteractiveTTY = process.stdout.isTTY && !isCI;

/**
 * Find all packages with test scripts
 */
function findPackages() {
  const packages = [];
  const dirs = ['packages', 'plugins', 'apps'];

  for (const dir of dirs) {
    const dirPath = join(rootDir, dir);
    if (!existsSync(dirPath)) continue;

    for (const name of readdirSync(dirPath)) {
      const pkgPath = join(dirPath, name);
      const pkgJsonPath = join(pkgPath, 'package.json');

      if (!existsSync(pkgJsonPath)) continue;

      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        if (pkgJson.scripts?.test) {
          packages.push({
            name,
            dir,
            path: pkgPath,
            testScript: pkgJson.scripts.test,
            runner: pkgJson.scripts.test.includes('vitest') ? 'vitest' : 'bun',
          });
        }
      } catch {
        // Skip invalid package.json
      }
    }
  }

  return packages;
}

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  const packages = findPackages();

  if (packages.length === 0) {
    console.log('No packages with tests found.');
    process.exit(0);
  }

  // Load and validate config
  const config = await loadConfig(rootDir);
  if (config.watchMappings) {
    validateConfig(config, packages, rootDir);
  }

  if (interactive) {
    await runInteractiveMode(packages, rootDir, config, watchInitial, coverage);
    // Interactive mode doesn't exit normally
  } else {
    const exitCode = isInteractiveTTY
      ? await runTTY(packages, rootDir, verbose, coverage)
      : await runCI(packages, rootDir, verbose, coverage);
    // Only exit with error code in CI to avoid pnpm ELIFECYCLE noise locally
    process.exit(isCI ? exitCode : 0);
  }
}

main();
