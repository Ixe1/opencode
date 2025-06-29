package dialog

import (
	"context"
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/muesli/reflow/truncate"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

// CheckpointDialog interface for the checkpoint management dialog
type CheckpointDialog interface {
	layout.Modal
}

// CheckpointInfo is an alias for the client checkpoint type
type CheckpointInfo = client.CheckpointInfo

// checkpointItem is a custom list item for checkpoints
type checkpointItem struct {
	checkpoint          CheckpointInfo
	isRestoreConfirming bool
}

func (c checkpointItem) Render(selected bool, width int) string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle()

	var text string
	if c.isRestoreConfirming {
		text = "Press again to confirm restore"
	} else {
		// Format: "2h ago: Editing main.go (15 files)"
		// Time.Created is in milliseconds as float64
		created := time.Unix(int64(c.checkpoint.Time.Created/1000), 0)
		ago := time.Since(created)
		var timeStr string
		if ago < time.Minute {
			timeStr = "just now"
		} else if ago < time.Hour {
			timeStr = fmt.Sprintf("%dm ago", int(ago.Minutes()))
		} else if ago < 24*time.Hour {
			timeStr = fmt.Sprintf("%dh ago", int(ago.Hours()))
		} else {
			timeStr = fmt.Sprintf("%dd ago", int(ago.Hours()/24))
		}

		fileCount := len(c.checkpoint.Files)
		fileStr := "file"
		if fileCount != 1 {
			fileStr = "files"
		}

		text = fmt.Sprintf("%s: %s (%d %s)", timeStr, c.checkpoint.Message, fileCount, fileStr)
	}

	truncatedStr := truncate.StringWithTail(text, uint(width-1), "...")

	var itemStyle styles.Style
	if selected {
		if c.isRestoreConfirming {
			// Yellow background for restore confirmation
			itemStyle = baseStyle.
				Background(t.Warning()).
				Foreground(t.BackgroundElement()).
				Width(width).
				PaddingLeft(1)
		} else {
			// Normal selection
			itemStyle = baseStyle.
				Background(t.Primary()).
				Foreground(t.BackgroundElement()).
				Width(width).
				PaddingLeft(1)
		}
	} else {
		if c.isRestoreConfirming {
			// Yellow text for restore confirmation when not selected
			itemStyle = baseStyle.
				Foreground(t.Warning()).
				PaddingLeft(1)
		} else {
			itemStyle = baseStyle.
				PaddingLeft(1)
		}
	}

	return itemStyle.Render(truncatedStr)
}

type checkpointDialog struct {
	width               int
	height              int
	modal               *modal.Modal
	checkpoints         []CheckpointInfo
	list                list.List[checkpointItem]
	app                 *app.App
	restoreConfirmation int // -1 means no confirmation, >= 0 means confirming restore of checkpoint at this index
}

func (c *checkpointDialog) Init() tea.Cmd {
	return nil
}

func (c *checkpointDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		c.width = msg.Width
		c.height = msg.Height
		c.list.SetMaxWidth(layout.Current.Container.Width - 12)
	case tea.KeyPressMsg:
		switch msg.String() {
		case "enter":
			if len(c.checkpoints) == 0 {
				return c, nil
			}
			_, selectedIndex := c.list.GetSelectedItem()
			if c.restoreConfirmation == selectedIndex {
				// Confirmed restore
				checkpoint := c.checkpoints[selectedIndex]
				return c, tea.Batch(
					util.CmdHandler(modal.CloseModalMsg{}),
					c.restoreCheckpoint(checkpoint),
				)
			} else {
				// First press - show confirmation
				c.restoreConfirmation = selectedIndex
				items := c.createListItems()
				c.list.SetItems(items)
				// Preserve the current selection
				c.list.SetSelectedIndex(selectedIndex)
				return c, nil
			}
		case "esc":
			if c.restoreConfirmation >= 0 {
				// Cancel confirmation
				prevSelection := c.restoreConfirmation
				c.restoreConfirmation = -1
				items := c.createListItems()
				c.list.SetItems(items)
				// Preserve the selection that was being confirmed
				c.list.SetSelectedIndex(prevSelection)
				return c, nil
			}
			return c, util.CmdHandler(modal.CloseModalMsg{})
		case "q":
			return c, util.CmdHandler(modal.CloseModalMsg{})
		}
	}

	// Update list
	updatedList, cmd := c.list.Update(msg)
	c.list = updatedList.(list.List[checkpointItem])

	// Reset confirmation if selection changed
	_, currentIndex := c.list.GetSelectedItem()
	if c.restoreConfirmation >= 0 && currentIndex != c.restoreConfirmation {
		c.restoreConfirmation = -1
		items := c.createListItems()
		c.list.SetItems(items)
		// Keep the current selection
		c.list.SetSelectedIndex(currentIndex)
	}

	return c, cmd
}

func (c *checkpointDialog) View() string {
	return c.list.View()
}

func (c *checkpointDialog) Render(content string) string {
	return c.modal.Render(c.list.View(), content)
}

func (c *checkpointDialog) Close() tea.Cmd {
	return util.CmdHandler(modal.CloseModalMsg{})
}

func (c *checkpointDialog) createListItems() []checkpointItem {
	items := make([]checkpointItem, len(c.checkpoints))
	for i, checkpoint := range c.checkpoints {
		items[i] = checkpointItem{
			checkpoint:          checkpoint,
			isRestoreConfirming: c.restoreConfirmation == i,
		}
	}
	return items
}

func (c *checkpointDialog) restoreCheckpoint(checkpoint CheckpointInfo) tea.Cmd {
	return func() tea.Msg {
		response, err := client.PostCheckpointRestoreWithResponse(
			c.app.Client,
			context.Background(),
			client.PostCheckpointRestoreJSONRequestBody{
				CheckpointID: checkpoint.ID,
			},
		)
		if err != nil {
			return toast.NewErrorToast("Failed to restore checkpoint: " + err.Error())
		}
		if response.StatusCode != 200 {
			return toast.NewErrorToast("Failed to restore checkpoint")
		}

		// Show success message with checkpoint details
		successMsg := fmt.Sprintf("Restored checkpoint: %s", checkpoint.Message)
		return toast.NewSuccessToast(successMsg)
	}
}

// NewCheckpointDialog creates a new checkpoint management dialog
func NewCheckpointDialog(app *app.App) CheckpointDialog {
	// Fetch checkpoints
	response, err := client.PostCheckpointListWithResponse(
		app.Client,
		context.Background(),
		client.PostCheckpointListJSONRequestBody{
			SessionID: &app.Session.ID,
		},
	)

	var checkpoints []CheckpointInfo
	if err == nil && response.StatusCode == 200 && response.JSON200 != nil {
		// Use the checkpoints directly from the response
		checkpoints = *response.JSON200
	}

	modalTitle := "Checkpoints"
	if len(checkpoints) == 0 {
		modalTitle = "No checkpoints found"
	}

	dialog := &checkpointDialog{
		modal: modal.New(
			modal.WithTitle(modalTitle),
			modal.WithMaxWidth(layout.Current.Container.Width-8),
		),
		checkpoints:         checkpoints,
		app:                 app,
		restoreConfirmation: -1,
	}

	items := dialog.createListItems()
	dialog.list = list.NewListComponent(
		items,
		10, // maxVisibleItems
		"No checkpoints available",
		false, // useAlphaNumericKeys
	)
	dialog.list.SetMaxWidth(layout.Current.Container.Width - 12)

	return dialog
}

// Helper function to safely get string from map
func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}
