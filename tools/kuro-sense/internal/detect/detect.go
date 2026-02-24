package detect

import (
	"runtime"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/registry"
)

// Results holds the complete detection output.
type Results struct {
	OS           OSInfo
	Hardware     HardwareInfo
	Network      NetworkInfo
	Runtimes     RuntimeVersions
	Capabilities []registry.DetectionResult
}

// RunAll detects all capabilities against the current environment.
func RunAll(caps []registry.Capability) Results {
	osInfo := DetectOS()
	hardware := DetectHardware()
	network := DetectNetwork()
	runtimes := DetectRuntimes()

	results := make([]registry.DetectionResult, 0, len(caps))
	for _, cap := range caps {
		results = append(results, checkCapability(cap, osInfo))
	}

	return Results{
		OS:           osInfo,
		Hardware:     hardware,
		Network:      network,
		Runtimes:     runtimes,
		Capabilities: results,
	}
}

func checkCapability(cap registry.Capability, osInfo OSInfo) registry.DetectionResult {
	result := registry.DetectionResult{
		Capability: cap,
		Available:  true,
	}

	// Platform check
	if !platformMatch(cap.Platform, osInfo) {
		result.Available = false
		return result
	}

	for _, dep := range cap.Dependencies {
		present := checkDependency(dep)
		if !present {
			result.MissingDeps = append(result.MissingDeps, dep)
			if dep.Required {
				result.Available = false
			} else {
				result.Degraded = true
			}
		}
	}

	return result
}

func checkDependency(dep registry.Dependency) bool {
	switch dep.Kind {
	case registry.KindBinary:
		return HasBinary(dep.Check)
	case registry.KindService:
		return HasService(dep.Check)
	case registry.KindEnvVar:
		return HasEnvVar(dep.Check)
	case registry.KindPython:
		return HasPythonModule(dep.Check)
	case registry.KindFile:
		return fileExists(dep.Check)
	case registry.KindHardware:
		return HasHardware(dep.Check)
	case registry.KindNetwork:
		return HasNetwork(dep.Check)
	default:
		return false
	}
}

func platformMatch(p registry.Platform, osInfo OSInfo) bool {
	if len(p.OS) > 0 {
		found := false
		for _, os := range p.OS {
			if os == runtime.GOOS {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if len(p.Arch) > 0 {
		found := false
		for _, arch := range p.Arch {
			if arch == runtime.GOARCH {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func fileExists(path string) bool {
	_, err := pathStat(path)
	return err == nil
}
