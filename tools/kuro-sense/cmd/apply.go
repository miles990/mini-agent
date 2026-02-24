package cmd

import (
	"fmt"
	"strings"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/compose"
	"github.com/miles990/mini-agent/tools/kuro-sense/internal/detect"
	"github.com/miles990/mini-agent/tools/kuro-sense/internal/registry"
	"github.com/spf13/cobra"
)

var (
	enablePlugins  []string
	disablePlugins []string
	autoMode       bool
	dryRun         bool
)

var applyCmd = &cobra.Command{
	Use:   "apply",
	Short: "Update agent-compose.yaml with perception plugin changes",
	RunE: func(cmd *cobra.Command, args []string) error {
		if autoMode {
			return runAutoApply()
		}
		if len(enablePlugins) == 0 && len(disablePlugins) == 0 {
			return fmt.Errorf("specify --enable, --disable, or --auto")
		}
		return runManualApply()
	},
}

func init() {
	applyCmd.Flags().StringSliceVar(&enablePlugins, "enable", nil, "Enable plugins (comma-separated)")
	applyCmd.Flags().StringSliceVar(&disablePlugins, "disable", nil, "Disable plugins (comma-separated)")
	applyCmd.Flags().BoolVar(&autoMode, "auto", false, "Auto-configure based on detection results")
	applyCmd.Flags().BoolVar(&dryRun, "dry-run", false, "Show changes without writing")
	rootCmd.AddCommand(applyCmd)
}

func runAutoApply() error {
	caps := registry.All()
	results := detect.RunAll(caps)

	var enable, disable []string
	for _, r := range results.Capabilities {
		if r.Available && r.Capability.DefaultOn {
			enable = append(enable, r.Capability.Name)
		} else if !r.Available {
			disable = append(disable, r.Capability.Name)
		}
	}

	if dryRun {
		fmt.Println("Auto-configure (dry run):")
		if len(enable) > 0 {
			fmt.Printf("  Enable:  %s\n", strings.Join(enable, ", "))
		}
		if len(disable) > 0 {
			fmt.Printf("  Disable: %s\n", strings.Join(disable, ", "))
		}
		return nil
	}

	if err := compose.ApplyChanges(agentDir, enable, disable); err != nil {
		return err
	}
	fmt.Printf("Applied: enabled %d, disabled %d plugins\n", len(enable), len(disable))
	return nil
}

func runManualApply() error {
	if dryRun {
		fmt.Println("Manual apply (dry run):")
		if len(enablePlugins) > 0 {
			fmt.Printf("  Enable:  %s\n", strings.Join(enablePlugins, ", "))
		}
		if len(disablePlugins) > 0 {
			fmt.Printf("  Disable: %s\n", strings.Join(disablePlugins, ", "))
		}
		return nil
	}

	if err := compose.ApplyChanges(agentDir, enablePlugins, disablePlugins); err != nil {
		return err
	}
	fmt.Println("Applied changes to agent-compose.yaml")
	return nil
}
