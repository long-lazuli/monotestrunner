#!/usr/bin/env node
/**
 * Tests for test-summary
 *
 * Tests the parsing functions for vitest and bun output formats,
 * including pass, skip, and fail scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stripAnsi } from './src/ui.js';
import {
  parseVitestFinal,
  parseBunFinal,
  countVitestDots,
  countBunDots,
  extractFailureLine,
} from './src/parsers.js';
import { resolveCommand } from './src/views/command.js';
import { parseLcovDetailed, getLineCoverageStatus } from './src/coverage.js';
import { getRunner, detectRunner, getRunnerNames } from './src/runners/index.js';
import * as vitestRunner from './src/runners/vitest.js';
import * as bunRunner from './src/runners/bun.js';
import { parsePnpmWorkspaceYaml, discoverPackages } from './src/packages.js';

// =============================================================================
// TESTS
// =============================================================================

describe('stripAnsi', () => {
  it('should strip ANSI color codes', () => {
    const input = '\x1b[32mgreen\x1b[0m \x1b[31mred\x1b[0m';
    expect(stripAnsi(input)).toBe('green red');
  });

  it('should handle strings without ANSI codes', () => {
    const input = 'plain text';
    expect(stripAnsi(input)).toBe('plain text');
  });

  it('should handle empty strings', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('parseVitestFinal', () => {
  describe('all tests pass', () => {
    it('should parse output with all tests passing', () => {
      const output = `
 RUN  v4.0.18 /path/to/package

 ✓ test/example.test.ts (20 tests) 10ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  16:37:55
   Duration  294ms (transform 59ms, setup 0ms, import 79ms, tests 10ms, environment 0ms)
`;
      const result = parseVitestFinal(output);

      expect(result.files).toBe(1);
      expect(result.tests).toBe(20);
      expect(result.passed).toBe(20);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.duration).toBeCloseTo(0.294, 3);
    });

    it('should parse output with multiple files all passing', () => {
      const output = `
 Test Files  11 passed (11)
      Tests  516 passed (516)
   Duration  1.74s
`;
      const result = parseVitestFinal(output);

      expect(result.files).toBe(11);
      expect(result.tests).toBe(516);
      expect(result.passed).toBe(516);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.duration).toBeCloseTo(1.74, 2);
    });
  });

  describe('tests with skipped', () => {
    it('should parse output with passed and skipped tests', () => {
      const output = `
 Test Files  4 passed (4)
      Tests  272 passed | 37 skipped (309)
   Duration  1.59s
`;
      const result = parseVitestFinal(output);

      expect(result.files).toBe(4);
      expect(result.tests).toBe(309);
      expect(result.passed).toBe(272);
      expect(result.skipped).toBe(37);
      expect(result.failed).toBe(0);
    });

    it('should parse output with only skipped tests', () => {
      const output = `
 Test Files  1 passed (1)
      Tests  0 passed | 5 skipped (5)
   Duration  100ms
`;
      const result = parseVitestFinal(output);

      expect(result.files).toBe(1);
      expect(result.tests).toBe(5);
      expect(result.passed).toBe(0);
      expect(result.skipped).toBe(5);
      expect(result.failed).toBe(0);
    });
  });

  describe('tests with failures', () => {
    it('should parse output with failed tests', () => {
      const output = `
 Test Files  1 failed | 2 passed (3)
      Tests  5 failed | 45 passed (50)
   Duration  2.5s
`;
      const result = parseVitestFinal(output);

      expect(result.files).toBe(3);
      expect(result.tests).toBe(50);
      expect(result.passed).toBe(45);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(5);
    });

    it('should parse output with failed, passed, and skipped tests', () => {
      const output = `
 Test Files  2 failed | 8 passed (10)
      Tests  3 failed | 90 passed | 7 skipped (100)
   Duration  5.0s
`;
      const result = parseVitestFinal(output);

      expect(result.files).toBe(10);
      expect(result.tests).toBe(100);
      expect(result.passed).toBe(90);
      expect(result.skipped).toBe(7);
      expect(result.failed).toBe(3);
    });

    it('should parse output with all tests failed', () => {
      const output = `
 Test Files  3 failed (3)
      Tests  15 failed (15)
   Duration  1.0s
`;
      const result = parseVitestFinal(output);

      expect(result.files).toBe(3);
      expect(result.tests).toBe(15);
      expect(result.passed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(15);
    });
  });

  describe('duration parsing', () => {
    it('should parse milliseconds duration', () => {
      const output = `
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  456ms
`;
      const result = parseVitestFinal(output);
      expect(result.duration).toBeCloseTo(0.456, 3);
    });

    it('should parse seconds duration', () => {
      const output = `
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  12.34s
`;
      const result = parseVitestFinal(output);
      expect(result.duration).toBeCloseTo(12.34, 2);
    });
  });

  describe('ANSI codes', () => {
    it('should handle output with ANSI color codes', () => {
      const output = `
\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m3 passed\x1b[39m\x1b[22m\x1b[90m (3)\x1b[39m
\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m73 passed\x1b[39m\x1b[22m\x1b[90m (73)\x1b[39m
\x1b[2m   Duration \x1b[22m 2.07s
`;
      const result = parseVitestFinal(output);

      expect(result.files).toBe(3);
      expect(result.tests).toBe(73);
      expect(result.passed).toBe(73);
    });
  });
});

describe('parseBunFinal', () => {
  describe('all tests pass', () => {
    it('should parse output with all tests passing', () => {
      const output = `
bun test v1.3.9 (cf6cdbbb)

 24 pass
 0 fail
 32 expect() calls
Ran 24 tests across 1 file. [386.00ms]
`;
      const result = parseBunFinal(output);

      expect(result.files).toBe(1);
      expect(result.tests).toBe(24);
      expect(result.passed).toBe(24);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.duration).toBeCloseTo(0.386, 3);
    });

    it('should parse output with multiple files', () => {
      const output = `
bun test v1.3.9

 100 pass
 0 fail
Ran 100 tests across 5 files. [1.5s]
`;
      const result = parseBunFinal(output);

      expect(result.files).toBe(5);
      expect(result.tests).toBe(100);
      expect(result.passed).toBe(100);
      expect(result.failed).toBe(0);
      expect(result.duration).toBeCloseTo(1.5, 1);
    });
  });

  describe('tests with skipped', () => {
    it('should parse output with skipped tests', () => {
      const output = `
bun test v1.3.9

 20 pass
 5 skip
 0 fail
Ran 25 tests across 2 files. [500.00ms]
`;
      const result = parseBunFinal(output);

      expect(result.files).toBe(2);
      expect(result.tests).toBe(25);
      expect(result.passed).toBe(20);
      expect(result.skipped).toBe(5);
      expect(result.failed).toBe(0);
    });
  });

  describe('tests with failures', () => {
    it('should parse output with failed tests', () => {
      const output = `
bun test v1.3.9

 18 pass
 2 fail
Ran 20 tests across 1 file. [300.00ms]
`;
      const result = parseBunFinal(output);

      expect(result.files).toBe(1);
      expect(result.tests).toBe(20);
      expect(result.passed).toBe(18);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(2);
    });

    it('should parse output with failed, passed, and skipped tests', () => {
      const output = `
bun test v1.3.9

 15 pass
 3 skip
 2 fail
Ran 20 tests across 3 files. [750.00ms]
`;
      const result = parseBunFinal(output);

      expect(result.files).toBe(3);
      expect(result.tests).toBe(20);
      expect(result.passed).toBe(15);
      expect(result.skipped).toBe(3);
      expect(result.failed).toBe(2);
    });

    it('should parse output with all tests failed', () => {
      const output = `
bun test v1.3.9

 0 pass
 10 fail
Ran 10 tests across 2 files. [200.00ms]
`;
      const result = parseBunFinal(output);

      expect(result.files).toBe(2);
      expect(result.tests).toBe(10);
      expect(result.passed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(10);
    });
  });

  describe('duration parsing', () => {
    it('should parse milliseconds duration', () => {
      const output = `
 1 pass
 0 fail
Ran 1 tests across 1 file. [123.45ms]
`;
      const result = parseBunFinal(output);
      expect(result.duration).toBeCloseTo(0.12345, 4);
    });

    it('should parse seconds duration', () => {
      const output = `
 1 pass
 0 fail
Ran 1 tests across 1 file. [2.5s]
`;
      const result = parseBunFinal(output);
      expect(result.duration).toBeCloseTo(2.5, 1);
    });
  });
});

describe('countVitestDots', () => {
  it('should count passed dots', () => {
    const chunk = '·····';
    const result = countVitestDots(chunk);

    expect(result.passed).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('should count skipped dots', () => {
    const chunk = '---';
    const result = countVitestDots(chunk);

    expect(result.passed).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('should count failed dots', () => {
    const chunk = '×××';
    const result = countVitestDots(chunk);

    expect(result.passed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(3);
  });

  it('should count mixed dots', () => {
    const chunk = '····--×·-×';
    const result = countVitestDots(chunk);

    expect(result.passed).toBe(5);
    expect(result.skipped).toBe(3);
    expect(result.failed).toBe(2);
  });

  it('should handle ANSI codes around dots', () => {
    const chunk = '\x1b[32m·\x1b[0m\x1b[32m·\x1b[0m\x1b[33m-\x1b[0m';
    const result = countVitestDots(chunk);

    expect(result.passed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('should handle empty chunk', () => {
    const result = countVitestDots('');

    expect(result.passed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe('countBunDots', () => {
  it('should count passed dots', () => {
    const chunk = '.....';
    const result = countBunDots(chunk);

    expect(result.passed).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('should handle empty chunk', () => {
    const result = countBunDots('');

    expect(result.passed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('should count dots in mixed output', () => {
    // bun dots reporter output
    const chunk = '........................';
    const result = countBunDots(chunk);

    expect(result.passed).toBe(24);
  });
});

import { getAffectedPackage, buildWatchPaths } from './src/watcher.js';
import { loadConfig, expandGlob, getTriggeredPackages, getWatchMappingDirs } from './src/config.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __testDirname = dirname(fileURLToPath(import.meta.url));
const testRootDir = join(__testDirname, '../..');

describe('watcher', () => {
  describe('getAffectedPackage', () => {
    const packages = [
      { name: 'lass-cli', path: '/workspace/packages/lass-cli' },
      { name: 'lass-core', path: '/workspace/packages/lass-core' },
      { name: 'vite-plugin-lass', path: '/workspace/plugins/vite-plugin-lass' },
    ];

    it('should match file to package', () => {
      const result = getAffectedPackage('/workspace/packages/lass-cli/src/index.ts', packages);
      expect(result).toEqual(packages[0]);
    });

    it('should match nested file to package', () => {
      const result = getAffectedPackage('/workspace/packages/lass-core/src/parser/lexer.ts', packages);
      expect(result).toEqual(packages[1]);
    });

    it('should match plugin file to package', () => {
      const result = getAffectedPackage('/workspace/plugins/vite-plugin-lass/test/plugin.test.ts', packages);
      expect(result).toEqual(packages[2]);
    });

    it('should return null for unmatched file', () => {
      const result = getAffectedPackage('/workspace/other/file.ts', packages);
      expect(result).toBeNull();
    });

    it('should return null for partial path match', () => {
      // Shouldn't match 'lass-cli-extra' when looking for 'lass-cli'
      const result = getAffectedPackage('/workspace/packages/lass-cli-extra/src/index.ts', packages);
      expect(result).toBeNull();
    });
  });

  describe('buildWatchPaths', () => {
    it('should build paths from packages', () => {
      const packages = [
        { name: 'lass-cli', path: join(testRootDir, 'packages/lass-cli') },
      ];
      
      const paths = buildWatchPaths(packages);
      
      // Should include src and test directories that exist
      expect(paths.some(p => p.includes('lass-cli/src'))).toBe(true);
      expect(paths.some(p => p.includes('lass-cli/test'))).toBe(true);
    });

    it('should skip non-existent directories', () => {
      const packages = [
        { name: 'fake-pkg', path: '/non/existent/path' },
      ];
      
      const paths = buildWatchPaths(packages);
      expect(paths).toEqual([]);
    });
  });
});

describe('config', () => {
  describe('loadConfig', () => {
    it('should return empty object if no config found', async () => {
      // Use a directory that definitely has no config
      const result = await loadConfig('/tmp');
      expect(result).toEqual({});
    });
  });

  describe('getTriggeredPackages', () => {
    const rootDir = '/workspace';
    const watchMappings = [
      {
        paths: ['apps/docs/content/axioms/**/*.md'],
        triggers: ['lass-core'],
      },
      {
        paths: ['shared/schemas/**/*.json'],
        triggers: '*',
      },
      {
        paths: ['packages/lass-core/fixtures/**/*'],
        triggers: ['lass-core', 'lass-cli'],
      },
    ];

    it('should match file to triggered packages', () => {
      const result = getTriggeredPackages(
        '/workspace/apps/docs/content/axioms/string.md',
        watchMappings,
        rootDir
      );
      expect(result).toEqual(['lass-core']);
    });

    it('should return "*" for wildcard triggers', () => {
      const result = getTriggeredPackages(
        '/workspace/shared/schemas/api.json',
        watchMappings,
        rootDir
      );
      expect(result).toBe('*');
    });

    it('should return multiple packages when specified', () => {
      const result = getTriggeredPackages(
        '/workspace/packages/lass-core/fixtures/test.lass',
        watchMappings,
        rootDir
      );
      expect(result).toEqual(['lass-core', 'lass-cli']);
    });

    it('should return null for unmatched file', () => {
      const result = getTriggeredPackages(
        '/workspace/random/file.ts',
        watchMappings,
        rootDir
      );
      expect(result).toBeNull();
    });

    it('should return null if no watchMappings', () => {
      const result = getTriggeredPackages('/workspace/file.ts', null, rootDir);
      expect(result).toBeNull();
    });

    it('should handle paths without trailing slash in rootDir', () => {
      const result = getTriggeredPackages(
        '/workspace/apps/docs/content/axioms/number.md',
        watchMappings,
        '/workspace'
      );
      expect(result).toEqual(['lass-core']);
    });
  });

  describe('getWatchMappingDirs', () => {
    it('should extract base directories from glob patterns', () => {
      const watchMappings = [
        { paths: [join(testRootDir, 'packages/**/*.ts')], triggers: ['test'] },
      ];
      
      const dirs = getWatchMappingDirs(watchMappings, testRootDir);
      
      expect(dirs.length).toBe(1);
      expect(dirs[0]).toBe(join(testRootDir, 'packages'));
    });

    it('should return empty array for null watchMappings', () => {
      const dirs = getWatchMappingDirs(null, testRootDir);
      expect(dirs).toEqual([]);
    });

    it('should deduplicate directories', () => {
      const watchMappings = [
        { paths: [join(testRootDir, 'packages/**/*.ts')], triggers: ['a'] },
        { paths: [join(testRootDir, 'packages/**/*.js')], triggers: ['b'] },
      ];
      
      const dirs = getWatchMappingDirs(watchMappings, testRootDir);
      
      expect(dirs.length).toBe(1);
    });

    it('should skip non-existent directories', () => {
      const watchMappings = [
        { paths: ['/non/existent/path/**/*.ts'], triggers: ['test'] },
      ];
      
      const dirs = getWatchMappingDirs(watchMappings, testRootDir);
      
      expect(dirs).toEqual([]);
    });
  });

  describe('expandGlob', () => {
    it('should expand glob to matching files', () => {
      // Use a known directory in the test project
      const pattern = 'scripts/monotestrunner/*.js';
      const matches = expandGlob(pattern, testRootDir);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(f => f.endsWith('index.js'))).toBe(true);
    });

    it('should return empty array for non-matching glob', () => {
      const pattern = 'scripts/monotestrunner/*.nonexistent';
      const matches = expandGlob(pattern, testRootDir);
      
      expect(matches).toEqual([]);
    });

    it('should return empty array if base directory does not exist', () => {
      const pattern = 'nonexistent/path/**/*.ts';
      const matches = expandGlob(pattern, testRootDir);
      
      expect(matches).toEqual([]);
    });
  });
});

// =============================================================================
// extractFailureLine
// =============================================================================

describe('extractFailureLine', () => {
  it('should extract line from vitest stack trace (❯ marker)', () => {
    const msg = `AssertionError: expected 'foo' to equal 'bar'
 ❯ test/axioms.test.ts:42:5
 ❯ node_modules/vitest/dist/chunk.js:100:20`;
    expect(extractFailureLine(msg, 'test/axioms.test.ts')).toBe('42');
  });

  it('should extract line from bun stack trace (at marker)', () => {
    const msg = `expect(received).toBe(expected)
      at /Users/dev/project/test/axioms.test.ts:42:5`;
    expect(extractFailureLine(msg, 'test/axioms.test.ts')).toBe('42');
  });

  it('should return first matching frame when multiple frames match', () => {
    const msg = `Error: fail
 ❯ test/foo.test.ts:10:3
 ❯ test/foo.test.ts:20:3`;
    expect(extractFailureLine(msg, 'test/foo.test.ts')).toBe('10');
  });

  it('should skip frames that do not match the file', () => {
    const msg = `Error: fail
 ❯ node_modules/vitest/runner.js:50:10
 ❯ test/bar.test.ts:42:5`;
    expect(extractFailureLine(msg, 'test/bar.test.ts')).toBe('42');
  });

  it('should return empty string when no frame matches', () => {
    const msg = `Error: fail
 ❯ node_modules/vitest/runner.js:50:10`;
    expect(extractFailureLine(msg, 'test/foo.test.ts')).toBe('');
  });

  it('should return empty string for empty failure message', () => {
    expect(extractFailureLine('', 'test/foo.test.ts')).toBe('');
  });

  it('should return empty string for null/undefined inputs', () => {
    expect(extractFailureLine(null, 'test/foo.test.ts')).toBe('');
    expect(extractFailureLine('some error', null)).toBe('');
    expect(extractFailureLine(null, null)).toBe('');
  });
});

// =============================================================================
// resolveCommand
// =============================================================================

describe('resolveCommand', () => {
  it('should replace simple placeholders', () => {
    expect(resolveCommand('codium {filePath}', { filePath: 'src/foo.ts' }))
      .toBe('codium src/foo.ts');
  });

  it('should replace multiple placeholders', () => {
    expect(resolveCommand('{a} and {b}', { a: 'hello', b: 'world' }))
      .toBe('hello and world');
  });

  it('should replace missing placeholders with empty string', () => {
    expect(resolveCommand('{a} {b}', { a: 'hello' }))
      .toBe('hello ');
  });

  it('should include conditional section when all placeholders present', () => {
    expect(resolveCommand('{filePath}[:{line}]', { filePath: 'src/foo.ts', line: '42' }))
      .toBe('src/foo.ts:42');
  });

  it('should drop conditional section when any placeholder is empty', () => {
    expect(resolveCommand('{filePath}[:{line}]', { filePath: 'src/foo.ts', line: '' }))
      .toBe('src/foo.ts');
  });

  it('should drop conditional section when placeholder is missing', () => {
    expect(resolveCommand('{filePath}[:{line}]', { filePath: 'src/foo.ts' }))
      .toBe('src/foo.ts');
  });

  it('should handle multiple conditional sections independently', () => {
    expect(resolveCommand('{a}[ {b}][ {c}]', { a: 'x', b: 'y', c: '' }))
      .toBe('x y');
  });

  it('should handle conditional section with multiple placeholders', () => {
    expect(resolveCommand('[{a}:{b}]', { a: 'x', b: 'y' })).toBe('x:y');
    expect(resolveCommand('[{a}:{b}]', { a: 'x', b: '' })).toBe('');
    expect(resolveCommand('[{a}:{b}]', { a: '', b: 'y' })).toBe('');
  });

  it('should handle real-world codium command', () => {
    expect(resolveCommand('codium -g {filePath}[:{line}]', {
      filePath: 'packages/core/src/parser.ts',
      line: '42',
    })).toBe('codium -g packages/core/src/parser.ts:42');

    expect(resolveCommand('codium -g {filePath}[:{line}]', {
      filePath: 'packages/core/src/parser.ts',
      line: '',
    })).toBe('codium -g packages/core/src/parser.ts');
  });
});

// =============================================================================
// parseLcovDetailed (with DA: and BRDA: lines)
// =============================================================================

import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseLcovDetailed', () => {
  let tempDir;

  function writeLcov(content) {
    const lcovPath = join(tempDir, 'lcov.info');
    writeFileSync(lcovPath, content, 'utf-8');
    return lcovPath;
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lcov-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return null for non-existent file', () => {
    expect(parseLcovDetailed('/nonexistent/lcov.info')).toBeNull();
  });

  it('should parse summary counters', () => {
    const lcovPath = writeLcov(`SF:/src/foo.ts
LF:10
LH:8
BRF:4
BRH:3
FNF:2
FNH:2
end_of_record
`);
    const files = parseLcovDetailed(lcovPath);
    expect(files).toHaveLength(1);
    expect(files[0].file).toBe('/src/foo.ts');
    expect(files[0].linesTotal).toBe(10);
    expect(files[0].linesHit).toBe(8);
    expect(files[0].branchesTotal).toBe(4);
    expect(files[0].branchesHit).toBe(3);
    expect(files[0].functionsTotal).toBe(2);
    expect(files[0].functionsHit).toBe(2);
  });

  it('should parse DA: lines into lineHits Map', () => {
    const lcovPath = writeLcov(`SF:/src/foo.ts
DA:1,3
DA:2,0
DA:5,1
LF:3
LH:2
end_of_record
`);
    const files = parseLcovDetailed(lcovPath);
    expect(files[0].lineHits).toBeInstanceOf(Map);
    expect(files[0].lineHits.get(1)).toBe(3);
    expect(files[0].lineHits.get(2)).toBe(0);
    expect(files[0].lineHits.get(5)).toBe(1);
    expect(files[0].lineHits.has(3)).toBe(false);
  });

  it('should parse BRDA: lines into branchHits Map', () => {
    const lcovPath = writeLcov(`SF:/src/foo.ts
DA:5,3
BRDA:5,0,0,3
BRDA:5,0,1,0
DA:10,1
BRDA:10,0,0,1
BRDA:10,0,1,1
LF:2
LH:2
BRF:4
BRH:3
end_of_record
`);
    const files = parseLcovDetailed(lcovPath);
    const bh = files[0].branchHits;
    expect(bh).toBeInstanceOf(Map);
    // Line 5: 2 branches, 1 taken
    expect(bh.get(5)).toEqual({ total: 2, taken: 1 });
    // Line 10: 2 branches, both taken
    expect(bh.get(10)).toEqual({ total: 2, taken: 2 });
  });

  it('should handle BRDA: with dash (never evaluated)', () => {
    const lcovPath = writeLcov(`SF:/src/foo.ts
DA:5,0
BRDA:5,0,0,-
BRDA:5,0,1,-
LF:1
LH:0
BRF:2
BRH:0
end_of_record
`);
    const files = parseLcovDetailed(lcovPath);
    expect(files[0].branchHits.get(5)).toEqual({ total: 2, taken: 0 });
  });

  it('should parse multiple file records', () => {
    const lcovPath = writeLcov(`SF:/src/a.ts
DA:1,1
LF:1
LH:1
end_of_record
SF:/src/b.ts
DA:1,0
LF:1
LH:0
end_of_record
`);
    const files = parseLcovDetailed(lcovPath);
    expect(files).toHaveLength(2);
    expect(files[0].file).toBe('/src/a.ts');
    expect(files[1].file).toBe('/src/b.ts');
    expect(files[0].lineHits.get(1)).toBe(1);
    expect(files[1].lineHits.get(1)).toBe(0);
  });
});

// =============================================================================
// getLineCoverageStatus
// =============================================================================

describe('getLineCoverageStatus', () => {
  it('should return null for non-instrumented lines', () => {
    const lineHits = new Map([[1, 3]]);
    const branchHits = new Map();
    expect(getLineCoverageStatus(2, lineHits, branchHits)).toBeNull();
  });

  it('should return "uncovered" for lines with 0 hits', () => {
    const lineHits = new Map([[5, 0]]);
    const branchHits = new Map();
    expect(getLineCoverageStatus(5, lineHits, branchHits)).toBe('uncovered');
  });

  it('should return "covered" for lines with hits and no branch data', () => {
    const lineHits = new Map([[5, 3]]);
    const branchHits = new Map();
    expect(getLineCoverageStatus(5, lineHits, branchHits)).toBe('covered');
  });

  it('should return "covered" for lines with all branches taken', () => {
    const lineHits = new Map([[5, 3]]);
    const branchHits = new Map([[5, { total: 2, taken: 2 }]]);
    expect(getLineCoverageStatus(5, lineHits, branchHits)).toBe('covered');
  });

  it('should return "partial" for lines with incomplete branch coverage', () => {
    const lineHits = new Map([[5, 3]]);
    const branchHits = new Map([[5, { total: 2, taken: 1 }]]);
    expect(getLineCoverageStatus(5, lineHits, branchHits)).toBe('partial');
  });

  it('should return "uncovered" even if branches exist (DA count is 0)', () => {
    const lineHits = new Map([[5, 0]]);
    const branchHits = new Map([[5, { total: 2, taken: 0 }]]);
    expect(getLineCoverageStatus(5, lineHits, branchHits)).toBe('uncovered');
  });
});

// =============================================================================
// buildPopoverContent (test detail popover)
// =============================================================================

import { buildPopoverContent, buildCoveragePopoverContent } from './src/views/screens/popover.js';

describe('buildPopoverContent', () => {
  it('should produce compact header (3 lines, no body) for passed tests', () => {
    const test = { name: 'should work', status: 'passed', duration: 0.008, failureMessage: '' };
    const result = buildPopoverContent(test, 'test/foo.test.ts');
    expect(result.header).toHaveLength(3);
    expect(result.body).toHaveLength(0);
    // No null sentinel (no ├─┤)
    expect(result.header).not.toContain(null);
    // Header line 3 contains the file and "pass:" tag
    const line3 = stripAnsi(result.header[2]);
    expect(line3).toContain('test/foo.test.ts');
    expect(line3).toContain('pass:');
    expect(line3).toContain('8ms');
  });

  it('should produce compact header (3 lines, no body) for skipped tests', () => {
    const test = { name: 'skipped test', status: 'skipped', duration: 0, failureMessage: '' };
    const result = buildPopoverContent(test, 'test/foo.test.ts');
    expect(result.header).toHaveLength(3);
    expect(result.body).toHaveLength(0);
    expect(result.header).not.toContain(null);
    const line3 = stripAnsi(result.header[2]);
    expect(line3).toContain('skipped');
  });

  it('should produce expanded header (4 lines with null sentinel) + body for failed tests', () => {
    const test = {
      name: 'should fail',
      status: 'failed',
      duration: 0.021,
      failureMessage: 'AssertionError: expected 1 to be 2\n  at test.ts:10:5',
    };
    const result = buildPopoverContent(test, 'test/foo.test.ts');
    expect(result.header).toHaveLength(4);
    expect(result.header[3]).toBeNull(); // sentinel for ├─┤
    expect(result.body.length).toBeGreaterThan(0);
    // Body contains duration
    const bodyText = result.body.map(l => stripAnsi(l)).join('\n');
    expect(bodyText).toContain('21ms');
    // Body contains failure message
    expect(bodyText).toContain('AssertionError');
  });

  it('should handle empty file gracefully', () => {
    const test = { name: 'test', status: 'passed', duration: 0.001, failureMessage: '' };
    const result = buildPopoverContent(test, '');
    expect(result.header).toHaveLength(3);
    expect(result.header[2]).toBe('');
  });
});

// =============================================================================
// buildCoveragePopoverContent
// =============================================================================

describe('buildCoveragePopoverContent', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cov-popover-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should build header with filepath and coverage stats', () => {
    const srcPath = join(tempDir, 'foo.ts');
    writeFileSync(srcPath, 'const x = 1;\nconst y = 2;\n', 'utf-8');

    const result = buildCoveragePopoverContent({
      absFile: srcPath,
      displayPath: 'src/foo.ts',
      lineHits: new Map([[1, 3], [2, 0]]),
      branchHits: new Map(),
      fileStats: { lines: '50.0', branches: '-', functions: '-' },
    });

    expect(result.header).toHaveLength(3);
    expect(result.header[2]).toBeNull(); // sentinel for ├─┤
    const headerText = result.header.map(l => l === null ? '' : stripAnsi(l)).join('\n');
    expect(headerText).toContain('src/foo.ts');
    expect(headerText).toContain('L:50.0%');
  });

  it('should annotate source lines with coverage status', () => {
    const srcPath = join(tempDir, 'bar.ts');
    writeFileSync(srcPath, 'line1\nline2\nline3\nline4', 'utf-8');

    const result = buildCoveragePopoverContent({
      absFile: srcPath,
      displayPath: 'src/bar.ts',
      lineHits: new Map([[1, 3], [2, 0], [3, 1]]),
      branchHits: new Map([[3, { total: 2, taken: 1 }]]),
      fileStats: { lines: '66.7', branches: '50.0', functions: '100.0' },
    });

    // 4 source lines → 4 body lines
    expect(result.body).toHaveLength(4);
    // Line 2 (uncovered) and line 3 (partial) should be selectable
    expect(result.selectableBodyIndices).toEqual([1, 2]);
  });

  it('should return empty body indices when all lines are covered', () => {
    const srcPath = join(tempDir, 'allcov.ts');
    writeFileSync(srcPath, 'a\nb\n', 'utf-8');

    const result = buildCoveragePopoverContent({
      absFile: srcPath,
      displayPath: 'src/allcov.ts',
      lineHits: new Map([[1, 5], [2, 3]]),
      branchHits: new Map(),
      fileStats: { lines: '100.0', branches: '-', functions: '100.0' },
    });

    expect(result.selectableBodyIndices).toEqual([]);
  });

  it('should handle unreadable file gracefully', () => {
    const result = buildCoveragePopoverContent({
      absFile: '/nonexistent/file.ts',
      displayPath: 'nonexistent/file.ts',
      lineHits: new Map(),
      branchHits: new Map(),
      fileStats: { lines: '-', branches: '-', functions: '-' },
    });

    expect(result.header).toHaveLength(3);
    expect(result.body).toHaveLength(1);
    expect(result.selectableBodyIndices).toEqual([]);
  });
});

// =============================================================================
// Runner registry (runners/index.js)
// =============================================================================

describe('runner registry', () => {
  describe('detectRunner', () => {
    it('should detect vitest from test script', () => {
      expect(detectRunner('vitest run')).toBe('vitest');
    });

    it('should detect vitest from complex script', () => {
      expect(detectRunner('cross-env NODE_ENV=test vitest run --coverage')).toBe('vitest');
    });

    it('should detect bun from test script', () => {
      expect(detectRunner('bun test')).toBe('bun');
    });

    it('should detect bun from complex script', () => {
      expect(detectRunner('bun test --coverage --bail')).toBe('bun');
    });

    it('should return null for unknown runner', () => {
      expect(detectRunner('jest')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(detectRunner(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(detectRunner(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(detectRunner('')).toBeNull();
    });
  });

  describe('getRunner', () => {
    it('should return vitest runner by name', () => {
      const runner = getRunner('vitest');
      expect(runner).not.toBeNull();
      expect(runner.name).toBe('vitest');
    });

    it('should return bun runner by name', () => {
      const runner = getRunner('bun');
      expect(runner).not.toBeNull();
      expect(runner.name).toBe('bun');
    });

    it('should return null for unknown runner name', () => {
      expect(getRunner('jest')).toBeNull();
    });

    it('should return null for null name', () => {
      expect(getRunner(null)).toBeNull();
    });
  });

  describe('getRunnerNames', () => {
    it('should return array of runner names', () => {
      const names = getRunnerNames();
      expect(names).toContain('vitest');
      expect(names).toContain('bun');
      expect(names).toHaveLength(2);
    });
  });
});

// =============================================================================
// Vitest runner adapter (runners/vitest.js)
// =============================================================================

describe('vitest runner adapter', () => {
  describe('detect', () => {
    it('should detect "vitest run"', () => {
      expect(vitestRunner.detect('vitest run')).toBe(true);
    });

    it('should detect "vitest" anywhere in script', () => {
      expect(vitestRunner.detect('cross-env vitest --coverage')).toBe(true);
    });

    it('should not detect bun', () => {
      expect(vitestRunner.detect('bun test')).toBe(false);
    });

    it('should not detect jest', () => {
      expect(vitestRunner.detect('jest --watchAll')).toBe(false);
    });
  });

  describe('buildCommand', () => {
    it('should return pnpm command with vitest args', () => {
      const { command, args } = vitestRunner.buildCommand();
      expect(command).toBe('pnpm');
      expect(args).toContain('vitest');
      expect(args).toContain('run');
      expect(args).toContain('--reporter=dot');
      expect(args).toContain('--reporter=junit');
    });

    it('should include --coverage when coverage enabled', () => {
      const { args } = vitestRunner.buildCommand({ coverage: true });
      expect(args).toContain('--coverage');
    });

    it('should not include --coverage by default', () => {
      const { args } = vitestRunner.buildCommand();
      expect(args).not.toContain('--coverage');
    });
  });

  describe('countDots', () => {
    it('should count vitest passed dots (·)', () => {
      expect(vitestRunner.countDots('·····')).toEqual({ passed: 5, skipped: 0, failed: 0 });
    });

    it('should count vitest skipped dots (-)', () => {
      expect(vitestRunner.countDots('---')).toEqual({ passed: 0, skipped: 3, failed: 0 });
    });

    it('should count vitest failed dots (×)', () => {
      expect(vitestRunner.countDots('×××')).toEqual({ passed: 0, skipped: 0, failed: 3 });
    });

    it('should count mixed dots', () => {
      expect(vitestRunner.countDots('····--×·-×')).toEqual({ passed: 5, skipped: 3, failed: 2 });
    });

    it('should handle empty string', () => {
      expect(vitestRunner.countDots('')).toEqual({ passed: 0, skipped: 0, failed: 0 });
    });
  });

  describe('parseFinal', () => {
    it('should parse vitest final output (all pass)', () => {
      const output = `
 Test Files  3 passed (3)
      Tests  73 passed (73)
   Duration  2.07s
`;
      const result = vitestRunner.parseFinal(output);
      expect(result.files).toBe(3);
      expect(result.tests).toBe(73);
      expect(result.passed).toBe(73);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.duration).toBeCloseTo(2.07, 2);
    });

    it('should parse vitest final output (mixed)', () => {
      const output = `
 Test Files  2 failed | 8 passed (10)
      Tests  3 failed | 90 passed | 7 skipped (100)
   Duration  5.0s
`;
      const result = vitestRunner.parseFinal(output);
      expect(result.files).toBe(10);
      expect(result.tests).toBe(100);
      expect(result.passed).toBe(90);
      expect(result.skipped).toBe(7);
      expect(result.failed).toBe(3);
    });
  });
});

// =============================================================================
// Bun runner adapter (runners/bun.js)
// =============================================================================

describe('bun runner adapter', () => {
  describe('detect', () => {
    it('should detect "bun test"', () => {
      expect(bunRunner.detect('bun test')).toBe(true);
    });

    it('should detect "bun" anywhere in script', () => {
      expect(bunRunner.detect('cross-env bun test --coverage')).toBe(true);
    });

    it('should not detect vitest', () => {
      expect(bunRunner.detect('vitest run')).toBe(false);
    });

    it('should not detect jest', () => {
      expect(bunRunner.detect('jest --watchAll')).toBe(false);
    });
  });

  describe('buildCommand', () => {
    it('should return bun command with test args', () => {
      const { command, args } = bunRunner.buildCommand();
      expect(command).toBe('bun');
      expect(args).toContain('test');
      expect(args).toContain('--dots');
      expect(args).toContain('--reporter=junit');
    });

    it('should include coverage flags when coverage enabled', () => {
      const { args } = bunRunner.buildCommand({ coverage: true });
      expect(args).toContain('--coverage');
      expect(args).toContain('--coverage-reporter=lcov');
      expect(args).toContain('--coverage-dir=coverage');
    });

    it('should not include coverage flags by default', () => {
      const { args } = bunRunner.buildCommand();
      expect(args).not.toContain('--coverage');
    });
  });

  describe('countDots', () => {
    it('should count bun passed dots (.)', () => {
      expect(bunRunner.countDots('.....')).toEqual({ passed: 5, skipped: 0, failed: 0 });
    });

    it('should handle empty string', () => {
      expect(bunRunner.countDots('')).toEqual({ passed: 0, skipped: 0, failed: 0 });
    });

    it('should always return 0 for skipped and failed', () => {
      const result = bunRunner.countDots('...........');
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('parseFinal', () => {
    it('should parse bun final output (all pass)', () => {
      const output = `
bun test v1.3.9

 24 pass
 0 fail
Ran 24 tests across 1 file. [386.00ms]
`;
      const result = bunRunner.parseFinal(output);
      expect(result.files).toBe(1);
      expect(result.tests).toBe(24);
      expect(result.passed).toBe(24);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.duration).toBeCloseTo(0.386, 3);
    });

    it('should parse bun final output (mixed)', () => {
      const output = `
bun test v1.3.9

 15 pass
 3 skip
 2 fail
Ran 20 tests across 3 files. [750.00ms]
`;
      const result = bunRunner.parseFinal(output);
      expect(result.files).toBe(3);
      expect(result.tests).toBe(20);
      expect(result.passed).toBe(15);
      expect(result.skipped).toBe(3);
      expect(result.failed).toBe(2);
    });
  });
});

// =============================================================================
// parsePnpmWorkspaceYaml (packages.js)
// =============================================================================

describe('parsePnpmWorkspaceYaml', () => {
  it('should parse standard format with quoted items', () => {
    const content = `packages:
  - "packages/*"
  - "plugins/*"
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual(['packages/*', 'plugins/*']);
  });

  it('should parse single-quoted items', () => {
    const content = `packages:
  - 'packages/*'
  - 'apps/*'
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual(['packages/*', 'apps/*']);
  });

  it('should parse unquoted items', () => {
    const content = `packages:
  - packages/*
  - apps/*
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual(['packages/*', 'apps/*']);
  });

  it('should parse mixed quoted and unquoted items', () => {
    const content = `packages:
  - "packages/*"
  - plugins/*
  - 'apps/*'
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual(['packages/*', 'plugins/*', 'apps/*']);
  });

  it('should return empty array for empty packages list', () => {
    const content = `packages:
otherKey: value
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual([]);
  });

  it('should handle comments in the YAML', () => {
    const content = `# workspace config
packages:
  # main packages
  - packages/*
  # plugins
  - plugins/*
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual(['packages/*', 'plugins/*']);
  });

  it('should stop at next top-level key', () => {
    const content = `packages:
  - packages/*
  - plugins/*
catalog:
  react: ^18.0.0
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual(['packages/*', 'plugins/*']);
  });

  it('should handle explicit paths (no wildcards)', () => {
    const content = `packages:
  - packages/*
  - plugins/vite-plugin-lass/test-app
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual(['packages/*', 'plugins/vite-plugin-lass/test-app']);
  });

  it('should return empty array for content without packages key', () => {
    const content = `catalog:
  react: ^18.0.0
`;
    const globs = parsePnpmWorkspaceYaml(content);
    expect(globs).toEqual([]);
  });

  it('should return empty array for empty content', () => {
    expect(parsePnpmWorkspaceYaml('')).toEqual([]);
  });
});

// =============================================================================
// discoverPackages (packages.js)
// =============================================================================

describe('discoverPackages', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'discover-pkg-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should discover packages from pnpm-workspace.yaml', () => {
    // Create workspace structure
    mkdirSync(join(tempDir, 'packages', 'pkg-a'), { recursive: true });
    mkdirSync(join(tempDir, 'packages', 'pkg-b'), { recursive: true });

    // Write pnpm-workspace.yaml
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), `packages:\n  - packages/*\n`, 'utf-8');

    // Write package.json files
    writeFileSync(join(tempDir, 'packages', 'pkg-a', 'package.json'), JSON.stringify({
      name: 'pkg-a',
      scripts: { test: 'vitest run' },
    }), 'utf-8');
    writeFileSync(join(tempDir, 'packages', 'pkg-b', 'package.json'), JSON.stringify({
      name: 'pkg-b',
      scripts: { test: 'bun test' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(2);

    const pkgA = packages.find(p => p.name === 'pkg-a');
    const pkgB = packages.find(p => p.name === 'pkg-b');

    expect(pkgA).toBeDefined();
    expect(pkgA.testScript).toBe('vitest run');
    expect(pkgA.runner).toBe('vitest');
    expect(pkgA.path).toBe(join(tempDir, 'packages', 'pkg-a'));

    expect(pkgB).toBeDefined();
    expect(pkgB.testScript).toBe('bun test');
    expect(pkgB.runner).toBe('bun');
  });

  it('should discover packages from npm workspaces (array format)', () => {
    mkdirSync(join(tempDir, 'packages', 'my-lib'), { recursive: true });

    // No pnpm-workspace.yaml — use package.json workspaces
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'my-workspace',
      workspaces: ['packages/*'],
    }), 'utf-8');

    writeFileSync(join(tempDir, 'packages', 'my-lib', 'package.json'), JSON.stringify({
      name: 'my-lib',
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('my-lib');
    expect(packages[0].runner).toBe('vitest');
  });

  it('should discover packages from npm workspaces (object format)', () => {
    mkdirSync(join(tempDir, 'libs', 'core'), { recursive: true });

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'my-workspace',
      workspaces: { packages: ['libs/*'] },
    }), 'utf-8');

    writeFileSync(join(tempDir, 'libs', 'core', 'package.json'), JSON.stringify({
      name: 'core',
      scripts: { test: 'bun test' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('core');
    expect(packages[0].runner).toBe('bun');
  });

  it('should fallback to rootDir as single package', () => {
    // No pnpm-workspace.yaml, no workspaces field — just a package.json
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'standalone-pkg',
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('standalone-pkg');
    expect(packages[0].path).toBe(tempDir);
    expect(packages[0].runner).toBe('vitest');
  });

  it('should set testScript and runner to null for packages without test script', () => {
    mkdirSync(join(tempDir, 'packages', 'no-tests'), { recursive: true });
    mkdirSync(join(tempDir, 'packages', 'has-tests'), { recursive: true });

    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), `packages:\n  - packages/*\n`, 'utf-8');

    writeFileSync(join(tempDir, 'packages', 'no-tests', 'package.json'), JSON.stringify({
      name: 'no-tests',
      scripts: { build: 'tsc' },
    }), 'utf-8');
    writeFileSync(join(tempDir, 'packages', 'has-tests', 'package.json'), JSON.stringify({
      name: 'has-tests',
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(2);

    const noTests = packages.find(p => p.name === 'no-tests');
    const hasTests = packages.find(p => p.name === 'has-tests');

    expect(noTests.testScript).toBeNull();
    expect(noTests.runner).toBeNull();
    expect(hasTests.testScript).toBe('vitest run');
    expect(hasTests.runner).toBe('vitest');
  });

  it('should handle explicit paths in workspace globs', () => {
    mkdirSync(join(tempDir, 'plugins', 'my-plugin', 'test-app'), { recursive: true });

    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), `packages:\n  - plugins/my-plugin/test-app\n`, 'utf-8');

    writeFileSync(join(tempDir, 'plugins', 'my-plugin', 'test-app', 'package.json'), JSON.stringify({
      name: 'test-app',
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('test-app');
    expect(packages[0].path).toBe(join(tempDir, 'plugins', 'my-plugin', 'test-app'));
  });

  it('should use directory basename when package.json has no name', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe(basename(tempDir));
  });

  it('should return empty array for directory with no package.json', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'empty-discover-'));
    try {
      const packages = discoverPackages(emptyDir);
      expect(packages).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('should skip directories without package.json in workspace globs', () => {
    mkdirSync(join(tempDir, 'packages', 'valid-pkg'), { recursive: true });
    mkdirSync(join(tempDir, 'packages', 'no-pkg-json'), { recursive: true });

    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), `packages:\n  - packages/*\n`, 'utf-8');

    // Only valid-pkg has a package.json
    writeFileSync(join(tempDir, 'packages', 'valid-pkg', 'package.json'), JSON.stringify({
      name: 'valid-pkg',
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('valid-pkg');
  });

  it('should deduplicate packages discovered from overlapping globs', () => {
    mkdirSync(join(tempDir, 'packages', 'my-pkg'), { recursive: true });

    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), `packages:\n  - packages/*\n  - packages/my-pkg\n`, 'utf-8');

    writeFileSync(join(tempDir, 'packages', 'my-pkg', 'package.json'), JSON.stringify({
      name: 'my-pkg',
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    const packages = discoverPackages(tempDir);
    expect(packages).toHaveLength(1);
  });
});
