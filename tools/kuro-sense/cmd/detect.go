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

	// Hardware
	hw := results.Hardware
	fmt.Println("  Hardware:")
	if len(hw.Cameras) > 0 {
		names := hwNames(hw.Cameras)
		fmt.Printf("    Camera:     %s\n", strings.Join(names, ", "))
	} else {
		fmt.Println("    Camera:     (none)")
	}
	if len(hw.Microphones) > 0 {
		names := hwNames(hw.Microphones)
		fmt.Printf("    Microphone: %s\n", strings.Join(names, ", "))
	} else {
		fmt.Println("    Microphone: (none)")
	}
	if len(hw.Speakers) > 0 {
		names := hwNames(hw.Speakers)
		fmt.Printf("    Speaker:    %s\n", strings.Join(names, ", "))
	} else {
		fmt.Println("    Speaker:    (none)")
	}
	if len(hw.Displays) > 0 {
		for _, d := range hw.Displays {
			res := ""
			if d.Resolution != "" {
				res = " (" + d.Resolution + ")"
			}
			fmt.Printf("    Display:    %s%s\n", d.Name, res)
		}
	} else {
		fmt.Println("    Display:    (none)")
	}
	fmt.Println()

	// Network
	nw := results.Network
	fmt.Println("  Network:")
	if nw.Internet.Connected {
		fmt.Printf("    Internet:   ✓ connected (%s)\n", nw.Internet.Latency)
	} else {
		fmt.Println("    Internet:   ✗ no connection")
	}
	if len(nw.LAN.IPs) > 0 {
		fmt.Printf("    LAN IP:     %s\n", strings.Join(nw.LAN.IPs, ", "))
	}
	if nw.VPN.Active {
		fmt.Printf("    VPN:        ✓ active (%s)\n", strings.Join(nw.VPN.Interfaces, ", "))
	}
	for _, svc := range nw.Services {
		icon := "✓"
		latency := ""
		if !svc.Reachable {
			icon = "✗"
		} else if svc.Latency != "" {
			latency = " (" + svc.Latency + ")"
		}
		fmt.Printf("    %-16s %s%s\n", svc.Name+":", icon, latency)
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

func hwNames(devs []detect.HWDevice) []string {
	names := make([]string, len(devs))
	for i, d := range devs {
		names[i] = d.Name
	}
	return names
}
