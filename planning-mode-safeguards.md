# Planning Mode Safeguards

## Overview

Added runtime safeguards to all write/modify tools to prevent their use in planning mode. This provides a safety net beyond just relying on AI prompt instructions.

## Implementation

### 1. WriteTool (`write.ts`)

```typescript
// Check if we're in planning mode
const session = await Session.get(ctx.sessionID)
if (session.mode === "planning") {
  throw new Error(
    "Cannot write files in planning mode. Please present your plan first and wait for approval before making any file changes.",
  )
}
```

### 2. EditTool (`edit.ts`)

```typescript
// Check if we're in planning mode
const session = await Session.get(ctx.sessionID)
if (session.mode === "planning") {
  throw new Error(
    "Cannot edit files in planning mode. Please present your plan first and wait for approval before making any file changes.",
  )
}
```

### 3. BashTool (`bash.ts`)

More sophisticated check - allows read-only commands in planning mode:

```typescript
// Check if we're in planning mode
const session = await Session.get(ctx.sessionID)
if (session.mode === "planning") {
  // Allow read-only commands in planning mode
  const readOnlyCommands = [
    "ls",
    "find",
    "grep",
    "cat",
    "head",
    "tail",
    "wc",
    "du",
    "df",
    "git status",
    "git log",
    "git diff",
    "git branch",
    "git remote",
    "pwd",
    "whoami",
    "date",
    "echo",
    "which",
    "type",
    "file",
    "npm list",
    "yarn list",
    "pip list",
    "gem list",
    "node --version",
    "python --version",
    "ruby --version",
  ]

  const isReadOnly = readOnlyCommands.some(
    (cmd) => params.command.startsWith(cmd) || params.command === cmd,
  )

  if (!isReadOnly) {
    throw new Error(
      "Cannot execute write/modify commands in planning mode. Only read-only commands are allowed. Please present your plan first and wait for approval before making any system changes.",
    )
  }
}
```

### 4. PatchTool (`patch.ts`)

```typescript
// Check if we're in planning mode
const session = await Session.get(ctx.sessionID)
if (session.mode === "planning") {
  throw new Error(
    "Cannot apply patches in planning mode. Please present your plan first and wait for approval before making any file changes.",
  )
}
```

## Benefits

1. **Defense in Depth**: Even if the AI misunderstands or ignores prompt instructions, the tools will refuse to execute
2. **Clear Error Messages**: When a tool is blocked, the AI receives a clear explanation of why and what to do
3. **Flexible Bash Commands**: The bash tool intelligently allows read-only commands for research while blocking write operations
4. **Consistent Behavior**: All write/modify tools follow the same pattern

## Testing

To test these safeguards:

1. Enter planning mode (Shift+Tab)
2. Try to use any write tool: `write test.txt with "hello"`
3. Observe the error: "Cannot write files in planning mode..."
4. Try a read-only bash command: `ls` (should work)
5. Try a write bash command: `touch test.txt` (should fail)

## Future Considerations

- Could extend the read-only command list in BashTool based on usage patterns
- Could add similar safeguards for other modes (e.g., certain tools only in review mode)
- Could make the safeguard behavior configurable via settings
