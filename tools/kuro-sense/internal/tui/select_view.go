package tui

import (
	"fmt"
	"strings"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/registry"
)

func renderSelectView(m model) string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("Select Perception Plugins"))
	b.WriteString("\n")
	b.WriteString(subtitleStyle.Render("  space=toggle  ↑↓=navigate  enter=apply  q=quit"))
	b.WriteString("\n\n")

	categories := []registry.Category{
		registry.CategoryWorkspace,
		registry.CategoryChrome,
		registry.CategoryTelegram,
		registry.CategoryHeartbeat,
	}
	categoryNames := map[registry.Category]string{
		registry.CategoryWorkspace: "Workspace",
		registry.CategoryChrome:    "Chrome",
		registry.CategoryTelegram:  "Telegram",
		registry.CategoryHeartbeat: "Heartbeat",
	}

	idx := 0
	for _, cat := range categories {
		b.WriteString(dimStyle.Render(fmt.Sprintf("  ── %s ──", categoryNames[cat])))
		b.WriteString("\n")

		for _, r := range m.results.Capabilities {
			if r.Capability.Category != cat {
				continue
			}

			cursor := "  "
			if idx == m.cursor {
				cursor = "> "
			}

			checked := " "
			if m.selected[r.Capability.Name] {
				checked = "x"
			}

			icon := statusIcon(r)
			name := r.Capability.Name
			desc := r.Capability.Description

			line := fmt.Sprintf("%s[%s] %s %-20s %s", cursor, checked, icon, name, desc)

			if !r.Available {
				missing := missingNames(r.MissingDeps)
				line += dimStyle.Render(fmt.Sprintf(" (need: %s)", strings.Join(missing, ", ")))
			}

			if idx == m.cursor {
				b.WriteString(selectedStyle.Render(line))
			} else {
				b.WriteString(normalStyle.Render(line))
			}
			b.WriteString("\n")
			idx++
		}
		b.WriteString("\n")
	}

	return b.String()
}

func missingNames(deps []registry.Dependency) []string {
	names := make([]string, len(deps))
	for i, d := range deps {
		names[i] = d.Name
	}
	return names
}
