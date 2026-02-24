package tui

import (
	"fmt"
	"strings"
)

func renderApplyView(m model) string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("Apply Configuration"))
	b.WriteString("\n\n")

	if m.applyErr != nil {
		b.WriteString(errorStyle.Render(fmt.Sprintf("  Error: %s", m.applyErr)))
		b.WriteString("\n\n")
		b.WriteString(helpStyle.Render("  Press q to quit"))
		b.WriteString("\n")
		return b.String()
	}

	if m.applied {
		b.WriteString(successStyle.Render("  ✓ agent-compose.yaml updated successfully"))
		b.WriteString("\n\n")

		if len(m.toEnable) > 0 {
			b.WriteString(fmt.Sprintf("  Enabled:  %s\n", strings.Join(m.toEnable, ", ")))
		}
		if len(m.toDisable) > 0 {
			b.WriteString(fmt.Sprintf("  Disabled: %s\n", strings.Join(m.toDisable, ", ")))
		}

		b.WriteString("\n")
		b.WriteString(helpStyle.Render("  Press q or enter to quit"))
		b.WriteString("\n")
		return b.String()
	}

	// Preview
	b.WriteString("  Changes to apply:\n\n")
	if len(m.toEnable) > 0 {
		b.WriteString(successStyle.Render(fmt.Sprintf("  + Enable:  %s", strings.Join(m.toEnable, ", "))))
		b.WriteString("\n")
	}
	if len(m.toDisable) > 0 {
		b.WriteString(statusUnavail.Render(fmt.Sprintf("  - Disable: %s", strings.Join(m.toDisable, ", "))))
		b.WriteString("\n")
	}
	if len(m.toEnable) == 0 && len(m.toDisable) == 0 {
		b.WriteString(dimStyle.Render("  No changes"))
		b.WriteString("\n")
	}

	b.WriteString("\n")
	b.WriteString(helpStyle.Render("  enter=confirm  q=cancel"))
	b.WriteString("\n")

	return b.String()
}
