package client

import (
	"github.com/sst/opencode-sdk-go"
)

// ExtendedSession extends the SDK Session with additional fields
type ExtendedSession struct {
	*opencode.Session
	Mode string `json:"mode"`
}

// ConvertToExtendedSession converts an SDK session to extended session
func ConvertToExtendedSession(session *opencode.Session) *ExtendedSession {
	if session == nil {
		return nil
	}
	return &ExtendedSession{
		Session: session,
		Mode:    "normal", // default mode
	}
}

// UpdateSessionWithMode updates the session with mode from event data
func UpdateSessionWithMode(session *opencode.Session, mode string) *ExtendedSession {
	return &ExtendedSession{
		Session: session,
		Mode:    mode,
	}
}