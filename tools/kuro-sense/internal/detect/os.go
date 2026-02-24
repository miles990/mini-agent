package detect

import (
	"os/exec"
	"runtime"
	"strings"
)

// OSInfo holds detected OS and hardware information.
type OSInfo struct {
	OS       string // darwin, linux, windows
	Arch     string // amd64, arm64
	Hostname string
	Home     string
}

// DetectOS returns OS and architecture info.
func DetectOS() OSInfo {
	info := OSInfo{
		OS:   runtime.GOOS,
		Arch: runtime.GOARCH,
	}

	if out, err := exec.Command("hostname").Output(); err == nil {
		info.Hostname = strings.TrimSpace(string(out))
	}

	if home, err := homeDir(); err == nil {
		info.Home = home
	}

	return info
}

func homeDir() (string, error) {
	out, err := exec.Command("sh", "-c", "echo $HOME").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
