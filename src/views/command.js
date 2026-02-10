/**
 * Command template resolution with foobar2000-style conditional sections.
 *
 * Placeholders: {name} — replaced with values from a map.
 * Conditional sections: [...] — included only if every {placeholder}
 * inside resolved to a non-empty value. Sections cannot nest.
 */

/**
 * Resolve a command template.
 *
 * @param {string} template - Command template string
 * @param {Record<string, string>} values - Placeholder → value map
 * @returns {string} Resolved command
 */
export function resolveCommand(template, values) {
  // 1. Process conditional sections: [literal{placeholder}literal...]
  //    Drop the section if any placeholder inside resolved to ''
  const withSections = template.replace(/\[([^\]]*)\]/g, (_match, inner) => {
    let allPresent = true;
    const resolved = inner.replace(/\{(\w+)\}/g, (_m, key) => {
      const val = values[key] ?? '';
      if (!val) allPresent = false;
      return val;
    });
    return allPresent ? resolved : '';
  });

  // 2. Replace remaining top-level placeholders
  return withSections.replace(/\{(\w+)\}/g, (_m, key) => values[key] ?? '');
}
