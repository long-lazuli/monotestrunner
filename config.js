/**
 * Configuration loading and validation for monotestrunner
 * Uses lilconfig for flexible config file discovery
 */

import { lilconfig } from 'lilconfig';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import picomatch from 'picomatch';

const MODULE_NAME = 'monotestrunner';

/**
 * Load config from .monotestrunnerrc.json or other lilconfig locations
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<object>} - Config object (empty if no config found)
 */
export async function loadConfig(rootDir) {
  const explorer = lilconfig(MODULE_NAME);
  try {
    const result = await explorer.search(rootDir);
    return result?.config ?? {};
  } catch (error) {
    console.error(`Error loading config: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Validate config and exit on errors
 * @param {object} config - Config object
 * @param {Array} packages - Available packages
 * @param {string} rootDir - Workspace root directory
 */
export function validateConfig(config, packages, rootDir) {
  if (!config.watchMappings || !Array.isArray(config.watchMappings)) {
    return; // No watchMappings, nothing to validate
  }

  const packageNames = new Set(packages.map(p => p.name));

  for (const mapping of config.watchMappings) {
    // Validate paths exist
    if (!mapping.paths || !Array.isArray(mapping.paths)) {
      console.error('Error: watchMappings entry missing "paths" array');
      process.exit(1);
    }

    for (const pattern of mapping.paths) {
      validatePath(pattern, rootDir);
    }

    // Validate triggers
    if (!mapping.triggers) {
      console.error('Error: watchMappings entry missing "triggers"');
      process.exit(1);
    }

    if (mapping.triggers !== '*') {
      if (!Array.isArray(mapping.triggers)) {
        console.error('Error: watchMappings "triggers" must be an array of package names or "*"');
        process.exit(1);
      }

      for (const pkgName of mapping.triggers) {
        if (!packageNames.has(pkgName)) {
          console.error(`Error: watchMappings trigger package not found: "${pkgName}"`);
          console.error(`Available packages: ${[...packageNames].join(', ')}`);
          process.exit(1);
        }
      }
    }
  }
}

/**
 * Validate a path/glob pattern exists
 * @param {string} pattern - Path or glob pattern
 * @param {string} rootDir - Workspace root directory
 */
function validatePath(pattern, rootDir) {
  // Check if it's a glob pattern
  const isGlob = pattern.includes('*') || pattern.includes('?') || pattern.includes('{');
  
  if (isGlob) {
    // For globs, check if the base directory exists
    const baseDir = getGlobBaseDir(pattern);
    const fullBaseDir = isAbsolute(baseDir) ? baseDir : join(rootDir, baseDir);
    
    if (!existsSync(fullBaseDir)) {
      console.error(`Error: watchMappings base path does not exist: "${baseDir}"`);
      process.exit(1);
    }
    
    // Check if glob matches any files (warning only)
    const matches = expandGlob(pattern, rootDir);
    if (matches.length === 0) {
      console.warn(`Warning: watchMappings glob matches no files: "${pattern}"`);
    }
  } else {
    // For non-glob paths, check if path exists
    const fullPath = isAbsolute(pattern) ? pattern : join(rootDir, pattern);
    if (!existsSync(fullPath)) {
      console.error(`Error: watchMappings path does not exist: "${pattern}"`);
      process.exit(1);
    }
  }
}

/**
 * Get the base directory from a glob pattern (before any wildcards)
 * @param {string} pattern - Glob pattern
 * @returns {string} - Base directory path
 */
function getGlobBaseDir(pattern) {
  const parts = pattern.split('/');
  const baseParts = [];
  
  for (const part of parts) {
    if (part.includes('*') || part.includes('?') || part.includes('{')) {
      break;
    }
    baseParts.push(part);
  }
  
  return baseParts.join('/') || '.';
}

/**
 * Expand a glob pattern to matching file paths
 * @param {string} pattern - Glob pattern
 * @param {string} rootDir - Workspace root directory
 * @returns {string[]} - Matching file paths
 */
export function expandGlob(pattern, rootDir) {
  const baseDir = getGlobBaseDir(pattern);
  const fullBaseDir = isAbsolute(baseDir) ? baseDir : join(rootDir, baseDir);
  
  if (!existsSync(fullBaseDir)) {
    return [];
  }
  
  const matcher = picomatch(pattern);
  const matches = [];
  
  walkDir(fullBaseDir, (filePath) => {
    // Get path relative to rootDir for matching
    const relativePath = filePath.startsWith(rootDir) 
      ? filePath.slice(rootDir.length + 1) 
      : filePath;
    
    if (matcher(relativePath)) {
      matches.push(filePath);
    }
  });
  
  return matches;
}

/**
 * Walk a directory recursively
 * @param {string} dir - Directory to walk
 * @param {Function} callback - Called for each file
 */
function walkDir(dir, callback) {
  if (!existsSync(dir)) return;
  
  const entries = readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Skip node_modules
      if (entry.name === 'node_modules') continue;
      walkDir(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}

/**
 * Get directories to watch from watchMappings
 * Returns the base directories that need to be watched
 * @param {Array} watchMappings - Config watchMappings
 * @param {string} rootDir - Workspace root directory
 * @returns {string[]} - Directories to watch
 */
export function getWatchMappingDirs(watchMappings, rootDir) {
  if (!watchMappings || !Array.isArray(watchMappings)) {
    return [];
  }
  
  const dirs = new Set();
  
  for (const mapping of watchMappings) {
    for (const pattern of mapping.paths) {
      const baseDir = getGlobBaseDir(pattern);
      const fullBaseDir = isAbsolute(baseDir) ? baseDir : join(rootDir, baseDir);
      
      if (existsSync(fullBaseDir)) {
        dirs.add(fullBaseDir);
      }
    }
  }
  
  return [...dirs];
}

/**
 * Check if a file path matches any watchMapping and return triggered packages
 * @param {string} filePath - Absolute file path that changed
 * @param {Array} watchMappings - Config watchMappings
 * @param {string} rootDir - Workspace root directory
 * @returns {string[] | "*" | null} - Package names to trigger, "*" for all, or null if no match
 */
export function getTriggeredPackages(filePath, watchMappings, rootDir) {
  if (!watchMappings || !Array.isArray(watchMappings)) {
    return null;
  }
  
  // Get path relative to rootDir for matching
  const relativePath = filePath.startsWith(rootDir + '/') 
    ? filePath.slice(rootDir.length + 1) 
    : filePath;
  
  for (const mapping of watchMappings) {
    for (const pattern of mapping.paths) {
      const matcher = picomatch(pattern);
      
      if (matcher(relativePath)) {
        return mapping.triggers;
      }
    }
  }
  
  return null;
}
