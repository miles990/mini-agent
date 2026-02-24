package cmd

import (
	"fmt"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/pack"
	"github.com/spf13/cobra"
)

var (
	unpackForce bool
	unpackDest  string
)

var unpackCmd = &cobra.Command{
	Use:   "unpack <archive>",
	Short: "Restore agent data from a pack archive",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dest := unpackDest
		if dest == "" {
			dest = agentDir
		}
		if err := pack.Unpack(args[0], dest, unpackForce); err != nil {
			return err
		}
		fmt.Printf("✓ Unpacked to %s\n", dest)
		return nil
	},
}

func init() {
	unpackCmd.Flags().BoolVar(&unpackForce, "force", false, "Overwrite newer files")
	unpackCmd.Flags().StringVar(&unpackDest, "dest", "", "Destination directory (default: --agent-dir)")
	rootCmd.AddCommand(unpackCmd)
}
