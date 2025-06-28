#!/bin/bash

# OpenCode Local Development Runner
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: bun is not installed${NC}"
    echo "Install bun with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check if go is installed
if ! command -v go &> /dev/null; then
    echo -e "${RED}Error: go is not installed${NC}"
    exit 1
fi

# Save current directory
CURRENT_DIR="$(pwd)"

# Change to the project directory temporarily for dependency check
cd "$SCRIPT_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing dependencies...${NC}"
    bun install
fi

# Return to the original directory
cd "$CURRENT_DIR"

# Start opencode directly (it handles both server and TUI internally)
echo -e "${GREEN}Starting opencode...${NC}"
echo -e "${BLUE}Press Ctrl+C to exit${NC}"
echo -e "${BLUE}Press Shift+Tab to toggle planning mode${NC}"
echo ""

# Run opencode directly - it starts both server and TUI internally
# Use absolute path to run from current directory
exec bun run "$SCRIPT_DIR/packages/opencode/src/index.ts" "$@"