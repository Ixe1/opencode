# Git Checkpoint and Undo Feature

## Overview

The git checkpoint feature automatically creates git commits before file modifications during a conversation turn, allowing users to easily undo changes using the `/undo` command.

## How It Works

### Automatic Checkpoints

Checkpoints are automatically created when using file-modifying tools:

- **edit**: Before editing files
- **write**: Before creating or overwriting files
- **patch**: Before applying patches
- **bash**: Before running commands that might modify files (detected by patterns)

### Checkpoint Creation

Each checkpoint:

- Creates a git commit with a descriptive message
- Tracks which session and message triggered the changes
- Only creates one checkpoint per message (to avoid duplicates)
- Only works in git repositories

### Undo Functionality

Users can undo the last checkpoint in their session by:

- Using the `/undo` command in the TUI
- Pressing `<leader>u` (default keybinding)

The undo operation:

- Resets to the commit before the checkpoint
- Stashes any uncommitted changes first
- Removes the checkpoint from tracking
- Shows a success message when complete

## Implementation Details

### Components

1. **Checkpoint Service** (`packages/opencode/src/checkpoint/index.ts`)

   - Manages checkpoint creation and tracking
   - Handles git operations for commits and resets
   - Tracks checkpoints per session

2. **Tool Integration**

   - Each file-modifying tool checks for existing checkpoints
   - Creates a checkpoint before making changes
   - Uses descriptive messages for each operation

3. **API Endpoints**

   - `/session_undo`: Undoes the last checkpoint
   - `/session_checkpoints`: Lists checkpoints for a session

4. **TUI Command**
   - `SessionUndoCommand`: Handles the undo operation
   - Available via `/undo` or `<leader>u`

### Limitations

- Only works in git repositories
- Cannot undo if there are no checkpoints
- Checkpoints are cleared when a session is deleted
- File-modifying bash commands are detected by patterns (may miss some)

## Usage Example

1. User asks to modify a file: "Update the config to use port 8080"
2. System automatically creates a checkpoint before editing
3. File is modified
4. User realizes they want to revert: `/undo`
5. System resets to the state before the modification

## Future Enhancements

- Multiple undo levels (undo history)
- Selective undo (choose which checkpoint to revert)
- Checkpoint descriptions in UI
- Manual checkpoint creation
- Checkpoint persistence across sessions
