/**
 * Coverage Summary Module
 *
 * Parses coverage data from lcov.info files.
 * Library module imported by monotestrunner.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getRunner } from './runners/index.js';

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse lcov.info file and extract per-file coverage stats
 * @param {string} lcovPath - Path to lcov.info file
 * @returns {Array|null} - Array of file coverage objects or null if not found
 */
export function parseLcovDetailed(lcovPath) {
  if (!existsSync(lcovPath)) return null;

  const content = readFileSync(lcovPath, 'utf-8');
  const files = [];
  let current = null;

  for (const line of content.split('\n')) {
    if (line.startsWith('SF:')) {
      current = {
        file: line.slice(3),
        linesHit: 0, linesTotal: 0,
        branchesHit: 0, branchesTotal: 0,
        functionsHit: 0, functionsTotal: 0,
        lineHits: new Map(),    // lineNum → executionCount
        branchHits: new Map(),  // lineNum → { total, taken }
      };
    } else if (current) {
      if (line.startsWith('DA:')) {
        const parts = line.slice(3).split(',');
        current.lineHits.set(parseInt(parts[0], 10), parseInt(parts[1], 10));
      } else if (line.startsWith('BRDA:')) {
        const parts = line.slice(5).split(',');
        const lineNum = parseInt(parts[0], 10);
        const taken = parts[3] === '-' ? 0 : parseInt(parts[3], 10);
        const existing = current.branchHits.get(lineNum) || { total: 0, taken: 0 };
        existing.total++;
        if (taken > 0) existing.taken++;
        current.branchHits.set(lineNum, existing);
      } else if (line.startsWith('LH:')) current.linesHit = parseInt(line.slice(3), 10);
      else if (line.startsWith('LF:')) current.linesTotal = parseInt(line.slice(3), 10);
      else if (line.startsWith('BRH:')) current.branchesHit = parseInt(line.slice(4), 10);
      else if (line.startsWith('BRF:')) current.branchesTotal = parseInt(line.slice(4), 10);
      else if (line.startsWith('FNH:')) current.functionsHit = parseInt(line.slice(4), 10);
      else if (line.startsWith('FNF:')) current.functionsTotal = parseInt(line.slice(4), 10);
      else if (line === 'end_of_record') {
        files.push(current);
        current = null;
      }
    }
  }

  return files;
}

/**
 * Aggregate file stats into totals
 * @param {Array} files - Array of file coverage objects
 * @returns {object} - Aggregated stats with lines, branches, functions percentages
 */
export function aggregateStats(files) {
  const totals = { linesHit: 0, linesTotal: 0, branchesHit: 0, branchesTotal: 0, functionsHit: 0, functionsTotal: 0 };
  for (const f of files) {
    totals.linesHit += f.linesHit;
    totals.linesTotal += f.linesTotal;
    totals.branchesHit += f.branchesHit;
    totals.branchesTotal += f.branchesTotal;
    totals.functionsHit += f.functionsHit;
    totals.functionsTotal += f.functionsTotal;
  }
  return {
    lines: totals.linesTotal ? ((totals.linesHit / totals.linesTotal) * 100).toFixed(1) : '-',
    branches: totals.branchesTotal ? ((totals.branchesHit / totals.branchesTotal) * 100).toFixed(1) : '-',
    functions: totals.functionsTotal ? ((totals.functionsHit / totals.functionsTotal) * 100).toFixed(1) : '-',
  };
}

/**
 * Format file stats for display
 * @param {object} f - File coverage object
 * @returns {object} - Formatted stats with percentages
 */
export function formatFileStats(f) {
  return {
    lines: f.linesTotal ? ((f.linesHit / f.linesTotal) * 100).toFixed(1) : '-',
    branches: f.branchesTotal ? ((f.branchesHit / f.branchesTotal) * 100).toFixed(1) : '-',
    functions: f.functionsTotal ? ((f.functionsHit / f.functionsTotal) * 100).toFixed(1) : '-',
  };
}

/**
 * Read pre-computed coverage stats from coverage-summary.json
 * @param {string} summaryPath - Path to coverage-summary.json
 * @returns {object|null} - Stats object or null if not found
 */
export function readCoverageSummary(summaryPath) {
  if (!existsSync(summaryPath)) return null;
  try {
    const data = JSON.parse(readFileSync(summaryPath, 'utf-8'));
    const total = data.total;
    return {
      lines: total.lines.pct !== 'Unknown' ? total.lines.pct.toFixed(1) : '-',
      branches: total.branches.pct !== 'Unknown' ? total.branches.pct.toFixed(1) : '-',
      functions: total.functions.pct !== 'Unknown' ? total.functions.pct.toFixed(1) : '-',
    };
  } catch {
    return null;
  }
}

/**
 * Get coverage stats for a single package, including thresholds.
 * @param {object} pkg - Package object with path and runner properties
 * @returns {object|null} - { lines, branches, functions, thresholds? } or null
 */
export function getPackageCoverage(pkg) {
  const summaryPath = join(pkg.path, 'coverage', 'coverage-summary.json');
  const lcovPath = join(pkg.path, 'coverage', 'lcov.info');

  // Try coverage-summary.json first (fast path)
  let stats = readCoverageSummary(summaryPath);

  // Fallback: parse lcov.info
  if (!stats) {
    const files = parseLcovDetailed(lcovPath);
    if (files && files.length > 0) {
      stats = aggregateStats(files);
    }
  }

  if (!stats) return null;

  // Attach thresholds from config
  const thresholds = getPackageThresholds(pkg);
  if (thresholds) {
    stats.thresholds = thresholds;
  }

  return stats;
}

/**
 * Check if file should be excluded from verbose output
 * @param {string} filePath - File path to check
 * @returns {boolean} - True if should be excluded
 */
export function shouldExcludeFile(filePath) {
  return filePath.includes('/var/folders/') ||
         filePath.includes('/tmp/') ||
         filePath.includes('node_modules/');
}

/**
 * Get clean relative path for display
 * @param {string} filePath - Absolute file path
 * @param {string} pkgRoot - Package root directory
 * @returns {string} - Clean relative path for display
 */
export function getDisplayPath(filePath, pkgRoot) {
  let relPath = relative(pkgRoot, filePath);

  if (relPath.startsWith('..')) {
    const pkgMatch = filePath.match(/packages\/([^/]+)\/dist\/(.+)$/);
    if (pkgMatch) {
      return `${pkgMatch[1]}/${pkgMatch[2]}`;
    }
    const srcMatch = filePath.match(/\/src\/(.+)$/);
    if (srcMatch) {
      return 'src/' + srcMatch[1];
    }
  }

  if (relPath.startsWith('../../src/')) {
    return relPath.slice(6);
  }

  return relPath;
}

// ============================================================================
// Threshold Parsing
// ============================================================================

/**
 * Parse coverage thresholds from a vitest config file (TypeScript or JavaScript).
 * Extracts thresholds: { lines, branches, functions } from the `thresholds` block
 * inside test.coverage.
 * @param {string} configPath - Path to vitest.config.ts or vitest.config.js
 * @returns {object|null} - { lines, branches, functions } or null if no thresholds
 */
export function parseVitestThresholds(configPath) {
  if (!existsSync(configPath)) return null;

  const content = readFileSync(configPath, 'utf-8');

  // Match the thresholds block: thresholds: { ... }
  const thresholdsMatch = content.match(/thresholds\s*:\s*\{([^}]+)\}/);
  if (!thresholdsMatch) return null;

  const block = thresholdsMatch[1];
  const result = {};

  for (const key of ['lines', 'branches', 'functions']) {
    const m = block.match(new RegExp(`${key}\\s*:\\s*([\\d.]+)`));
    if (m) result[key] = parseFloat(m[1]);
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse coverage thresholds from bunfig.toml.
 * Bun uses coverageThreshold with line/function/statement keys under [test].
 * @param {string} configPath - Path to bunfig.toml
 * @returns {object|null} - { lines, branches, functions } or null if no thresholds
 */
export function parseBunThresholds(configPath) {
  if (!existsSync(configPath)) return null;

  const content = readFileSync(configPath, 'utf-8');

  // Bun uses coverageThreshold = { line = N, function = N, statement = N }
  // or [test.coverageThreshold] section
  const thresholdMatch = content.match(/coverageThreshold\s*=\s*\{([^}]+)\}/);
  if (!thresholdMatch) return null;

  const block = thresholdMatch[1];
  const result = {};

  // Bun uses singular: line, function, statement (no branches)
  const lineMatch = block.match(/line\s*=\s*([\d.]+)/);
  if (lineMatch) result.lines = parseFloat(lineMatch[1]);

  const funcMatch = block.match(/function\s*=\s*([\d.]+)/);
  if (funcMatch) result.functions = parseFloat(funcMatch[1]);

  // Bun doesn't have a branches threshold natively
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Get coverage thresholds for a package by reading its config file.
 * Delegates to the runner adapter's getThresholds().
 * @param {object} pkg - Package object with path and runner properties
 * @returns {object|null} - { lines?, branches?, functions? } or null
 */
export function getPackageThresholds(pkg) {
  const runner = getRunner(pkg.runner);
  if (!runner) return null;
  return runner.getThresholds(pkg.path);
}

// ============================================================================
// Package Discovery
// ============================================================================

/**
 * Find all packages with coverage data
 * @param {string} rootDir - Workspace root directory
 * @returns {Array} - Array of package objects with coverage paths
 */
export function findPackagesWithCoverage(rootDir) {
  const packages = [];
  const dirs = ['packages', 'plugins', 'apps'];

  for (const dir of dirs) {
    const dirPath = join(rootDir, dir);
    if (!existsSync(dirPath)) continue;

    for (const name of readdirSync(dirPath)) {
      const pkgPath = join(dirPath, name);
      const summaryPath = join(pkgPath, 'coverage', 'coverage-summary.json');
      const lcovPath = join(pkgPath, 'coverage', 'lcov.info');

      if (existsSync(summaryPath) || existsSync(lcovPath)) {
        packages.push({
          name,
          dir,
          path: pkgPath,
          summaryPath,
          lcovPath,
        });
      }
    }
  }

  return packages;
}

// ============================================================================
// Verbose Coverage Data
// ============================================================================

/**
 * Get verbose coverage data for all packages (per-file details)
 * @param {string} rootDir - Workspace root directory
 * @param {Array} packages - Array of package objects
 * @returns {object} - Object with packageData array and fileWidth
 */
export function getVerboseCoverageData(rootDir, packages) {
  const packageData = packages
    .map(pkg => ({
      name: pkg.name,
      path: pkg.path,
      runner: pkg.runner,
      lcovPath: pkg.lcovPath || join(pkg.path, 'coverage', 'lcov.info'),
      files: parseLcovDetailed(pkg.lcovPath || join(pkg.path, 'coverage', 'lcov.info')) || [],
    }))
    .filter(p => p.files.length > 0);

  const allDisplayPaths = [];
  const packageDisplayData = [];

  for (const pkg of packageData) {
    const relevantFiles = pkg.files.filter(f => !shouldExcludeFile(f.file));
    if (relevantFiles.length === 0) continue;

    const pkgRoot = pkg.path;
    const displayPaths = relevantFiles.map(f => getDisplayPath(f.file, pkgRoot));
    allDisplayPaths.push(...displayPaths);
    const thresholds = getPackageThresholds(pkg);
    packageDisplayData.push({
      name: pkg.name,
      relevantFiles,
      displayPaths,
      pkgRoot,
      stats: aggregateStats(relevantFiles),
      thresholds,
    });
  }

  const fileWidth = Math.max(40, ...allDisplayPaths.map(p => p.length));

  return { packageDisplayData, fileWidth };
}

// ============================================================================
// Per-line coverage status
// ============================================================================

/**
 * Get coverage status for a single source line.
 *
 * @param {number} lineNum - 1-based line number
 * @param {Map<number, number>} lineHits - DA: data (lineNum → executionCount)
 * @param {Map<number, {total: number, taken: number}>} branchHits - BRDA: data
 * @returns {'covered'|'partial'|'uncovered'|null} - null = not instrumented
 */
export function getLineCoverageStatus(lineNum, lineHits, branchHits) {
  if (!lineHits.has(lineNum)) return null;
  const hits = lineHits.get(lineNum);
  if (hits === 0) return 'uncovered';
  const branch = branchHits.get(lineNum);
  if (branch && branch.taken < branch.total) return 'partial';
  return 'covered';
}
