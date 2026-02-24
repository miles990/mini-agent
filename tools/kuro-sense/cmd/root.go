package cmd

import (
	"fmt"
	"os"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/tui"
	"github.com/spf13/cobra"
)

var (
	agentDir string
	jsonOut  bool
)

var rootCmd = &cobra.Command{
	Use:   "kuro-sense",
	Short: "Perception capability manager for AI agents",
	Long:  "Detect environment capabilities, configure agent perception plugins, install dependencies, and migrate agent data.",
	RunE: func(cmd *cobra.Command, args []string) error {
		return tui.Run(agentDir)
	},
}

func init() {
	rootCmd.PersistentFlags().StringVar(&agentDir, "agent-dir", ".", "Agent project directory")
	rootCmd.PersistentFlags().BoolVar(&jsonOut, "json", false, "Output as JSON")
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
