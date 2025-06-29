package tui

import (
	"testing"
)

func TestDetectPlanInMessage(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected bool
	}{
		{
			name: "XML plan with text before",
			content: `I'll create a demo plan to test the functionality.

<plan>
## Plan: Implement Shopping Cart Feature

### Overview
This is a test plan.

Would you like me to proceed with this implementation?
</plan>`,
			expected: true,
		},
		{
			name: "Markdown plan with text before",
			content: `Let me create a plan for you.

## Plan: Implement User Authentication

### Overview
This is a test plan.

Would you like me to proceed with this implementation?`,
			expected: true,
		},
		{
			name: "Plan at beginning of message",
			content: `## Plan: Direct Plan

### Overview
This is a test plan.

Would you like me to proceed with this implementation?`,
			expected: true,
		},
		{
			name: "Missing ending question",
			content: `## Plan: Incomplete Plan

### Overview
This is a test plan without the required ending.`,
			expected: false,
		},
		{
			name: "No plan header",
			content: `This is just a regular message.

Would you like me to proceed with this implementation?`,
			expected: false,
		},
		{
			name: "XML tags without plan header inside",
			content: `<plan>
This is not a proper plan format.

Would you like me to proceed with this implementation?
</plan>`,
			expected: false,
		},
		{
			name: "Case variations of plan header",
			content: `## PLAN: Test Plan

### Overview
Testing case sensitivity.

Would you like me to proceed with this implementation?`,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectPlanInMessage(tt.content)
			if result != tt.expected {
				t.Errorf("detectPlanInMessage() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestExtractPlanContent(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected string
	}{
		{
			name: "Extract from XML tags",
			content: `Some text before the plan.

<plan>
## Plan: Test Plan

### Overview
This is the plan content.

Would you like me to proceed with this implementation?
</plan>

Some text after the plan.`,
			expected: `## Plan: Test Plan

### Overview
This is the plan content.

Would you like me to proceed with this implementation?`,
		},
		{
			name: "Extract markdown plan",
			content: `Some text before.

## Plan: Test Plan

### Overview
This is the plan content.

Would you like me to proceed with this implementation?

Some text after.`,
			expected: `## Plan: Test Plan

### Overview
This is the plan content.

Would you like me to proceed with this implementation?`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractPlanContent(tt.content)
			if result != tt.expected {
				t.Errorf("extractPlanContent() = %q, want %q", result, tt.expected)
			}
		})
	}
}
