# Testing Code Review Mode

## Overview

This document describes how to test the new Code Review Mode feature in opencode.

## What's Implemented

### 1. Mode Cycling (Shift+Tab)

- Normal Mode → Planning Mode → Review Mode → Normal Mode
- Status bar shows current mode: [NORMAL], [PLANNING], or [REVIEW]

### 2. Review Mode Features

- Uses a specialized system prompt for code review
- Can review:
  - Uncommitted git changes
  - Specific files or functions
  - Entire directories or modules
  - Code from other branches
- Has access to review-specific tools including:
  - ReviewTool for interactive fixes
  - EditTool for applying fixes
  - BashTool for running git commands
  - All read-only tools (Read, Grep, Glob, etc.)

### 3. Review Tool Actions

The review tool supports these actions:

- `start`: Begin reviewing uncommitted changes
- `fix`: Apply a suggested fix
- `skip`: Skip an issue
- `explain`: Get more details about an issue
- `status`: Check review progress

## Testing Steps

### 1. Basic Mode Cycling

1. Start opencode: `./run-local.sh`
2. Press Shift+Tab to cycle to Planning Mode (status shows [PLANNING])
3. Press Shift+Tab again to cycle to Review Mode (status shows [REVIEW])
4. Press Shift+Tab again to return to Normal Mode (status shows [NORMAL])

### 2. Review Mode Functionality

#### A. Reviewing Uncommitted Changes

1. Make some test changes to a file (introduce obvious issues):

   ```javascript
   // test.js
   const password = "hardcoded123" // Security issue
   const data = await fetch(url).json() // Missing error handling
   ```

2. Start opencode and press Shift+Tab twice to enter Review Mode
3. Say "review my uncommitted changes"
4. The AI should identify issues like:
   - Hardcoded secrets
   - Missing error handling
   - Other code quality issues

#### B. Reviewing Existing Code

1. Enter Review Mode (Shift+Tab twice)
2. Try these commands:
   - "review the file src/utils/auth.js"
   - "review all files in the controllers directory"
   - "review this function for security issues" (after showing a function)
   - "audit the database module for best practices"

#### C. General Code Quality Review

1. Enter Review Mode
2. Ask for broader reviews:
   - "find technical debt in this codebase"
   - "check for deprecated API usage"
   - "review the architecture of the auth system"
   - "find code that needs refactoring"

### 3. Interactive Fixes

When the AI presents issues, you can interact with:

- "fix the security issue" - AI will apply the fix
- "explain why this is a problem" - Get detailed explanation
- "skip this issue" - Move to next issue
- "show review status" - See progress

## Expected Behavior

### In Review Mode:

- Status bar shows [REVIEW] in warning color (yellow/orange)
- AI is ready to review any code you specify
- Can review uncommitted changes, files, directories, or architectural patterns
- Presents issues with severity ratings
- Allows interactive fixing of issues (for uncommitted changes)
- Creates checkpoints before applying fixes
- Provides refactoring suggestions for existing code

### Mode Transitions:

- Smooth cycling between all three modes
- Mode persists in session until changed
- Each mode has appropriate tools available

## Known Limitations

- Review dialog component not implemented (uses chat interface)
- No visual review progress indicator beyond status messages
- Requires uncommitted git changes to review

## Future Enhancements

- Dedicated review dialog UI component
- Batch fix operations
- Custom review rules configuration
- Review history tracking
