#!/usr/bin/env node
/**
 * Tests for test-summary
 *
 * Tests the parsing functions for vitest and bun output formats,
 * including pass, skip, and fail scenarios.
 */

import { describe, it, expect } from 'vitest';
import { stripAnsi } from './ui.js';
import {
  parseVitestFinal,
  parseBunFinal,
  countVitestDots,
  countBunDots,
} from './parsers.js';

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

import { getAffectedPackage, buildWatchPaths } from './watcher.js';
import { loadConfig, expandGlob, getTriggeredPackages, getWatchMappingDirs } from './config.js';
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
