package dialog

import (
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/viewport"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/muesli/reflow/wordwrap"

	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// PlanApprovalDialogCmp is a component that shows the plan and asks for approval.
type PlanApprovalDialogCmp struct {
	width, height int
	selected      int
	viewport      viewport.Model
	plan          string
}

// NewPlanApprovalDialogCmp creates a new PlanApprovalDialogCmp.
func NewPlanApprovalDialogCmp(plan string) PlanApprovalDialogCmp {
	// Create viewport with initial size - will be resized on WindowSizeMsg
	vp := viewport.New(
		viewport.WithWidth(80),
		viewport.WithHeight(20),
	)

	// Set the content immediately with wrapping
	// Account for viewport padding (2 on each side) + margin (4) = 8 total
	wrappedContent := wrapContent(plan, 72) // Initial width minus padding and margin
	vp.SetContent(wrappedContent)

	return PlanApprovalDialogCmp{
		selected: 0,
		viewport: vp,
		plan:     plan,
	}
}

// wrapContent wraps the content to fit within the given width
func wrapContent(content string, width int) string {
	lines := strings.Split(content, "\n")
	var wrapped []string

	for _, line := range lines {
		// Preserve empty lines
		if strings.TrimSpace(line) == "" {
			wrapped = append(wrapped, line)
			continue
		}

		// Wrap long lines
		wrappedLine := wordwrap.String(line, width)
		wrapped = append(wrapped, wrappedLine)
	}

	return strings.Join(wrapped, "\n")
}

// Init implements tea.Model.
func (m PlanApprovalDialogCmp) Init() tea.Cmd {
	return nil
}

// Update implements tea.Model.
func (m PlanApprovalDialogCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var (
		cmd  tea.Cmd
		cmds []tea.Cmd
	)

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, key.NewBinding(key.WithKeys("esc"))):
			return m, util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: false, PlanContent: m.plan})
		case key.Matches(msg, key.NewBinding(key.WithKeys("tab", "left", "right", "h", "l"))):
			m.selected = (m.selected + 1) % 2
			return m, nil
		case key.Matches(msg, key.NewBinding(key.WithKeys("enter"))):
			return m, util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: m.selected == 0, PlanContent: m.plan})
		case key.Matches(msg, key.NewBinding(key.WithKeys("y"))):
			return m, util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: true, PlanContent: m.plan})
		case key.Matches(msg, key.NewBinding(key.WithKeys("n"))):
			return m, util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: false, PlanContent: m.plan})
		default:
			// Handle viewport navigation
			m.viewport, cmd = m.viewport.Update(msg)
			cmds = append(cmds, cmd)
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

		// Calculate available space for the dialog
		// Leave some margin for the border and padding
		marginX := 4 // 2 chars on each side
		marginY := 4 // 2 lines on top and bottom for safety

		// Calculate dialog dimensions (85% of screen with max width)
		dialogWidth := int(float64(m.width) * 0.85)
		maxWidth := 140
		if dialogWidth > maxWidth {
			dialogWidth = maxWidth
		}
		if dialogWidth > m.width-marginX {
			dialogWidth = m.width - marginX
		}

		// Calculate viewport size within dialog
		// Account for dialog chrome (title, buttons, borders, padding)
		headerHeight := 4 // Title + divider
		footerHeight := 6 // Question + buttons + padding
		borderHeight := 2 // Top and bottom borders
		paddingX := 6     // Padding inside border (2 + 2 for border + 2 for padding)

		// Calculate maximum safe height for the dialog
		maxDialogHeight := m.height - marginY
		availableHeight := maxDialogHeight - headerHeight - footerHeight - borderHeight

		// Set viewport height with bounds checking
		viewportHeight := availableHeight
		maxViewportHeight := 30 // Maximum reasonable height for readability
		if viewportHeight > maxViewportHeight {
			viewportHeight = maxViewportHeight
		}

		viewportWidth := dialogWidth - paddingX

		// Ensure minimum sizes
		viewportWidth = max(viewportWidth, 40)
		viewportHeight = max(viewportHeight, 5)

		// Update viewport dimensions without losing scroll position
		oldYOffset := m.viewport.YOffset
		m.viewport.SetWidth(viewportWidth)
		m.viewport.SetHeight(viewportHeight)

		// Wrap content to fit viewport width
		// Account for viewport padding (2 on each side) + existing margin (4) = 8 total
		wrappedContent := wrapContent(m.plan, viewportWidth-8) // Account for all padding
		m.viewport.SetContent(wrappedContent)

		// Restore scroll position if it was valid
		if oldYOffset > 0 && oldYOffset < m.viewport.TotalLineCount() {
			m.viewport.SetYOffset(oldYOffset)
		}
	default:
		// Pass other messages to viewport (e.g., mouse events)
		m.viewport, cmd = m.viewport.Update(msg)
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

// View implements tea.Model.
func (m PlanApprovalDialogCmp) View() string {

	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle().
		Foreground(t.Text()).
		Background(t.Background())

	// Title with icon
	viewportWidth := m.viewport.Width()
	titleText := "📋 Implementation Plan"
	title := baseStyle.
		Foreground(t.Primary()).
		Bold(true).
		Width(viewportWidth).
		Align(lipgloss.Center).
		Padding(1, 1).
		Render(titleText)

	// Viewport with plan content - add some padding for readability
	planView := baseStyle.
		Width(viewportWidth).
		MaxWidth(viewportWidth).
		Padding(0, 2).
		Render(m.viewport.View())

	// Scroll indicator
	scrollInfo := ""
	if m.viewport.TotalLineCount() > m.viewport.Height() {
		scrollPercent := float32(m.viewport.ScrollPercent())
		if scrollPercent > 0 && scrollPercent < 1 {
			scrollInfo = baseStyle.
				Foreground(t.TextMuted()).
				Italic(true).
				Render("↑↓ to scroll")
		} else if scrollPercent == 0 {
			scrollInfo = baseStyle.
				Foreground(t.TextMuted()).
				Italic(true).
				Render("↓ to scroll")
		} else {
			scrollInfo = baseStyle.
				Foreground(t.TextMuted()).
				Italic(true).
				Render("↑ to scroll")
		}
	}

	// Question with emphasis
	question := baseStyle.
		Foreground(t.Text()).
		Width(viewportWidth).
		Align(lipgloss.Center).
		Padding(1, 1).
		Bold(true).
		Render("Do you approve this plan?")

	// Buttons with better styling
	yesStyle := baseStyle.Padding(0, 4)
	noStyle := baseStyle.Padding(0, 4)

	if m.selected == 0 {
		yesStyle = yesStyle.
			Background(t.Success()).
			Foreground(t.Background()).
			Bold(true)
		noStyle = noStyle.
			Background(t.BackgroundElement()).
			Foreground(t.Text())
	} else {
		noStyle = noStyle.
			Background(t.Error()).
			Foreground(t.Background()).
			Bold(true)
		yesStyle = yesStyle.
			Background(t.BackgroundElement()).
			Foreground(t.Text())
	}

	yes := yesStyle.Render("✓ Approve")
	no := noStyle.Render("✗ Reject")

	buttons := lipgloss.JoinHorizontal(lipgloss.Center, yes, baseStyle.Render("  "), no)
	buttons = baseStyle.
		Width(viewportWidth).
		Align(lipgloss.Center).
		Padding(0, 0).
		Render(buttons)

	// Keyboard shortcuts hint
	shortcuts := baseStyle.
		Foreground(t.TextMuted()).
		Width(viewportWidth).
		Align(lipgloss.Center).
		Render("Press Y to approve, N to reject, or use arrow keys and Enter")

	// Divider
	divider := strings.Repeat("─", viewportWidth)
	dividerStyle := baseStyle.Foreground(t.TextMuted())

	// Assemble content
	sections := []string{
		title,
		dividerStyle.Render(divider),
		planView,
	}

	if scrollInfo != "" {
		sections = append(sections, baseStyle.Align(lipgloss.Center).Width(viewportWidth).Render(scrollInfo))
	}

	sections = append(sections,
		dividerStyle.Render(divider),
		question,
		buttons,
		shortcuts,
		baseStyle.Width(viewportWidth).Render(""),
	)

	content := lipgloss.JoinVertical(lipgloss.Left, sections...)

	// Use a double border for emphasis
	return baseStyle.
		Background(t.Background()).
		Padding(1, 2).
		Border(lipgloss.DoubleBorder()).
		BorderBackground(t.Background()).
		BorderForeground(t.Primary()).
		Width(viewportWidth + 6).
		Render(content)
}

// SetSize sets the size of the component.
func (m *PlanApprovalDialogCmp) SetSize(width, height int) {
	m.width = width
	m.height = height
}

// Render renders the dialog on top of the background.
func (m PlanApprovalDialogCmp) Render(background string) string {
	t := theme.CurrentTheme()

	// Get the dialog view
	dialogView := m.View()

	// Create overlay with the background dimmed
	dimmedBg := styles.NewStyle().
		Width(m.width).
		Height(m.height).
		Background(t.Background()).
		Foreground(t.TextMuted()).
		Render(background)

	// Calculate position for centering
	bgHeight := lipgloss.Height(dimmedBg)
	bgWidth := lipgloss.Width(dimmedBg)
	dialogHeight := lipgloss.Height(dialogView)
	dialogWidth := lipgloss.Width(dialogView)

	// Calculate centered position
	row := (bgHeight - dialogHeight) / 2
	col := (bgWidth - dialogWidth) / 2

	// Ensure we don't go negative or exceed bounds
	if row < 0 {
		row = 0
	}
	if col < 0 {
		col = 0
	}

	// Ensure dialog fits within terminal with margin
	marginTop := 2
	marginBottom := 2
	if row < marginTop {
		row = marginTop
	}
	if row+dialogHeight > bgHeight-marginBottom {
		row = max(marginTop, bgHeight-dialogHeight-marginBottom)
	}

	// Place the dialog centered on the dimmed background
	return layout.PlaceOverlay(col, row, dialogView, dimmedBg)
}

// Close returns a command to close the dialog.
func (m PlanApprovalDialogCmp) Close() tea.Cmd {
	return util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: false, PlanContent: m.plan})
}

// IsPlanApprovalDialog returns true if this is a plan approval dialog.
func (m PlanApprovalDialogCmp) IsPlanApprovalDialog() bool {
	return true
}

// ClosePlanApprovalDialogMsg is sent when the plan approval dialog is closed.
type ClosePlanApprovalDialogMsg struct {
	Approved    bool
	PlanContent string
}

// ShowPlanApprovalDialogMsg is sent to show the plan approval dialog.
type ShowPlanApprovalDialogMsg struct {
	Plan string
}
