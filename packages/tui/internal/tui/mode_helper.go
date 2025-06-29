package tui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"log/slog"
)

// SessionMode represents the current mode of a session
type SessionMode string

const (
	ModeNormal   SessionMode = "normal"
	ModePlanning SessionMode = "planning"
	ModeReview   SessionMode = "review"
)

// sessionModeTracker keeps track of session modes locally
// This is a workaround until the SDK is updated
var sessionModeTracker = make(map[string]SessionMode)

// getCurrentMode gets the current mode for a session
func getCurrentMode(sessionID string) SessionMode {
	if mode, ok := sessionModeTracker[sessionID]; ok {
		return mode
	}
	return ModeNormal
}

// setLocalMode updates the local mode tracker without making an HTTP call
func setLocalMode(sessionID string, mode SessionMode) {
	sessionModeTracker[sessionID] = mode
}

// setSessionMode makes a direct HTTP call to set the session mode
func setSessionMode(ctx context.Context, sessionID string, newMode SessionMode) error {
	serverURL := os.Getenv("OPENCODE_SERVER")
	if serverURL == "" {
		return fmt.Errorf("OPENCODE_SERVER environment variable not set")
	}

	// Ensure URL ends with /
	if !strings.HasSuffix(serverURL, "/") {
		serverURL += "/"
	}

	// Create request body
	reqBody := map[string]string{
		"sessionID": sessionID,
		"mode":      string(newMode),
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request body: %w", err)
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, "POST", serverURL+"session_set_mode", bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// Send request
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
	}

	// Update local tracker
	sessionModeTracker[sessionID] = newMode
	slog.Debug("Session mode updated", "sessionID", sessionID, "mode", newMode)

	return nil
}

// cycleSessionMode cycles through the modes: normal -> planning -> review -> normal
func cycleSessionMode(currentMode SessionMode) SessionMode {
	switch currentMode {
	case ModeNormal:
		return ModePlanning
	case ModePlanning:
		return ModeReview
	case ModeReview:
		return ModeNormal
	default:
		return ModeNormal
	}
}

// updateModeFromEvent updates the local mode tracker when a mode change event is received
func updateModeFromEvent(sessionID string, mode string) {
	switch mode {
	case "normal":
		sessionModeTracker[sessionID] = ModeNormal
	case "planning":
		sessionModeTracker[sessionID] = ModePlanning
	case "review":
		sessionModeTracker[sessionID] = ModeReview
	default:
		sessionModeTracker[sessionID] = ModeNormal
	}
}

// approvePlan makes a direct HTTP call to approve a plan
func approvePlan(ctx context.Context, sessionID string, planContent string) error {
	serverURL := os.Getenv("OPENCODE_SERVER")
	if serverURL == "" {
		return fmt.Errorf("OPENCODE_SERVER environment variable not set")
	}

	// Ensure URL ends with /
	if !strings.HasSuffix(serverURL, "/") {
		serverURL += "/"
	}

	// Create request body
	reqBody := map[string]string{
		"sessionID":   sessionID,
		"planContent": planContent,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request body: %w", err)
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, "POST", serverURL+"session_approve_plan", bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// Send request
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
	}

	slog.Debug("Plan approved", "sessionID", sessionID)

	return nil
}

// detectPlanInMessage checks if a message contains a plan
// This is a workaround until the SDK provides PlanDetected metadata
func detectPlanInMessage(content string) bool {
	// Check for the required plan format:
	// 1. Must contain "## Plan:" header (can be anywhere in the message)
	// 2. Must end with "Would you like me to proceed with this implementation?"
	// Note: XML tags alone are not sufficient - the plan header must still be present

	// Check for plan header (case insensitive for the word "plan", multiline mode)
	planHeaderRegex := regexp.MustCompile(`(?im)^#{2}\s+Plan:`)
	if !planHeaderRegex.MatchString(content) {
		return false
	}

	// Check for the required ending
	requiredEnding := "Would you like me to proceed with this implementation?"
	return strings.Contains(content, requiredEnding)
}

// extractPlanContent extracts just the plan portion from a message
func extractPlanContent(content string) string {
	// Check if content has XML plan tags
	if strings.Contains(content, "<plan>") && strings.Contains(content, "</plan>") {
		// Extract content between <plan> and </plan> tags
		startIdx := strings.Index(content, "<plan>")
		endIdx := strings.Index(content, "</plan>")
		if startIdx != -1 && endIdx != -1 && endIdx > startIdx {
			// Extract content between tags (excluding the tags themselves)
			planContent := content[startIdx+6 : endIdx]
			return strings.TrimSpace(planContent)
		}
	}

	// Otherwise, look for markdown format (## Plan:)
	planHeaderRegex := regexp.MustCompile(`(?im)^(#{2}\s+Plan:.*)`)
	headerMatch := planHeaderRegex.FindStringIndex(content)
	if headerMatch == nil {
		return content // Return full content if no plan header found
	}

	// Extract from the plan header to the end
	planContent := content[headerMatch[0]:]

	// Find the ending question
	endingIdx := strings.LastIndex(planContent, "Would you like me to proceed with this implementation?")
	if endingIdx != -1 {
		// Include the question in the extracted content
		planContent = planContent[:endingIdx+len("Would you like me to proceed with this implementation?")]
	}

	return strings.TrimSpace(planContent)
}
