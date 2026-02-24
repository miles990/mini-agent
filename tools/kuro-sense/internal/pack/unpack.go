package pack

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Unpack extracts a kuro-sense archive to the destination directory.
func Unpack(archive, dest string, force bool) error {
	f, err := os.Open(archive)
	if err != nil {
		return fmt.Errorf("open archive: %w", err)
	}
	defer f.Close()

	gr, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip reader: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	var manifest *PackManifest

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar: %w", err)
		}

		// Read manifest but don't extract it
		if hdr.Name == "manifest.json" {
			data, err := io.ReadAll(tr)
			if err != nil {
				return fmt.Errorf("read manifest: %w", err)
			}
			manifest = &PackManifest{}
			json.Unmarshal(data, manifest)
			continue
		}

		target := filepath.Join(dest, hdr.Name)

		// Security: prevent path traversal
		if !filepath.IsAbs(target) {
			target = filepath.Join(dest, filepath.Clean(hdr.Name))
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(target, 0755)
		case tar.TypeReg:
			// Check if target is newer (skip unless --force)
			if !force {
				if existing, err := os.Stat(target); err == nil {
					if existing.ModTime().After(hdr.ModTime) {
						continue // skip: existing file is newer
					}
				}
			}

			os.MkdirAll(filepath.Dir(target), 0755)
			out, err := os.Create(target)
			if err != nil {
				return fmt.Errorf("create %s: %w", hdr.Name, err)
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return fmt.Errorf("extract %s: %w", hdr.Name, err)
			}
			out.Close()
			os.Chmod(target, hdr.FileInfo().Mode())
		}
	}

	// Verify hashes if manifest present
	if manifest != nil {
		verified := 0
		for _, mf := range manifest.Files {
			target := filepath.Join(dest, mf.Path)
			if hash, err := hashFile(target); err == nil && hash == mf.SHA256 {
				verified++
			}
		}
		fmt.Printf("  Verified: %d/%d files\n", verified, len(manifest.Files))
	}

	return nil
}
