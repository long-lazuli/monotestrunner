/**
 * File watcher for monotestrunner
 * Watches source, test files, and custom mapped paths for changes
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { watch as chokidarWatch } from 'chokidar';
import { getWatchMappingDirs, getTriggeredPackages } from './config.js';

/**
 * Map a file path to its package
 */
export function getAffectedPackage(filePath, packages) {
  for (const pkg of packages) {
    // Ensure exact path match by checking for path separator after pkg.path
    if (filePath.startsWith(pkg.path + '/') || filePath === pkg.path) {
      return pkg;
    }
  }
  return null;
}

/**
 * Build watch paths from packages and watchMappings
 * Uses explicit directory paths instead of globs (chokidar v5 compatibility)
 * @param {Array} packages - Package list
 * @param {Array} watchMappings - Optional watchMappings from config
 * @param {string} rootDir - Workspace root directory
 * @returns {string[]} - Directories to watch
 */
export function buildWatchPaths(packages, watchMappings = [], rootDir = '') {
  const paths = new Set();
  
  // Add package src/test directories
  for (const pkg of packages) {
    const srcPath = join(pkg.path, 'src');
    const testPath = join(pkg.path, 'test');
    if (existsSync(srcPath)) paths.add(srcPath);
    if (existsSync(testPath)) paths.add(testPath);
  }
  
  // Add watchMappings directories
  if (watchMappings && rootDir) {
    const mappingDirs = getWatchMappingDirs(watchMappings, rootDir);
    for (const dir of mappingDirs) {
      paths.add(dir);
    }
  }
  
  return [...paths];
}

/**
 * Create a file watcher manager
 * @param {string} rootDir - Workspace root directory
 * @param {Array} packages - Package list
 * @param {Array} watchMappings - Optional watchMappings from config
 * @param {Function} onFileChange - Callback: (pkg, filePath, type) where type is 'direct' | 'mapped' | 'all'
 */
export function createWatcherManager(rootDir, packages, watchMappings, onFileChange) {
  let watcher = null;
  let debounceTimer = null;

  // Build explicit paths from packages and watchMappings
  const watchPaths = buildWatchPaths(packages, watchMappings, rootDir);

  /**
   * Start file watcher
   */
  const start = () => {
    if (watcher) return; // Already running
    if (watchPaths.length === 0) return; // Nothing to watch

    watcher = chokidarWatch(watchPaths, {
      ignored: /node_modules/,
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('change', (filePath) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // First check watchMappings
        const triggeredPkgs = getTriggeredPackages(filePath, watchMappings, rootDir);
        
        if (triggeredPkgs) {
          if (triggeredPkgs === '*') {
            // Trigger all packages
            onFileChange(null, filePath, 'all');
          } else {
            // Trigger specific packages
            for (const pkgName of triggeredPkgs) {
              const pkg = packages.find(p => p.name === pkgName);
              if (pkg) {
                onFileChange(pkg, filePath, 'mapped');
              }
            }
          }
          return;
        }
        
        // Fall back to existing behavior: match file to containing package
        const pkg = getAffectedPackage(filePath, packages);
        if (pkg) {
          onFileChange(pkg, filePath, 'direct');
        }
      }, 300);
    });
  };

  /**
   * Stop file watcher
   */
  const stop = () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    clearTimeout(debounceTimer);
  };

  /**
   * Check if watcher is running
   */
  const isRunning = () => watcher !== null;

  return {
    start,
    stop,
    isRunning,
  };
}
