package pack

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"time"
)

// PackManifest describes a packed archive.
type PackManifest struct {
	CreatedAt time.Time      `json:"createdAt"`
	AgentDir  string         `json:"agentDir"`
	Files     []ManifestFile `json:"files"`
}

// ManifestFile is one file entry in the manifest.
type ManifestFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
