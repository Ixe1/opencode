package dialog

import (
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/viewport"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"

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
	// Create viewport with initial size
	vp := viewport.New(
		viewport.WithWidth(100),
		viewport.WithHeight(20),
	)
	
	// Set the content immediately
	vp.SetContent(plan)
	
	return PlanApprovalDialogCmp{
		selected: 0,
		viewport: vp,
		plan:     plan,
	}
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
			return m, util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: false})
		case key.Matches(msg, key.NewBinding(key.WithKeys("tab", "left", "right", "h", "l"))):
			m.selected = (m.selected + 1) % 2
			return m, nil
		case key.Matches(msg, key.NewBinding(key.WithKeys("enter"))):
			return m, util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: m.selected == 0})
		case key.Matches(msg, key.NewBinding(key.WithKeys("y"))):
			return m, util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: true})
		case key.Matches(msg, key.NewBinding(key.WithKeys("n"))):
			return m, util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: false})
		default:
			// Handle viewport navigation
			m.viewport, cmd = m.viewport.Update(msg)
			cmds = append(cmds, cmd)
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		
		// Update viewport size
		headerHeight := 4
		footerHeight := 6
		borderHeight := 2
		maxHeight := m.height - headerHeight - footerHeight - borderHeight
		
		viewportWidth := 100
		if m.width-8 < viewportWidth {
			viewportWidth = m.width - 8
		}
		viewportHeight := 20
		if maxHeight < viewportHeight {
			viewportHeight = maxHeight
		}
		// Ensure minimum height
		if viewportHeight < 5 {
			viewportHeight = 5
		}
		
		m.viewport = viewport.New(
			viewport.WithWidth(viewportWidth),
			viewport.WithHeight(viewportHeight),
		)
		m.viewport.SetContent(m.plan)
	}

	return m, tea.Batch(cmds...)
}

// View implements tea.Model.
func (m PlanApprovalDialogCmp) View() string {

	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle().Foreground(t.Text())

	// Title
	viewportWidth := m.viewport.Width()
	title := baseStyle.
		Foreground(t.Primary()).
		Bold(true).
		Width(viewportWidth).
		Align(lipgloss.Center).
		Padding(0, 1).
		Render("Plan Approval")

	// Viewport with plan content
	planView := m.viewport.View()
	
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

	// Question
	question := baseStyle.
		Foreground(t.Text()).
		Width(viewportWidth).
		Align(lipgloss.Center).
		Padding(1, 1).
		Render("Do you approve this plan?")

	// Buttons
	yesStyle := baseStyle
	noStyle := baseStyle

	if m.selected == 0 {
		yesStyle = yesStyle.
			Background(t.Primary()).
			Foreground(t.Background()).
			Bold(true)
		noStyle = noStyle.
			Background(t.Background()).
			Foreground(t.Primary())
	} else {
		noStyle = noStyle.
			Background(t.Primary()).
			Foreground(t.Background()).
			Bold(true)
		yesStyle = yesStyle.
			Background(t.Background()).
			Foreground(t.Primary())
	}

	yes := yesStyle.Padding(0, 3).Render("Yes")
	no := noStyle.Padding(0, 3).Render("No")

	buttons := lipgloss.JoinHorizontal(lipgloss.Center, yes, baseStyle.Render("  "), no)
	buttons = baseStyle.
		Width(viewportWidth).
		Align(lipgloss.Center).
		Padding(0, 0).
		Render(buttons)

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
		baseStyle.Width(viewportWidth).Render(""),
	)

	content := lipgloss.JoinVertical(lipgloss.Left, sections...)

	return baseStyle.
		Padding(1, 2).
		Border(lipgloss.RoundedBorder()).
		BorderBackground(t.Background()).
		BorderForeground(t.TextMuted()).
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
	
	// Create a semi-transparent overlay
	overlay := styles.NewStyle().
		Width(m.width).
		Height(m.height).
		Background(t.Background()).
		Render("")
	
	// Get the dialog view
	dialogView := m.View()
	
	// Center the dialog
	dialogWidth := lipgloss.Width(dialogView)
	dialogHeight := lipgloss.Height(dialogView)
	x := (m.width - dialogWidth) / 2
	y := (m.height - dialogHeight) / 2
	
	// Place the dialog on the overlay
	result := lipgloss.Place(m.width, m.height, lipgloss.Left, lipgloss.Top, overlay)
	result = layout.PlaceOverlay(x, y, dialogView, result)
	
	return result
}

// Close returns a command to close the dialog.
func (m PlanApprovalDialogCmp) Close() tea.Cmd {
	return util.CmdHandler(ClosePlanApprovalDialogMsg{Approved: false})
}

// ClosePlanApprovalDialogMsg is sent when the plan approval dialog is closed.
type ClosePlanApprovalDialogMsg struct {
	Approved bool
}

// ShowPlanApprovalDialogMsg is sent to show the plan approval dialog.
type ShowPlanApprovalDialogMsg struct {
	Plan string
}