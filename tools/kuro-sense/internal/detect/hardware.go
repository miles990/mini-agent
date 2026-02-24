package detect

import (
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
)

// HardwareInfo holds detected hardware sensor information.
type HardwareInfo struct {
	Cameras     []HWDevice `json:"cameras"`
	Microphones []HWDevice `json:"microphones"`
	Speakers    []HWDevice `json:"speakers"`
	Displays    []Display  `json:"displays"`
}

// HWDevice is a generic hardware device entry.
type HWDevice struct {
	Name string `json:"name"`
}

// Display represents a detected display.
type Display struct {
	Name       string `json:"name"`
	Resolution string `json:"resolution,omitempty"`
}

// HasHardware checks if a hardware type is present.
// kind: "camera", "microphone", "speaker", "display"
func HasHardware(kind string) bool {
	hw := DetectHardware()
	switch kind {
	case "camera":
		return len(hw.Cameras) > 0
	case "microphone":
		return len(hw.Microphones) > 0
	case "speaker":
		return len(hw.Speakers) > 0
	case "display":
		return len(hw.Displays) > 0
	}
	return false
}

// DetectHardware scans for perception-relevant hardware.
func DetectHardware() HardwareInfo {
	if runtime.GOOS == "darwin" {
		return detectHardwareDarwin()
	}
	if runtime.GOOS == "linux" {
		return detectHardwareLinux()
	}
	return HardwareInfo{}
}

// ── macOS ──
// Single system_profiler call with JSON output for speed.

func detectHardwareDarwin() HardwareInfo {
	hw := HardwareInfo{}

	out, err := exec.Command("system_profiler",
		"SPCameraDataType", "SPAudioDataType", "SPDisplaysDataType",
		"-json",
	).Output()
	if err != nil {
		return hw
	}

	var sp map[string]json.RawMessage
	if json.Unmarshal(out, &sp) != nil {
		return hw
	}

	// Cameras
	hw.Cameras = parseDarwinCameras(sp["SPCameraDataType"])

	// Audio (input = microphones, output = speakers)
	hw.Microphones, hw.Speakers = parseDarwinAudio(sp["SPAudioDataType"])

	// Displays
	hw.Displays = parseDarwinDisplays(sp["SPDisplaysDataType"])

	return hw
}

func parseDarwinCameras(raw json.RawMessage) []HWDevice {
	var items []struct {
		Name string `json:"_name"`
	}
	if json.Unmarshal(raw, &items) != nil {
		return nil
	}
	devs := make([]HWDevice, 0, len(items))
	for _, item := range items {
		devs = append(devs, HWDevice{Name: item.Name})
	}
	return devs
}

func parseDarwinAudio(raw json.RawMessage) (mics, speakers []HWDevice) {
	var items []struct {
		Name  string `json:"_name"`
		Items []struct {
			Name    string `json:"_name"`
			Inputs  string `json:"coreaudio_input_source,omitempty"`
			Outputs string `json:"coreaudio_output_source,omitempty"`
		} `json:"_items"`
	}
	if json.Unmarshal(raw, &items) != nil {
		return
	}
	for _, dev := range items {
		for _, item := range dev.Items {
			if item.Inputs != "" {
				mics = append(mics, HWDevice{Name: item.Name})
			}
			if item.Outputs != "" {
				speakers = append(speakers, HWDevice{Name: item.Name})
			}
		}
	}
	// Fallback: if struct parsing missed devices, try simpler heuristic
	if len(mics) == 0 && len(speakers) == 0 {
		for _, dev := range items {
			name := dev.Name
			if name != "" {
				// Most Macs have both input and output
				mics = append(mics, HWDevice{Name: name})
				speakers = append(speakers, HWDevice{Name: name})
			}
		}
	}
	return
}

func parseDarwinDisplays(raw json.RawMessage) []Display {
	var items []struct {
		Name string `json:"_name"`
		Res  []struct {
			Resolution string `json:"_spdisplays_resolution"`
		} `json:"spdisplays_ndrvs"`
	}
	if json.Unmarshal(raw, &items) != nil {
		return nil
	}
	displays := make([]Display, 0, len(items))
	for _, item := range items {
		d := Display{Name: item.Name}
		if len(item.Res) > 0 {
			d.Resolution = item.Res[0].Resolution
		}
		displays = append(displays, d)
	}
	return displays
}

// ── Linux ──

func detectHardwareLinux() HardwareInfo {
	hw := HardwareInfo{}

	// Cameras: /dev/video*
	if out, err := exec.Command("sh", "-c", "ls /dev/video* 2>/dev/null").Output(); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line != "" {
				hw.Cameras = append(hw.Cameras, HWDevice{Name: line})
			}
		}
	}

	// Audio devices via /proc/asound
	if out, err := exec.Command("sh", "-c", "cat /proc/asound/cards 2>/dev/null").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			// Lines with card info start with a number
			if len(line) > 0 && line[0] >= '0' && line[0] <= '9' {
				parts := strings.SplitN(line, "]: ", 2)
				if len(parts) == 2 {
					name := strings.TrimSpace(parts[1])
					hw.Microphones = append(hw.Microphones, HWDevice{Name: name})
					hw.Speakers = append(hw.Speakers, HWDevice{Name: name})
				}
			}
		}
	}

	// Displays: xrandr
	if out, err := exec.Command("sh", "-c", "xrandr --query 2>/dev/null | grep ' connected'").Output(); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line == "" {
				continue
			}
			parts := strings.Fields(line)
			name := parts[0]
			res := ""
			for _, p := range parts {
				if strings.Contains(p, "x") && len(p) > 3 {
					res = p
					break
				}
			}
			hw.Displays = append(hw.Displays, Display{Name: name, Resolution: res})
		}
	}

	return hw
}
