# AGENTS.md

## Build/Test Commands

- **Install dependencies**: `bun install`
- **Build Go TUI binary**: `cd packages/tui && go build -o ../../opencode ./cmd/opencode`
- **Build web docs**: `cd packages/web && bun run build`
- **Typecheck all packages**: `bun run typecheck`
- **Run all tests**: `bun test`
- **Run single test file**: `bun test path/to/test.ts`
- **Run tests matching pattern**: `bun test -t "pattern"`
- **Format code**: `bun run prettier --write <file>`
- **Run locally**: `./run-local.sh` or `bun run packages/opencode/src/index.ts`

## Code Style Guidelines

- **Runtime**: Bun (TypeScript with ESM modules)
- **Imports**: Use named exports/imports, organize by: external deps, internal modules, relative files
- **Formatting**: Prettier with `semi: false` (no semicolons)
- **Types**: Strict TypeScript, use Zod for runtime validation
- **Naming**: PascalCase for namespaces/types, camelCase for functions/variables
- **Architecture**: Namespace-based modules (e.g., `export namespace Tool { ... }`)
- **Error Handling**: Use custom NamedError types with Zod schemas
- **State Management**: Use `App.state()` for singleton state
- **Logging**: Use `Log.create({ service: "name" })` for service-specific logging
- **Testing**: Bun test with describe/test blocks, use App.provide for context
