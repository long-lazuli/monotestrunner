#!/usr/bin/env node
/**
 * Coverage Summary Module
 *
 * Parses and displays coverage data from lcov.info files.
 * Can be used standalone or imported by monotestrunner.
 */

import { existsSync, statSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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
      };
    } else if (current) {
      if (line.startsWith('LH:')) current.linesHit = parseInt(line.slice(3), 10);
      if (line.startsWith('LF:')) current.linesTotal = parseInt(line.slice(3), 10);
      if (line.startsWith('BRH:')) current.branchesHit = parseInt(line.slice(4), 10);
      if (line.startsWith('BRF:')) current.branchesTotal = parseInt(line.slice(4), 10);
      if (line.startsWith('FNH:')) current.functionsHit = parseInt(line.slice(4), 10);
      if (line.startsWith('FNF:')) current.functionsTotal = parseInt(line.slice(4), 10);
      if (line === 'end_of_record') {
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
 * Get coverage stats for a single package
 * @param {object} pkg - Package object with path property
 * @returns {object|null} - Stats object or null if no coverage data
 */
export function getPackageCoverage(pkg) {
  const summaryPath = join(pkg.path, 'coverage', 'coverage-summary.json');
  const lcovPath = join(pkg.path, 'coverage', 'lcov.info');

  // Try coverage-summary.json first (fast path)
  const stats = readCoverageSummary(summaryPath);
  if (stats) {
    return stats;
  }

  // Fallback: parse lcov.info
  const files = parseLcovDetailed(lcovPath);
  if (files && files.length > 0) {
    return aggregateStats(files);
  }

  return null;
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
      return `@lass-lang/${pkgMatch[1]}/${pkgMatch[2]}`;
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
// Coverage Merging
// ============================================================================

/**
 * Merge all package lcov.info files into a single file
 * @param {string} rootDir - Workspace root directory
 * @returns {string|null} - Path to merged lcov.info or null on failure
 */
export function mergeCoverageFiles(rootDir) {
  const coverageDir = join(rootDir, 'coverage');
  mkdirSync(coverageDir, { recursive: true });

  const mergedLcov = join(coverageDir, 'lcov.info');

  try {
    execSync(
      `npx lcov-result-merger './{packages,plugins,apps}/*/coverage/lcov.info' '${mergedLcov}'`,
      { cwd: rootDir, stdio: 'pipe' }
    );
    return mergedLcov;
  } catch {
    return null;
  }
}

/**
 * Get merged lcov file info (size, path)
 * @param {string} mergedLcovPath - Path to merged lcov.info
 * @returns {object|null} - Object with path and sizeKb or null
 */
export function getMergedCoverageInfo(mergedLcovPath) {
  if (!existsSync(mergedLcovPath)) return null;
  const stats = statSync(mergedLcovPath);
  return {
    path: mergedLcovPath,
    sizeKb: (stats.size / 1024).toFixed(1),
  };
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
      dir: pkg.dir,
      path: pkg.path,
      lcovPath: pkg.lcovPath || join(pkg.path, 'coverage', 'lcov.info'),
      files: parseLcovDetailed(pkg.lcovPath || join(pkg.path, 'coverage', 'lcov.info')) || [],
    }))
    .filter(p => p.files.length > 0);

  const allDisplayPaths = [];
  const packageDisplayData = [];

  for (const pkg of packageData) {
    const relevantFiles = pkg.files.filter(f => !shouldExcludeFile(f.file));
    if (relevantFiles.length === 0) continue;

    const pkgRoot = join(rootDir, pkg.dir, pkg.name);
    const displayPaths = relevantFiles.map(f => getDisplayPath(f.file, pkgRoot));
    allDisplayPaths.push(...displayPaths);
    packageDisplayData.push({
      name: pkg.name,
      relevantFiles,
      displayPaths,
      pkgRoot,
      stats: aggregateStats(relevantFiles),
    });
  }

  const fileWidth = Math.max(40, ...allDisplayPaths.map(p => p.length));

  return { packageDisplayData, fileWidth };
}

// ============================================================================
// Standalone CLI
// ============================================================================

// ANSI colors for standalone mode
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function colorize(pct) {
  if (pct === '-') return `${colors.dim}     -${colors.reset}`;
  const num = parseFloat(pct);
  const color = num >= 80 ? colors.green : num >= 60 ? colors.yellow : colors.red;
  return `${color}${pct.padStart(5)}%${colors.reset}`;
}

function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = join(__dirname, '..');
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

  const packages = findPackagesWithCoverage(rootDir);

  console.log(`\n${colors.bold}${colors.cyan}Coverage Summary${colors.reset}\n`);

  if (verbose) {
    const { packageDisplayData, fileWidth } = getVerboseCoverageData(rootDir, packages);

    for (const { name, relevantFiles, displayPaths, stats } of packageDisplayData) {
      console.log(`${colors.bold}${name.padEnd(fileWidth + 2)}${colors.reset}  ${colorize(stats.lines)}  ${colorize(stats.branches)}  ${colorize(stats.functions)}`);
      console.log(`${colors.dim}${'─'.repeat(fileWidth + 26)}${colors.reset}`);

      for (let i = 0; i < relevantFiles.length; i++) {
        const f = relevantFiles[i];
        const relPath = displayPaths[i];
        const fStats = formatFileStats(f);
        console.log(
          `  ${colors.dim}${relPath.padEnd(fileWidth)}${colors.reset}  ${colorize(fStats.lines)}  ${colorize(fStats.branches)}  ${colorize(fStats.functions)}`
        );
      }
      console.log();
    }
  } else {
    const results = packages
      .map(pkg => {
        const stats = getPackageCoverage(pkg);
        if (stats) {
          return { name: pkg.name, ...stats };
        }
        return null;
      })
      .filter(Boolean);

    if (results.length > 0) {
      const nameWidth = Math.max(20, ...results.map(r => r.name.length));

      console.log(`${colors.dim}${'Package'.padEnd(nameWidth + 2)}  ${'Lines'.padStart(6)}  ${'Branch'.padStart(6)}  ${'Funcs'.padStart(6)}${colors.reset}`);
      console.log(`${colors.dim}${'─'.repeat(nameWidth + 26)}${colors.reset}`);

      for (const r of results) {
        console.log(
          `  ${r.name.padEnd(nameWidth)}  ${colorize(r.lines)}  ${colorize(r.branches)}  ${colorize(r.functions)}`
        );
      }

      console.log();
    }
  }

  // Merge coverage files
  const mergedLcov = mergeCoverageFiles(rootDir);
  const mergedInfo = mergedLcov ? getMergedCoverageInfo(mergedLcov) : null;

  if (mergedInfo) {
    console.log(`${colors.green}✓${colors.reset} Merged: coverage/lcov.info (${mergedInfo.sizeKb} KB)`);
  } else {
    console.log(`${colors.red}✗${colors.reset} Failed to merge coverage files`);
  }

  console.log();
}

// Run main if executed directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('coverage.js') ||
  process.argv[1].includes('monotestrunner/coverage')
);

if (isMain) {
  main();
}
