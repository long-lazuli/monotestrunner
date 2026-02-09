#!/usr/bin/env node
/**
 * Coverage Summary Script
 *
 * Merges per-package lcov.info files and displays a summary table.
 * Use --verbose to see per-file coverage details.
 */

import { existsSync, statSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

/**
 * Parse lcov.info file and extract per-file coverage stats
 */
function parseLcovDetailed(lcovPath) {
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
 */
function aggregateStats(files) {
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
 */
function formatFileStats(f) {
  return {
    lines: f.linesTotal ? ((f.linesHit / f.linesTotal) * 100).toFixed(1) : '-',
    branches: f.branchesTotal ? ((f.branchesHit / f.branchesTotal) * 100).toFixed(1) : '-',
    functions: f.functionsTotal ? ((f.functionsHit / f.functionsTotal) * 100).toFixed(1) : '-',
  };
}

/**
 * Check if file should be excluded from verbose output
 */
function shouldExcludeFile(filePath) {
  // Exclude temp files and external dependencies
  return filePath.includes('/var/folders/') ||
         filePath.includes('/tmp/') ||
         filePath.includes('node_modules/');
}

/**
 * Get clean relative path for display
 */
function getDisplayPath(filePath, pkgRoot) {
  let relPath = relative(pkgRoot, filePath);

  // If path escapes package (starts with ..), clean it up
  if (relPath.startsWith('..')) {
    // For dist files from other packages, show package name
    const pkgMatch = filePath.match(/packages\/([^/]+)\/dist\/(.+)$/);
    if (pkgMatch) {
      return `@lass-lang/${pkgMatch[1]}/${pkgMatch[2]}`;
    }
    // Try to find src/ in the path and use that as base
    const srcMatch = filePath.match(/\/src\/(.+)$/);
    if (srcMatch) {
      return 'src/' + srcMatch[1];
    }
  }

  // Clean up leading ../../ for src paths within the package
  if (relPath.startsWith('../../src/')) {
    return relPath.slice(6); // Remove '../../'
  }

  return relPath;
}

/**
 * Colorize percentage based on thresholds
 */
function colorize(pct) {
  if (pct === '-') return `${colors.dim}     -${colors.reset}`;
  const num = parseFloat(pct);
  const color = num >= 80 ? colors.green : num >= 60 ? colors.yellow : colors.red;
  return `${color}${pct.padStart(5)}%${colors.reset}`;
}

/**
 * Read pre-computed coverage stats from coverage-summary.json
 */
function readCoverageSummary(summaryPath) {
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
 * Find all packages with coverage
 */
function findPackages() {
  const packages = [];
  const dirs = ['packages', 'plugins', 'apps'];

  for (const dir of dirs) {
    const dirPath = join(rootDir, dir);
    if (!existsSync(dirPath)) continue;

    for (const name of readdirSync(dirPath)) {
      const pkgPath = join(dirPath, name);
      const summaryPath = join(pkgPath, 'coverage', 'coverage-summary.json');
      const lcovPath = join(pkgPath, 'coverage', 'lcov.info');

      // Prefer coverage-summary.json, fall back to lcov.info
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

function mergeCoverage() {
  const coverageDir = join(rootDir, 'coverage');
  mkdirSync(coverageDir, { recursive: true });

  const mergedLcov = join(coverageDir, 'lcov.info');

  try {
    execSync(
      `npx lcov-result-merger './{packages,plugins,apps}/*/coverage/lcov.info' '${mergedLcov}'`,
      { cwd: rootDir, stdio: 'pipe' }
    );
    return mergedLcov;
  } catch (err) {
    console.error(`${colors.red}Failed to merge coverage${colors.reset}`);
    process.exit(1);
  }
}



function main() {
  const packages = findPackages();

  console.log(`\n${colors.bold}${colors.cyan}Coverage Summary${colors.reset}\n`);

  if (verbose) {
    // Verbose: show per-file details grouped by package (needs lcov.info parsing)
    const packageData = packages
      .map(pkg => ({
        name: pkg.name,
        dir: pkg.dir,
        path: pkg.path,
        files: parseLcovDetailed(pkg.lcovPath) || [],
      }))
      .filter(p => p.files.length > 0);

    // Calculate global file width across all packages for consistent alignment
    const allDisplayPaths = [];
    const packageDisplayData = [];
    
    for (const pkg of packageData) {
      const relevantFiles = pkg.files.filter(f => !shouldExcludeFile(f.file));
      if (relevantFiles.length === 0) continue;
      
      const pkgRoot = join(rootDir, pkg.dir, pkg.name);
      const displayPaths = relevantFiles.map(f => getDisplayPath(f.file, pkgRoot));
      allDisplayPaths.push(...displayPaths);
      packageDisplayData.push({ pkg, relevantFiles, displayPaths, pkgRoot });
    }
    
    const fileWidth = Math.max(40, ...allDisplayPaths.map(p => p.length));

    for (const { pkg, relevantFiles, displayPaths } of packageDisplayData) {
      const stats = aggregateStats(relevantFiles);

      console.log(`${colors.bold}${pkg.name.padEnd(fileWidth + 2)}${colors.reset}  ${colorize(stats.lines)}  ${colorize(stats.branches)}  ${colorize(stats.functions)}`);
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
    // Summary: use pre-computed coverage-summary.json (fast path)
    const results = packages
      .map(pkg => {
        // Try coverage-summary.json first, fall back to lcov.info parsing
        const stats = readCoverageSummary(pkg.summaryPath);
        if (stats) {
          return { name: pkg.name, ...stats };
        }
        // Fallback: parse lcov.info
        const files = parseLcovDetailed(pkg.lcovPath);
        if (files && files.length > 0) {
          return { name: pkg.name, ...aggregateStats(files) };
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
  const mergedLcov = mergeCoverage();

  if (existsSync(mergedLcov)) {
    const stats = statSync(mergedLcov);
    const sizeKb = (stats.size / 1024).toFixed(1);
    console.log(`${colors.green}✓${colors.reset} Merged: coverage/lcov.info (${sizeKb} KB)`);
  }

  console.log();
}

main();
