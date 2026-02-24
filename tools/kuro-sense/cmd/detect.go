package cmd

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/detect"
	"github.com/miles990/mini-agent/tools/kuro-sense/internal/registry"
	"github.com/spf13/cobra"
)

var detectCmd = &cobra.Command{
	Use:   "detect",
	Short: "Scan environment and detect available capabilities",
	RunE: func(cmd *cobra.Command, args []string) error {
		caps := registry.All()
		results := detect.RunAll(caps)

		if jsonOut {
			return printJSON(results)
		}
		printHuman(results)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(detectCmd)
}

func printJSON(results detect.Results) error {
	data, err := json.MarshalIndent(results, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}

func printHuman(results detect.Results) {
	fmt.Println("╭─────────────────────────────────────────╮")
	fmt.Println("│  kuro-sense — Environment Detection     │")
	fmt.Println("╰─────────────────────────────────────────╯")
	fmt.Println()

	// OS info
	fmt.Printf("  OS:       %s/%s\n", results.OS.OS, results.OS.Arch)
	if results.OS.Hostname != "" {
		fmt.Printf("  Host:     %s\n", results.OS.Hostname)
	}
	fmt.Println()

	// Runtimes
	fmt.Println("  Runtimes:")
	if results.Runtimes.Node != "" {
		fmt.Printf("    Node:   %s\n", results.Runtimes.Node)
	}
	if results.Runtimes.Python != "" {
		fmt.Printf("    Python: %s\n", results.Runtimes.Python)
	}
	if results.Runtimes.Go != "" {
		fmt.Printf("    Go:     %s\n", results.Runtimes.Go)
	}
	fmt.Println()

	// Capabilities by category
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

	var available, degraded, unavailable int

	for _, cat := range categories {
		fmt.Printf("  ── %s ──\n", categoryNames[cat])
		for _, r := range results.Capabilities {
			if r.Capability.Category != cat {
				continue
			}
			icon := "✅"
			status := ""
			if !r.Available {
				icon = "❌"
				unavailable++
				if len(r.MissingDeps) > 0 {
					names := depNames(r.MissingDeps)
					status = fmt.Sprintf(" (missing: %s)", strings.Join(names, ", "))
				}
			} else if r.Degraded {
				icon = "⚠️"
				degraded++
				optMissing := depNames(r.MissingDeps)
				status = fmt.Sprintf(" (optional: %s)", strings.Join(optMissing, ", "))
			} else {
				available++
			}
			fmt.Printf("    %s %-20s %s%s\n", icon, r.Capability.Name, r.Capability.Description, status)
		}
		fmt.Println()
	}

	// Summary
	total := available + degraded + unavailable
	fmt.Printf("  Summary: %d/%d available", available, total)
	if degraded > 0 {
		fmt.Printf(", %d degraded", degraded)
	}
	if unavailable > 0 {
		fmt.Printf(", %d unavailable", unavailable)
	}
	fmt.Println()
}

func depNames(deps []registry.Dependency) []string {
	names := make([]string, len(deps))
	for i, d := range deps {
		names[i] = d.Name
	}
	return names
}
