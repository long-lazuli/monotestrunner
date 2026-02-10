# monotestrunner

Parallel test runner for monorepos with an interactive terminal UI. Runs vitest and bun tests across packages simultaneously with real-time dot streaming, coverage analysis, and file watching.

## Usage

```bash
monotestrunner              # Run all tests once (TTY or CI mode)
monotestrunner -i           # Interactive mode
monotestrunner -w           # Interactive + file watching
monotestrunner -c           # Run with coverage
monotestrunner -v           # Verbose output (failures + per-file coverage)
```

| Flag                | Description                                   |
|---------------------|-----------------------------------------------|
| `-i, --interactive` | Interactive TUI with keyboard navigation      |
| `-w, --watch`       | File watching (implies `-i`)                  |
| `-c, --coverage`    | Enable coverage collection                    |
| `-v, --verbose`     | Show failed test output and per-file coverage |

## Interactive Mode

### Screens

Three screens accessed via `←`/`→` navigation:

**Summary** — Package table with status, pass/skip/fail counts, duration, and inline coverage columns. Cursor selects a package.

**Tests** — Per-package test list grouped by suite. Enter opens a popover:
- Passed/skipped tests: compact 3-line popover (name, separator, filepath + duration/status)
- Failed tests: expanded popover with `├─┤` separator, duration, and scrollable failure message

**Coverage** — Per-file coverage table (lines/branches/functions %). Enter opens a source popover:
- All source lines displayed with coverage annotations
- Color-coded: green (covered), red (uncovered), yellow (partial branch), dim (not instrumented)
- Cursor navigates between uncovered/partial lines
- Enter opens editor at the selected line

### Keybindings

| Key         | Summary               | Tests           | Tests (popover) | Coverage        | Coverage (popover)       |
|-------------|-----------------------|-----------------|-----------------|-----------------|--------------------------|
| `↑/k` `↓/j` | Select package        | Select test     | Scroll body     | Select file     | Navigate uncovered lines |
| `←/h`       | —                     | Back to summary | Close + back    | Back to tests   | Close popover            |
| `→/l`       | Enter tests           | Enter coverage  | Enter coverage  | —               | —                        |
| `Enter`     | Enter tests           | Open popover    | Open in editor  | Open popover    | Open in editor           |
| `Escape`    | —                     | —               | Close popover   | —               | Close popover            |
| `PgUp/PgDn` | Half-page scroll      | Switch package  | Switch package  | Switch package  | Switch package           |
| `r`         | Rerun selected        | Rerun package   | Rerun package   | Rerun package   | Rerun package            |
| `R`         | Rerun all             | Rerun all       | Rerun all       | Rerun all       | Rerun all                |
| `c`         | Toggle coverage       | Toggle coverage | Toggle coverage | Toggle coverage | Toggle coverage          |
| `C`         | Cycle coverage option |                 |                 |                 |                          |
| `w`         | Toggle file watch     |                 |                 |                 |                          |
| `?`         | Help overlay          |                 |                 |                 |                          |
| `q`         | Quit                  | Quit            | Quit            | Quit            | Quit                     |

## Configuration

Config via `.monotestrunnerrc.json` (or any [lilconfig](https://github.com/antonk52/lilconfig) format) in workspace root:

```json
{
  "enterAction": {
    "command": "codium -g {filePath}[:{line}]"
  },
  "watchMappings": [
    {
      "paths": ["apps/docs/content/**/*.md"],
      "triggers": "*"
    },
    {
      "paths": ["shared/schemas/**/*.json"],
      "triggers": ["lass-core", "lass-cli"]
    }
  ]
}
```

### `enterAction.command`

Command template executed when pressing Enter on a test or coverage file. Supports placeholders and foobar2000-style conditional sections.

**Placeholders:**

| Placeholder     | Description                                                                |
|-----------------|----------------------------------------------------------------------------|
| `{filePath}`    | Path relative to workspace root                                            |
| `{absFilePath}` | Absolute path                                                              |
| `{pkgFilePath}` | Path relative to package root                                              |
| `{fileName}`    | Filename only                                                              |
| `{line}`        | Line number (when available)                                               |
| `{testName}`    | Test name (tests screen only)                                              |
| `{packageName}` | Package name                                                               |
| `{packagePath}` | Package absolute path                                                      |

**Conditional sections:** `[...]` — included only if every `{placeholder}` inside resolves to a non-empty value. Otherwise the entire section is dropped.

```
codium -g {filePath}[:{line}]
  → with line=42:  codium -g src/foo.ts:42
  → without line:  codium -g src/foo.ts
```

### `watchMappings`

Maps file glob patterns to packages for the file watcher:

- **`paths`** — Array of glob patterns (relative to workspace root)
- **`triggers`** — Array of package names to rerun, or `"*"` for all packages

## Coverage

### Thresholds

Automatically reads thresholds from each package's config:
- **Vitest**: `thresholds: { lines, branches, functions }` in `vitest.config.ts`
- **Bun**: `coverageThreshold = { line, function }` in `bunfig.toml`

Values below threshold are shown in red on the summary and coverage screens.

### Coverage Popover

The coverage popover shows every source line annotated with execution data:

```
 ┌────────────────────────────────────────────────────┐
 │ ▶ src/parser.ts       L:85.0%  B:70.0%  F:100.0%   │
 │ ────────────────────────────────────────────────── │
 ├────────────────────────────────────────────────────┤
 │  12 │   3 │ const x = foo();          (green dim)  │
 │  13 │   0 │ if (bar) {                (red)        │
 │  14 │   1 │   halfCovered()           (yellow)     │
 │  15 │     │ }                         (dim)        │
 └────────────────────────────────────────────────────┘
```

- Hit count gutter shows execution count per line
- `↑/↓` jumps between uncovered (red) and partial (yellow) lines
- Enter opens the editor at the selected line

## Architecture

```
index.js                    Entry point (imports src/cli.js)
index.test.js               Unit tests (vitest)
src/
  cli.js                    CLI flags, package discovery, mode dispatch
  config.js                 Config loading (lilconfig), glob expansion, validation
  parsers.js                Output parsers (vitest/bun), JUnit XML, extractFailureLine
  coverage.js               Lcov parser (with DA:/BRDA: line data), thresholds, aggregation
  watcher.js                File watcher (chokidar), path mapping
  runner.js                 Non-interactive TTY and CI modes
  ui.js                     Terminal helpers, ANSI utils, formatters
  views/
    interactive.js           Orchestrator — state, keypress handler, render dispatch,
                             child process management, action handlers
    input.js                 classifyKey(str, key) → semantic event
    state.js                 createViewState, coverage flags, dim timer
    command.js               resolveCommand with [conditional] sections
    help.js                  Help overlay renderer
    screens/
      summary.js             Summary table with inline coverage columns
      tests.js               Test list with split view and popover
      header.js              Shared detail screen header + tab bar
      popover.js             Popover box renderer + content builders
                             (buildPopoverContent, buildCoveragePopoverContent)
      coverage.js            Per-file coverage list with split view and popover
```

### Key Design Decisions

- **ESM throughout** — `"type": "module"` in package.json
- **Pure rendering** — Screen modules write to stdout, never mutate state
- **Single source of truth** — `summary.selectedIndex` tracks the active package across all screens
- **Alt screen buffer** — Detail screens (tests/coverage) use `\x1b[?1049h/l` to preserve summary
- **Cursor dim** — 3-second inactivity timer dims the `▶` cursor marker to reduce visual noise
- **Selectable rows** — 4-space indented lines; cursor marker replaces inner 2 spaces with `▶ `

## Package Discovery

Scans `packages/`, `plugins/`, and `apps/` directories for `package.json` files with a `test` script. Runner type (vitest/bun) is auto-detected from the script content.

## Test Runner Integration

Both runners are invoked with dot + JUnit reporters:
- **Vitest**: `pnpm vitest run --reporter=dot --reporter=junit --outputFile.junit=coverage/junit.xml`
- **Bun**: `bun test --dots --reporter=junit --reporter-outfile=coverage/junit.xml`

Coverage flags (`--coverage` for vitest, `--coverage --coverage-reporter=lcov` for bun) are appended when coverage is enabled.

## Requirements

- Node.js 18+
- Packages must have a `test` script in `package.json`

## Dependencies

- [meow](https://github.com/sindresorhus/meow) — CLI argument parsing
- [picocolors](https://github.com/alexeyraspopov/picocolors) — Terminal colors
- [cli-spinners](https://github.com/sindresorhus/cli-spinners) — Spinner animations
- [chokidar](https://github.com/paulmillr/chokidar) — File watching
- [lilconfig](https://github.com/antonk52/lilconfig) — Config file loading
- [picomatch](https://github.com/micromatch/picomatch) — Glob matching

## License

MIT
