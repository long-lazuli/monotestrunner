# monotestrunner

A parallel test runner for monorepos with an interactive terminal UI. Runs tests across multiple packages simultaneously and displays real-time results in a beautiful summary table.

## Features

- **Parallel Execution** - Runs tests across all packages concurrently
- **Real-time Updates** - Live progress with dot reporters and spinners
- **Interactive Mode** - Navigate packages, rerun tests, toggle watch mode
- **File Watching** - Auto-rerun tests on file changes with custom path mappings
- **Multi-Runner Support** - Works with both Vitest and Bun test runners
- **CI-Friendly** - Detects CI environment and adjusts output accordingly

## Installation

```bash
npm install monotestrunner
```

## Usage

```bash
# Run all tests once
monotestrunner

# Interactive mode with keyboard navigation
monotestrunner -i

# Interactive mode with file watching
monotestrunner -w

# Show verbose output for failed tests
monotestrunner -v
```

## Options

| Flag | Description |
|------|-------------|
| `-i, --interactive` | Interactive mode with keyboard navigation |
| `-w, --watch` | Interactive mode with file watching (implies `-i`) |
| `-v, --verbose` | Show detailed output for failed tests |

## Interactive Mode

In interactive mode, use these keyboard shortcuts:

| Key | Action |
|-----|--------|
| `↑/k` | Move selection up |
| `↓/j` | Move selection down |
| `r` / `Enter` | Rerun selected package |
| `a` | Rerun all packages |
| `w` | Toggle watch mode |
| `h` | Show help |
| `q` | Quit |

## Configuration

Create a `.monotestrunnerrc.json` (or any format supported by [lilconfig](https://github.com/antonk52/lilconfig)) in your workspace root:

```json
{
  "watchMappings": [
    {
      "paths": ["shared/utils/**/*.ts"],
      "triggers": ["package-a", "package-b"]
    },
    {
      "paths": ["config/**/*"],
      "triggers": "*"
    }
  ]
}
```

### Watch Mappings

Watch mappings let you define custom file-to-package relationships for the watcher:

- **`paths`** - Array of glob patterns to watch
- **`triggers`** - Array of package names to rerun when matched, or `"*"` for all packages

## Project Structure

monotestrunner expects a standard monorepo structure:

```
your-monorepo/
  packages/
    package-a/
      package.json  (with "test" script)
      src/
      test/
    package-b/
      ...
  plugins/
    ...
  apps/
    ...
```

It automatically discovers packages in `packages/`, `plugins/`, and `apps/` directories that have a `test` script in their `package.json`.

## Test Runner Detection

The runner is auto-detected from your test script:
- Scripts containing `vitest` use the Vitest dot reporter
- Other scripts use Bun's dots reporter

## Requirements

- Node.js 18+
- Packages must have a `test` script in `package.json`
- Tests must support dot reporter output (`vitest --reporter=dot` or `bun test --dots`)

## Dependencies

- [meow](https://github.com/sindresorhus/meow) - CLI argument parsing
- [picocolors](https://github.com/alexeyraspopov/picocolors) - Terminal colors
- [cli-spinners](https://github.com/sindresorhus/cli-spinners) - Spinner animations
- [chokidar](https://github.com/paulmillr/chokidar) - File watching
- [lilconfig](https://github.com/antonk52/lilconfig) - Config file loading
- [picomatch](https://github.com/micromatch/picomatch) - Glob matching

## License

MIT
