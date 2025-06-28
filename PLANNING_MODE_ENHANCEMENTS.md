# Planning Mode Enhancements

## Overview
This document describes the enhancements made to the planning mode to provide interactive approval dialogs and clarification question flows.

## Changes Made

### 1. Planning Prompt Updates
- **File**: `packages/opencode/src/session/prompt/plan.txt`
- Added clarification flow guidelines
- AI now asks clarification questions one at a time
- Plans must end with "Would you like me to proceed with this implementation?"

### 2. Message Metadata Enhancement
- **File**: `packages/opencode/src/session/message.ts`
- Added `planDetected` boolean field to track messages containing plans
- Added `clarificationQuestion` boolean field to identify clarification questions

### 3. Plan Detection Logic
- **File**: `packages/opencode/src/session/index.ts`
- Added `detectPlan()` function to identify plan messages
- Added `detectClarificationQuestion()` function to identify clarification questions
- Modified `updateMessage()` to automatically detect and mark plans/clarifications

### 4. Plan Approval Endpoint
- **File**: `packages/opencode/src/server/server.ts`
- Added `/session_approve_plan` endpoint
- Handles mode switching from planning to normal
- Automatically sends approval message to AI

### 5. TUI Plan Detection and Dialog
- **File**: `packages/tui/internal/tui/tui.go`
- Added automatic plan detection in message updates
- Shows PlanApprovalDialog when plan is detected
- Handles approval/rejection flow

### 6. Enhanced Message Display
- **File**: `packages/tui/internal/components/chat/message.go`
- Clarification questions are displayed with warning color border
- Visual distinction for different message types

## How It Works

### Plan Flow
1. User enters planning mode
2. AI analyzes request and asks clarification questions if needed
3. AI researches and creates a plan
4. Plan is automatically detected and approval dialog appears
5. On approval:
   - Session switches to normal mode
   - Automatic "proceed" message is sent
   - AI begins implementation
6. On rejection:
   - Session stays in planning mode
   - User can provide feedback

### Clarification Flow
1. AI detects ambiguities in user request
2. Asks one clarification question at a time
3. Waits for user response before asking next question
4. Questions are visually highlighted with warning color

## Testing
To test the new features:
1. Start a new session in planning mode
2. Make a request with some ambiguity
3. Observe clarification questions
4. Once plan is presented, test approval/rejection flow