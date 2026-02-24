package detect

import (
	"os"
	"os/exec"
	"strings"
)

// HasEnvVar checks if an environment variable is set and non-empty.
func HasEnvVar(name string) bool {
	return os.Getenv(name) != ""
}

// HasPythonModule checks if a Python module is importable.
func HasPythonModule(module string) bool {
	cmd := exec.Command("python3", "-c", "import "+module)
	return cmd.Run() == nil
}

// RuntimeVersions holds detected runtime versions.
type RuntimeVersions struct {
	Node   string
	Python string
	Go     string
}

// DetectRuntimes checks for common runtime versions.
func DetectRuntimes() RuntimeVersions {
	rv := RuntimeVersions{}
	if out, err := exec.Command("node", "--version").Output(); err == nil {
		rv.Node = strings.TrimSpace(string(out))
	}
	if out, err := exec.Command("python3", "--version").Output(); err == nil {
		rv.Python = strings.TrimPrefix(strings.TrimSpace(string(out)), "Python ")
	}
	if out, err := exec.Command("go", "version").Output(); err == nil {
		parts := strings.Fields(string(out))
		if len(parts) >= 3 {
			rv.Go = strings.TrimPrefix(parts[2], "go")
		}
	}
	return rv
}
