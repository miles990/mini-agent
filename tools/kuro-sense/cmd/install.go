package cmd

import (
	"fmt"
	"os/exec"
	"runtime"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/registry"
	"github.com/spf13/cobra"
)

var installCmd = &cobra.Command{
	Use:   "install [dependency]",
	Short: "Install missing dependencies",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		for _, name := range args {
			if err := installDep(name); err != nil {
				return fmt.Errorf("install %s: %w", name, err)
			}
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(installCmd)
}

func installDep(name string) error {
	// Look up install hint from registry
	hint := findInstallHint(name)
	if hint == nil {
		return fmt.Errorf("unknown dependency: %s (try installing manually)", name)
	}

	switch hint.Method {
	case registry.InstallBrew:
		if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
			return fmt.Errorf("brew not available on %s", runtime.GOOS)
		}
		fmt.Printf("Installing %s via brew...\n", hint.Package)
		cmd := exec.Command("brew", "install", hint.Package)
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("brew install failed: %w", err)
		}
		fmt.Printf("✓ %s installed\n", name)

	case registry.InstallApt:
		if runtime.GOOS != "linux" {
			return fmt.Errorf("apt not available on %s", runtime.GOOS)
		}
		fmt.Printf("Installing %s via apt...\n", hint.Package)
		cmd := exec.Command("sudo", "apt-get", "install", "-y", hint.Package)
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("apt install failed: %w", err)
		}
		fmt.Printf("✓ %s installed\n", name)

	case registry.InstallPip:
		fmt.Printf("Installing %s via pip...\n", hint.Package)
		cmd := exec.Command("pip3", "install", hint.Package)
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("pip install failed: %w", err)
		}
		fmt.Printf("✓ %s installed\n", name)

	case registry.InstallCurl:
		fmt.Printf("Installing %s via curl...\n", name)
		// curl install would need more context (URL, destination)
		return fmt.Errorf("curl install not yet implemented for %s", name)

	case registry.InstallManual:
		fmt.Printf("Manual installation required for %s:\n", name)
		if hint.Command != "" {
			fmt.Printf("  Run: %s\n", hint.Command)
		}
		return nil

	default:
		return fmt.Errorf("no install method for %s", name)
	}

	return nil
}

func findInstallHint(name string) *registry.InstallHint {
	for _, cap := range registry.All() {
		for _, dep := range cap.Dependencies {
			if dep.Name == name && dep.Install.Method != "" {
				return &dep.Install
			}
		}
	}
	return nil
}
