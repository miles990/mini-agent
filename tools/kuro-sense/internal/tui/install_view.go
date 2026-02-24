package tui

import (
	"fmt"
	"strings"
)

func renderInstallView(m model) string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("Install Dependencies"))
	b.WriteString("\n\n")

	if len(m.installQueue) == 0 {
		b.WriteString(successStyle.Render("  ✓ All dependencies satisfied"))
		b.WriteString("\n\n")
		b.WriteString(helpStyle.Render("  Press enter to continue →"))
		b.WriteString("\n")
		return b.String()
	}

	for i, item := range m.installQueue {
		status := "  "
		if i < m.installIdx {
			status = successStyle.Render("✓ ")
		} else if i == m.installIdx {
			status = selectedStyle.Render("▸ ")
		}
		b.WriteString(fmt.Sprintf("  %s%s", status, item))
		b.WriteString("\n")
	}

	b.WriteString("\n")
	if m.installDone {
		b.WriteString(helpStyle.Render("  Press enter to continue →"))
	} else {
		b.WriteString(helpStyle.Render("  Installing..."))
	}
	b.WriteString("\n")

	return b.String()
}

func collectMissingDeps(m model) []string {
	seen := make(map[string]bool)
	var deps []string
	for _, r := range m.results.Capabilities {
		if !m.selected[r.Capability.Name] {
			continue
		}
		for _, d := range r.MissingDeps {
			if d.Required && !seen[d.Name] {
				seen[d.Name] = true
				deps = append(deps, d.Name)
			}
		}
	}
	return deps
}

