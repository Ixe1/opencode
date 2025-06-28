package styles

import "image/color"

type TerminalInfo struct {
	Background       color.Color
	BackgroundIsDark bool
	ForceDarkMode    *bool
}

var Terminal *TerminalInfo

func init() {
	Terminal = &TerminalInfo{
		Background:       color.Black,
		BackgroundIsDark: true,
		ForceDarkMode:    nil,
	}
}

// IsDarkMode returns whether dark mode should be used, taking into account
// both the detected terminal background and any forced setting
func IsDarkMode() bool {
	if Terminal.ForceDarkMode != nil {
		return *Terminal.ForceDarkMode
	}
	return Terminal.BackgroundIsDark
}
