/**
 * Output parsers for test runners
 * Parses vitest and bun test output formats, including JUnit XML
 */

import { readFileSync, existsSync } from 'node:fs';
import { stripAnsi } from './ui.js';

/**
 * Parse vitest final output for results
 */
export function parseVitestFinal(output) {
  const result = { files: 0, tests: 0, passed: 0, skipped: 0, failed: 0, duration: 0 };
  const clean = stripAnsi(output);

  // Test Files  11 passed (11) or Test Files  1 failed | 10 passed (11)
  const filesMatch = clean.match(/Test Files\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+passed)?\s*\((\d+)\)/);
  if (filesMatch) {
    result.files = parseInt(filesMatch[3], 10) || 0;
  }

  // Tests  516 passed | 37 skipped (553) or Tests  73 passed (73)
  const testsMatch = clean.match(/Tests\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+passed)?(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/);
  if (testsMatch) {
    result.failed = parseInt(testsMatch[1], 10) || 0;
    result.passed = parseInt(testsMatch[2], 10) || 0;
    result.skipped = parseInt(testsMatch[3], 10) || 0;
    result.tests = parseInt(testsMatch[4], 10) || 0;
  }

  // Duration  2.07s or Duration  294ms
  const durationMatch = clean.match(/Duration\s+([\d.]+)(ms|s)/);
  if (durationMatch) {
    const value = parseFloat(durationMatch[1]);
    result.duration = durationMatch[2] === 'ms' ? value / 1000 : value;
  }

  return result;
}

/**
 * Parse bun:test final output for results
 */
export function parseBunFinal(output) {
  const result = { files: 0, tests: 0, passed: 0, skipped: 0, failed: 0, duration: 0 };
  const clean = stripAnsi(output);

  // 24 pass
  const passMatch = clean.match(/(\d+)\s+pass/);
  if (passMatch) {
    result.passed = parseInt(passMatch[1], 10);
  }

  // 0 fail
  const failMatch = clean.match(/(\d+)\s+fail/);
  if (failMatch) {
    result.failed = parseInt(failMatch[1], 10);
  }

  // X skip
  const skipMatch = clean.match(/(\d+)\s+skip/);
  if (skipMatch) {
    result.skipped = parseInt(skipMatch[1], 10);
  }

  // Ran 24 tests across 1 file. [386.00ms]
  const summaryMatch = clean.match(/Ran\s+(\d+)\s+tests\s+across\s+(\d+)\s+files?.*?\[([\d.]+)(ms|s)\]/);
  if (summaryMatch) {
    result.tests = parseInt(summaryMatch[1], 10);
    result.files = parseInt(summaryMatch[2], 10);
    const value = parseFloat(summaryMatch[3]);
    result.duration = summaryMatch[4] === 'ms' ? value / 1000 : value;
  }

  return result;
}

/**
 * Count dots in a chunk for vitest (dot reporter)
 * · = pass, - = skip, × = fail
 */
export function countVitestDots(chunk) {
  const clean = stripAnsi(chunk);
  return {
    passed: (clean.match(/·/g) || []).length,
    skipped: (clean.match(/-/g) || []).length,
    failed: (clean.match(/×/g) || []).length,
  };
}

/**
 * Count dots in a chunk for bun (dots reporter)
 * . = pass
 */
export function countBunDots(chunk) {
  const clean = stripAnsi(chunk);
  return {
    passed: (clean.match(/\./g) || []).length,
    skipped: 0,
    failed: 0,
  };
}

// ============================================================================
// JUnit XML Parsing
// ============================================================================

/**
 * Decode XML entities in a string
 */
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;gt;/g, '>')
    .replace(/&amp;lt;/g, '<')
    .replace(/&amp;apos;/g, "'")
    .replace(/&amp;quot;/g, '"')
    .replace(/&amp;amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/**
 * Extract attribute value from an XML tag string
 */
function getAttr(tag, name) {
  // Match both single and double quoted attributes, with word boundary to avoid
  // matching "classname" when looking for "name"
  const match = tag.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`));
  return match ? decodeXmlEntities(match[1]) : '';
}

/**
 * Parse a JUnit XML file into structured test results.
 *
 * Handles both vitest (flat) and bun (nested) JUnit formats:
 * - vitest: <testcase classname="file.ts" name="describe > describe > test">
 * - bun: nested <testsuite> with <testcase name="test" classname="describe path">
 *
 * @param {string} filePath - Path to the junit.xml file
 * @returns {{ suites: Array<{ name: string, file: string, tests: Array<{ name: string, status: string, duration: number, failureMessage: string }> }> } | null}
 */
export function parseJunitFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  let xml;
  try {
    xml = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  if (!xml.trim()) {
    return null;
  }

  const suites = [];

  // Collect all testcase elements with their content (self-closing and paired)
  // We need to associate each testcase with its parent testsuite for the file name.
  // Strategy: find top-level <testsuite> blocks (which correspond to test files),
  // then extract testcases from within them.

  // First, find all top-level testsuite elements (direct children of <testsuites>)
  // For vitest: each <testsuite name="filename"> contains flat testcases
  // For bun: <testsuite> elements may be nested (describe blocks contain child testsuites)

  // Parse by finding testsuite blocks with their testcases
  // Use a recursive approach to handle bun's nested structure

  const result = { suites: [] };

  // Find the top-level <testsuites> content
  const testsuitesMatch = xml.match(/<testsuites[^>]*>([\s\S]*)<\/testsuites>/);
  if (!testsuitesMatch) {
    return null;
  }

  const content = testsuitesMatch[1];

  // Parse test suites from XML content
  parseTestSuites(content, '', result.suites);

  return result;
}

/**
 * Parse <testsuite> elements from XML content, handling nesting.
 * Groups all testcases by their file (top-level testsuite name).
 */
function parseTestSuites(xml, parentDescribe, suites) {
  // Find testsuite opening tags with their content
  let pos = 0;

  while (pos < xml.length) {
    // Find next <testsuite or <testcase
    const suiteStart = xml.indexOf('<testsuite ', pos);
    const caseStart = xml.indexOf('<testcase ', pos);

    // Determine which comes first
    let nextPos;
    if (suiteStart === -1 && caseStart === -1) break;
    if (suiteStart === -1) nextPos = caseStart;
    else if (caseStart === -1) nextPos = suiteStart;
    else nextPos = Math.min(suiteStart, caseStart);

    if (nextPos === caseStart && caseStart !== -1) {
      // Found a testcase - parse it
      const testcase = parseTestCase(xml, caseStart, parentDescribe);
      if (testcase) {
        // Add to appropriate suite
        addTestToSuites(suites, testcase.file, testcase.test);
        pos = testcase.endPos;
      } else {
        pos = caseStart + 1;
      }
    } else if (nextPos === suiteStart && suiteStart !== -1) {
      // Found a testsuite - get its attributes and recurse into it
      const tagEnd = xml.indexOf('>', suiteStart);
      if (tagEnd === -1) break;

      const tag = xml.substring(suiteStart, tagEnd + 1);
      const suiteName = getAttr(tag, 'name');

      // Check if self-closing
      if (tag.endsWith('/>')) {
        pos = tagEnd + 1;
        continue;
      }

      // Find matching </testsuite>
      const innerContent = findClosingTag(xml, tagEnd + 1, 'testsuite');
      if (innerContent === null) break;

      // Determine if this is a file-level suite or a describe-level suite
      // vitest: name is the file path (e.g., "test/errors.test.ts")
      // bun: name is the test file or describe block name
      const isFile = suiteName.includes('/') || suiteName.endsWith('.ts') || suiteName.endsWith('.js') || suiteName.endsWith('.tsx') || suiteName.endsWith('.jsx');

      let describe;
      if (isFile) {
        // File-level suite — reset describe path
        describe = '';
      } else if (parentDescribe) {
        describe = `${parentDescribe} > ${suiteName}`;
      } else {
        describe = suiteName;
      }

      // Recurse into this suite's content
      parseTestSuites(innerContent.content, describe, suites);

      pos = innerContent.endPos;
    } else {
      break;
    }
  }
}

/**
 * Find the matching closing tag, handling nested same-name tags.
 * Returns { content, endPos } where endPos is after </tagName>
 */
function findClosingTag(xml, startPos, tagName) {
  let depth = 1;
  let pos = startPos;
  const openPattern = `<${tagName}`;
  const closePattern = `</${tagName}>`;

  while (pos < xml.length && depth > 0) {
    const nextOpen = xml.indexOf(openPattern, pos);
    const nextClose = xml.indexOf(closePattern, pos);

    if (nextClose === -1) return null;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Check if this is a self-closing tag
      const tagEnd = xml.indexOf('>', nextOpen);
      if (tagEnd !== -1 && xml[tagEnd - 1] === '/') {
        // Self-closing, doesn't affect depth
        pos = tagEnd + 1;
      } else {
        depth++;
        pos = nextOpen + openPattern.length;
      }
    } else {
      depth--;
      if (depth === 0) {
        return {
          content: xml.substring(startPos, nextClose),
          endPos: nextClose + closePattern.length,
        };
      }
      pos = nextClose + closePattern.length;
    }
  }

  return null;
}

/**
 * Parse a single <testcase> element from the XML.
 * Returns { file, test, endPos } or null.
 */
function parseTestCase(xml, startPos, parentDescribe) {
  const tagEnd = xml.indexOf('>', startPos);
  if (tagEnd === -1) return null;

  const tag = xml.substring(startPos, tagEnd + 1);
  const isSelfClosing = tag.endsWith('/>');

  const name = getAttr(tag, 'name');
  const classname = getAttr(tag, 'classname');
  const time = getAttr(tag, 'time');
  const fileAttr = getAttr(tag, 'file');

  let endPos;
  let failureMessage = '';
  let isSkipped = false;

  if (isSelfClosing) {
    endPos = tagEnd + 1;
  } else {
    // Find </testcase>
    const closeIdx = xml.indexOf('</testcase>', tagEnd);
    if (closeIdx === -1) return null;

    const inner = xml.substring(tagEnd + 1, closeIdx);

    // Check for <failure>
    const failureMatch = inner.match(/<failure[^>]*(?:message=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/failure>/);
    if (failureMatch) {
      failureMessage = decodeXmlEntities(failureMatch[2]).trim();
      if (!failureMessage && failureMatch[1]) {
        failureMessage = decodeXmlEntities(failureMatch[1]);
      }
    }

    // Check for <skipped/>
    if (inner.includes('<skipped')) {
      isSkipped = true;
    }

    endPos = closeIdx + '</testcase>'.length;
  }

  // Determine test status
  let status;
  if (failureMessage) {
    status = 'failed';
  } else if (isSkipped) {
    status = 'skipped';
  } else {
    status = 'passed';
  }

  // Determine file and full test name
  // vitest: classname is the file, name is the full describe path "describe > test"
  // bun: classname is the describe path, name is just the test name, file attr has the path
  let file, fullTestName;

  const classnameIsFile = classname.includes('/') || classname.endsWith('.ts') || classname.endsWith('.js') || classname.endsWith('.tsx') || classname.endsWith('.jsx');

  if (classnameIsFile) {
    // vitest format: classname=file, name=full path
    file = classname;
    fullTestName = name;
  } else {
    // bun format: classname=describe path (may use &gt; separators), name=test name
    // Use file attribute if available, otherwise infer from parent
    file = fileAttr || '';
    if (parentDescribe) {
      fullTestName = `${parentDescribe} > ${name}`;
    } else if (classname) {
      fullTestName = `${classname} > ${name}`;
    } else {
      fullTestName = name;
    }
  }

  const duration = time ? parseFloat(time) : 0;

  return {
    file: file || classname || 'unknown',
    test: {
      name: fullTestName,
      status,
      duration,
      failureMessage,
    },
    endPos,
  };
}

/**
 * Add a test result to the appropriate suite in the suites array.
 */
function addTestToSuites(suites, fileName, test) {
  let suite = suites.find((s) => s.file === fileName);
  if (!suite) {
    suite = {
      name: fileName,
      file: fileName,
      tests: [],
    };
    suites.push(suite);
  }
  suite.tests.push(test);
}

/**
 * Extract the first failure line number from a failure message stack trace.
 * Matches vitest (❯ file:line:col) and bun (at file:line:col) patterns.
 * Only returns a line from a stack frame whose path ends with the given file.
 *
 * @param {string} failureMessage - Raw failure message with stack trace
 * @param {string} file - Test file path to match against (e.g. "test/errors.test.ts")
 * @returns {string} Line number as string, or '' if not found
 */
export function extractFailureLine(failureMessage, file) {
  if (!failureMessage || !file) return '';
  for (const line of failureMessage.split('\n')) {
    const m = line.match(/(?:❯|at)\s+(.+?):(\d+):\d+/);
    if (m && m[1].endsWith(file)) return m[2];
  }
  return '';
}
