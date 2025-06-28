# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- **Run opencode locally (easy way)**: `./run-local.sh` or `opencode-local` (after sourcing bashrc)
- **Run backend only**: `bun run packages/opencode/src/index.ts`
- **Run with dev mode**: `cd packages/opencode && bun run dev`
- **Install dependencies**: `bun install`
- **Typecheck all packages**: `bun run typecheck`
- **Generate Go client after API changes**: `cd packages/tui && go generate ./pkg/client/`

### Building

- **Build Go TUI binary**: `cd packages/tui && go build -o ../../opencode ./cmd/opencode`
- **Build web documentation**: `cd packages/web && bun run build`
- **Install script**: `./install` - Downloads and installs the latest release
- **Full local build process**:
  1. `bun install` - Install all dependencies
  2. `bun run typecheck` - Verify TypeScript types
  3. `cd packages/tui && go build -o ../../opencode ./cmd/opencode` - Build the TUI binary
  4. `./run-local.sh` - Run the locally built version

## Architecture

### Overview

opencode is a monorepo with a client-server architecture consisting of:

1. **TypeScript Backend** (`packages/opencode/`): Core server that handles AI interactions, tools, and session management
2. **Go TUI** (`packages/tui/`): Terminal UI client built with Bubble Tea framework
3. **Web Documentation** (`packages/web/`): Astro-based documentation site
4. **Serverless Function** (`packages/function/`): API endpoints for sharing functionality

### Core Components

**Server Architecture** (`packages/opencode/src/server/server.ts`):

- RESTful API with SSE for real-time events
- Session management for AI interactions
- Provider abstraction for multiple AI models (Anthropic, OpenAI, etc.)

**Tool System** (`packages/opencode/src/tool/`):

- Each tool (bash, edit, read, etc.) implements the `Tool.Info` interface
- Tools have parameters validated by Zod schemas
- Tools execute with session context and abort signals

**Session Management** (`packages/opencode/src/session/`):

- Handles conversation state and message history
- Integrates with AI providers through standardized interface
- Supports system prompts and tool execution

**TUI Client** (`packages/tui/`):

- Communicates with backend via generated Go client
- Real-time updates via SSE
- Theme system with multiple built-in themes

### Key Dependencies

- **Bun**: Runtime and package manager
- **SST v3**: Infrastructure and deployment
- **Hono**: Web framework for the server
- **Zod**: Schema validation
- **AI SDK**: Standardized AI provider interface
- **Bubble Tea**: TUI framework for Go

## Development Notes

When modifying the TypeScript API:

1. Make changes to endpoints in `packages/opencode/src/server/server.ts`
2. Run `cd packages/tui && go generate ./pkg/client/` to regenerate the Go client
3. This updates the OpenAPI spec and Go client code used by the TUI

The project uses a workspace structure with shared dependencies managed through Bun's catalog feature. Check the root `package.json` for shared version constraints.

## Built-in Commands

opencode supports special commands that are processed directly without being sent to the AI:

- **/stats**: Display session statistics including:
  - Token consumption (input/output/cache read/write)
  - Total cost and cost breakdowns
  - Message counts by role
  - Tool usage statistics
  - Session duration and timestamps
  - Model and provider information

Commands are detected in `packages/opencode/src/session/index.ts` in the `chat` function.
