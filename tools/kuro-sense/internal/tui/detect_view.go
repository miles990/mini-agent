package tui

import (
	"fmt"
	"strings"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/registry"
)

func renderDetectView(m model) string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("kuro-sense — Environment Detection"))
	b.WriteString("\n\n")

	b.WriteString(fmt.Sprintf("  OS: %s/%s", m.results.OS.OS, m.results.OS.Arch))
	if m.results.OS.Hostname != "" {
		b.WriteString(fmt.Sprintf("  Host: %s", m.results.OS.Hostname))
	}
	b.WriteString("\n")

	if m.results.Runtimes.Node != "" {
		b.WriteString(fmt.Sprintf("  Node: %s", m.results.Runtimes.Node))
	}
	if m.results.Runtimes.Python != "" {
		b.WriteString(fmt.Sprintf("  Python: %s", m.results.Runtimes.Python))
	}
	b.WriteString("\n\n")

	var avail, unavail int
	for _, r := range m.results.Capabilities {
		if r.Available {
			avail++
		} else {
			unavail++
		}
	}

	b.WriteString(fmt.Sprintf("  Found %d/%d capabilities available\n",
		avail, len(m.results.Capabilities)))
	if unavail > 0 {
		b.WriteString(statusUnavail.Render(fmt.Sprintf("  %d unavailable (missing dependencies)", unavail)))
		b.WriteString("\n")
	}

	b.WriteString("\n")
	b.WriteString(helpStyle.Render("  Press enter to configure plugins →"))
	b.WriteString("\n")

	return b.String()
}

func statusIcon(r registry.DetectionResult) string {
	if !r.Available {
		return statusUnavail.Render("✗")
	}
	if r.Degraded {
		return statusDegraded.Render("~")
	}
	return statusAvailable.Render("✓")
}
