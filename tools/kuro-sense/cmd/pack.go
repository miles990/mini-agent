package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/pack"
	"github.com/spf13/cobra"
)

var packOutput string

var packCmd = &cobra.Command{
	Use:   "pack",
	Short: "Pack agent data for migration",
	RunE: func(cmd *cobra.Command, args []string) error {
		outPath, err := pack.Pack(agentDir, packOutput)
		if err != nil {
			return err
		}
		abs, _ := filepath.Abs(outPath)
		fi, _ := os.Stat(abs)
		fmt.Printf("✓ Packed to %s (%s)\n", abs, humanSize(fi.Size()))
		return nil
	},
}

func init() {
	packCmd.Flags().StringVarP(&packOutput, "output", "o", "", "Output file path (default: kuro-sense-pack-YYYY-MM-DD.tar.gz)")
	rootCmd.AddCommand(packCmd)
}

func humanSize(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
