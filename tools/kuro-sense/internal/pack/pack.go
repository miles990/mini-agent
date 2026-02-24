package pack

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Directories to include in pack (relative to agentDir).
var includeDirs = []string{
	"memory",
	"plugins",
	"skills",
	"scripts",
}

// Files to include in pack (relative to agentDir).
var includeFiles = []string{
	"agent-compose.yaml",
}

// Patterns to exclude.
var excludePatterns = []string{
	"node_modules",
	"dist",
	".env",
	"*.log",
	"memory-index.db",
	"server.log",
}

// Pack creates a tar.gz archive of agent data.
func Pack(agentDir, output string) (string, error) {
	if output == "" {
		output = fmt.Sprintf("kuro-sense-pack-%s.tar.gz", time.Now().Format("2006-01-02"))
	}

	f, err := os.Create(output)
	if err != nil {
		return "", fmt.Errorf("create archive: %w", err)
	}
	defer f.Close()

	gw := gzip.NewWriter(f)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()

	manifest := PackManifest{
		CreatedAt: time.Now().UTC(),
		AgentDir:  agentDir,
	}

	// Add directories
	for _, dir := range includeDirs {
		fullDir := filepath.Join(agentDir, dir)
		if _, err := os.Stat(fullDir); os.IsNotExist(err) {
			continue
		}
		if err := addDir(tw, agentDir, dir, &manifest); err != nil {
			return "", fmt.Errorf("add %s: %w", dir, err)
		}
	}

	// Add individual files
	for _, file := range includeFiles {
		fullPath := filepath.Join(agentDir, file)
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			continue
		}
		if err := addFile(tw, agentDir, file, &manifest); err != nil {
			return "", fmt.Errorf("add %s: %w", file, err)
		}
	}

	// Add instance data from ~/.mini-agent/
	homeDir, _ := os.UserHomeDir()
	instanceDir := filepath.Join(homeDir, ".mini-agent")
	if _, err := os.Stat(instanceDir); err == nil {
		if err := addDir(tw, homeDir, ".mini-agent", &manifest); err != nil {
			// Non-fatal: instance data is optional
			fmt.Fprintf(os.Stderr, "warning: could not add instance data: %v\n", err)
		}
	}

	// Write manifest as last entry
	manifestData, _ := json.MarshalIndent(manifest, "", "  ")
	hdr := &tar.Header{
		Name:    "manifest.json",
		Mode:    0644,
		Size:    int64(len(manifestData)),
		ModTime: time.Now(),
	}
	if err := tw.WriteHeader(hdr); err != nil {
		return "", err
	}
	if _, err := tw.Write(manifestData); err != nil {
		return "", err
	}

	return output, nil
}

func addDir(tw *tar.Writer, baseDir, relDir string, manifest *PackManifest) error {
	fullDir := filepath.Join(baseDir, relDir)
	return filepath.Walk(fullDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if shouldExclude(path) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if info.IsDir() {
			return nil
		}

		rel, _ := filepath.Rel(baseDir, path)
		return addFile(tw, baseDir, rel, manifest)
	})
}

func addFile(tw *tar.Writer, baseDir, relPath string, manifest *PackManifest) error {
	fullPath := filepath.Join(baseDir, relPath)
	info, err := os.Stat(fullPath)
	if err != nil {
		return err
	}

	hdr, err := tar.FileInfoHeader(info, "")
	if err != nil {
		return err
	}
	hdr.Name = relPath

	if err := tw.WriteHeader(hdr); err != nil {
		return err
	}

	f, err := os.Open(fullPath)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := io.Copy(tw, f); err != nil {
		return err
	}

	// Add to manifest
	hash, _ := hashFile(fullPath)
	manifest.Files = append(manifest.Files, ManifestFile{
		Path:   relPath,
		Size:   info.Size(),
		SHA256: hash,
	})

	return nil
}

func shouldExclude(path string) bool {
	base := filepath.Base(path)
	for _, pattern := range excludePatterns {
		if strings.Contains(pattern, "*") {
			if matched, _ := filepath.Match(pattern, base); matched {
				return true
			}
		} else if base == pattern {
			return true
		}
	}
	return false
}
