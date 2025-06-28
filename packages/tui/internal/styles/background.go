package styles

import "image/color"

type TerminalInfo struct {
	Background       color.Color
	BackgroundIsDark bool
	ForceDarkMode    *bool
}

var Terminal *TerminalInfo

func init() {
	darkMode := true
	Terminal = &TerminalInfo{
		Background:       color.Black,
		BackgroundIsDark: true,
		ForceDarkMode:    &darkMode,
	}
}

// IsDarkMode returns whether dark mode should be used
// Always returns true to force dark mode
func IsDarkMode() bool {
	return true
}
