package detect

import (
	"os/exec"
)

// HasBinary checks if a binary is available in PATH.
func HasBinary(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
