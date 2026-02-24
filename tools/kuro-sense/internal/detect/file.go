package detect

import "os"

func pathStat(path string) (os.FileInfo, error) {
	return os.Stat(path)
}
