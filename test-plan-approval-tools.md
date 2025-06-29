# Testing Plan Approval Tool Availability Issue

## The Problem

When in planning mode and a plan is approved:

1. The AI uses `PlanApprovedTool` which switches the session to normal mode
2. However, the current response still has planning mode tools (read-only)
3. If the AI tries to use `write`, `edit`, or `bash` tools, it gets an error
4. These tools only become available in the next response

## Root Cause

The tool context is set at the beginning of each AI response based on the session mode at that time. Even though `PlanApprovedTool` changes the session mode mid-response, the available tools don't update until the next response.

## Solution

The `PlanApprovedTool` now explicitly warns the AI:

- NOT to use implementation tools in the current response
- To use TodoWrite to prepare implementation steps
- To wait for the user to send another message before starting implementation

## Testing Steps

1. Start opencode
2. Enter planning mode (Shift+Tab)
3. Ask to implement something: "Create a new file called test.js with a hello world function"
4. When the AI presents a plan, approve it: "yes, looks good"
5. Observe that the AI:
   - Uses PlanApprovedTool
   - Does NOT try to use write/edit/bash tools
   - Uses TodoWrite to prepare steps
   - Asks the user to send a message to start implementation
6. Send "go ahead" or "start"
7. Now the AI has access to all tools and can implement

## Expected Behavior

### Before Fix

- AI tries to use `write` tool after plan approval
- Gets error: "Tool not found" or similar
- User confused why implementation fails

### After Fix

- AI acknowledges plan approval
- AI prepares todo list
- AI explicitly asks user to send a message to start
- No tool errors
- Clear workflow for the user

## Code Flow

```
Planning Mode Response:
- Available tools: read, grep, glob, ls, todo, planapproved
- User approves plan
- AI uses PlanApprovedTool (switches mode to normal)
- AI still has planning mode tools for rest of response
- AI must NOT use write/edit/bash

Next Response (Normal Mode):
- Available tools: ALL tools including write, edit, bash
- AI can now implement the plan
```

This is a limitation of the AI SDK's streamText function - tools are determined once per response and cannot be changed mid-stream.
