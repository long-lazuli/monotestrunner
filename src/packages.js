/**
 * Package discovery for monorepos.
 *
 * Discovers packages using a strategy chain:
 *   1. pnpm — pnpm-workspace.yaml
 *   2. npm/yarn — package.json "workspaces" field
 *   (future strategies slot in here)
 *   3. fallback — treat rootDir itself as a single package
 *
 * Each strategy returns an array of package objects:
 *   { name, path, testScript, runner }
 *
 * Packages without a test script get runner: null, testScript: null.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import picomatch from 'picomatch';
import { detectRunner } from './runners/index.js';

// ============================================================================
// Strategy: pnpm workspace
// ============================================================================

/**
 * Parse pnpm-workspace.yaml and discover packages.
 * Minimal YAML parser — only handles the `packages:` list.
 *
 * @param {string} rootDir - Workspace root
 * @returns {object[]|null} - Array of packages, or null if not a pnpm workspace
 */
function discoverPnpm(rootDir) {
  const yamlPath = join(rootDir, 'pnpm-workspace.yaml');
  if (!existsSync(yamlPath)) return null;

  const content = readFileSync(yamlPath, 'utf-8');
  const globs = parsePnpmWorkspaceYaml(content);
  if (globs.length === 0) return null;

  return expandWorkspaceGlobs(globs, rootDir);
}

/**
 * Parse the packages list from pnpm-workspace.yaml content.
 * Handles: - "glob", - 'glob', - glob (unquoted)
 * @param {string} content - Raw YAML content
 * @returns {string[]} - Array of glob patterns
 */
export function parsePnpmWorkspaceYaml(content) {
  const globs = [];
  let inPackages = false;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (/^packages\s*:/.test(trimmed)) {
      inPackages = true;
      continue;
    }

    // End of packages block: non-indented, non-empty line that's not a list item
    if (inPackages && trimmed && !trimmed.startsWith('-') && !trimmed.startsWith('#')) {
      break;
    }

    if (inPackages && trimmed.startsWith('-')) {
      // Strip leading "- ", then strip quotes
      const value = trimmed.slice(1).trim().replace(/^['"]|['"]$/g, '');
      if (value) globs.push(value);
    }
  }

  return globs;
}

// ============================================================================
// Strategy: npm/yarn workspaces
// ============================================================================

/**
 * Read the "workspaces" field from package.json and discover packages.
 * Handles both array format and { packages: [...] } format.
 *
 * @param {string} rootDir - Workspace root
 * @returns {object[]|null} - Array of packages, or null if not a npm/yarn workspace
 */
function discoverNpmWorkspaces(rootDir) {
  const pkgJsonPath = join(rootDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return null;

  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  } catch {
    return null;
  }

  let workspaces = pkgJson.workspaces;
  if (!workspaces) return null;

  // Normalize { packages: [...] } format (yarn)
  if (workspaces.packages && Array.isArray(workspaces.packages)) {
    workspaces = workspaces.packages;
  }

  if (!Array.isArray(workspaces) || workspaces.length === 0) return null;

  return expandWorkspaceGlobs(workspaces, rootDir);
}

// ============================================================================
// Strategy: fallback (single package)
// ============================================================================

/**
 * Treat rootDir itself as a single package.
 *
 * @param {string} rootDir - Directory to treat as the package
 * @returns {object[]} - Array with 0 or 1 package
 */
function discoverFallback(rootDir) {
  const pkg = readPackageAt(rootDir);
  if (pkg) return [pkg];
  return [];
}

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Expand workspace glob patterns to package objects.
 * Handles both wildcard globs (packages/*) and explicit paths (plugins/foo/test-app).
 *
 * @param {string[]} globs - Workspace glob patterns
 * @param {string} rootDir - Workspace root
 * @returns {object[]} - Discovered packages
 */
function expandWorkspaceGlobs(globs, rootDir) {
  const seen = new Set();
  const packages = [];

  for (const pattern of globs) {
    // Check if this is a direct path (no wildcards)
    if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('{')) {
      const dirPath = resolve(rootDir, pattern);
      if (!seen.has(dirPath)) {
        seen.add(dirPath);
        const pkg = readPackageAt(dirPath);
        if (pkg) packages.push(pkg);
      }
      continue;
    }

    // Glob pattern — find the static base dir and scan from there
    const baseDir = getGlobBase(pattern);
    const fullBase = resolve(rootDir, baseDir);
    if (!existsSync(fullBase)) continue;

    const matcher = picomatch(pattern);

    // Scan one level of directories under the base
    // (workspace globs are typically "packages/*" — one level)
    try {
      for (const entry of readdirSync(fullBase, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const relPath = baseDir ? `${baseDir}/${entry.name}` : entry.name;
        if (!matcher(relPath)) continue;

        const dirPath = join(fullBase, entry.name);
        if (!seen.has(dirPath)) {
          seen.add(dirPath);
          const pkg = readPackageAt(dirPath);
          if (pkg) packages.push(pkg);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return packages;
}

/**
 * Read a package.json at a directory and create a package object.
 * Returns null if no package.json exists.
 *
 * @param {string} dirPath - Absolute path to package directory
 * @returns {object|null}
 */
function readPackageAt(dirPath) {
  const pkgJsonPath = join(dirPath, 'package.json');
  if (!existsSync(pkgJsonPath)) return null;

  try {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const testScript = pkgJson.scripts?.test || null;
    return {
      name: pkgJson.name || basename(dirPath),
      path: dirPath,
      testScript,
      runner: detectRunner(testScript),
    };
  } catch {
    return null;
  }
}

/**
 * Get the static base directory from a glob pattern (before any wildcards).
 * @param {string} pattern
 * @returns {string}
 */
function getGlobBase(pattern) {
  const parts = pattern.split('/');
  const base = [];
  for (const part of parts) {
    if (part.includes('*') || part.includes('?') || part.includes('{')) break;
    base.push(part);
  }
  return base.join('/');
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Ordered strategy chain. First strategy that returns a non-null result wins.
 * To add a new strategy (e.g. lerna, nx), add a function here.
 */
const strategies = [
  discoverPnpm,
  discoverNpmWorkspaces,
  // future: discoverLerna, discoverNx, ...
  discoverFallback,
];

/**
 * Discover all packages in a workspace.
 *
 * @param {string} rootDir - Workspace root directory
 * @returns {object[]} - Array of { name, path, testScript, runner }
 */
export function discoverPackages(rootDir) {
  for (const strategy of strategies) {
    const result = strategy(rootDir);
    if (result !== null && result.length > 0) return result;
  }
  return [];
}
