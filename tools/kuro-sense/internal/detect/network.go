package detect

import (
	"fmt"
	"net"
	"os/exec"
	"strings"
	"time"
)

// NetworkInfo holds detected network information.
type NetworkInfo struct {
	Internet   InternetStatus `json:"internet"`
	LAN        LANInfo        `json:"lan"`
	Services   []ServiceCheck `json:"services"`
	VPN        VPNInfo        `json:"vpn"`
}

// InternetStatus represents internet connectivity.
type InternetStatus struct {
	Connected bool   `json:"connected"`
	Latency   string `json:"latency,omitempty"` // e.g. "23ms"
}

// LANInfo holds local network details.
type LANInfo struct {
	IPs []string `json:"ips"` // non-loopback IPv4 addresses
}

// ServiceCheck is a reachability check for a known endpoint.
type ServiceCheck struct {
	Name      string `json:"name"`
	Endpoint  string `json:"endpoint"`
	Reachable bool   `json:"reachable"`
	Latency   string `json:"latency,omitempty"`
}

// VPNInfo holds VPN/tunnel detection results.
type VPNInfo struct {
	Active     bool     `json:"active"`
	Interfaces []string `json:"interfaces,omitempty"` // e.g. ["utun3", "tailscale0"]
}

// Known endpoints to probe for internet and API connectivity.
var defaultEndpoints = []struct {
	name     string
	endpoint string
}{
	{"GitHub API", "api.github.com:443"},
	{"Telegram API", "api.telegram.org:443"},
	{"Anthropic API", "api.anthropic.com:443"},
	{"xAI API", "api.x.ai:443"},
}

// HasNetwork checks network reachability.
// check: "internet" for general connectivity, or "host:port" for specific endpoint.
func HasNetwork(check string) bool {
	if check == "internet" {
		return DetectNetwork().Internet.Connected
	}
	// Specific endpoint check
	conn, err := net.DialTimeout("tcp", check, 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// DetectNetwork performs a full network scan.
func DetectNetwork() NetworkInfo {
	info := NetworkInfo{}

	// Internet connectivity — try a few well-known endpoints
	info.Internet = checkInternet()

	// LAN IPs
	info.LAN = detectLAN()

	// Known service endpoints
	info.Services = checkEndpoints()

	// VPN/tunnel
	info.VPN = detectVPN()

	return info
}

func checkInternet() InternetStatus {
	// Try connecting to a reliable endpoint
	targets := []string{"api.github.com:443", "1.1.1.1:443", "8.8.8.8:443"}
	for _, target := range targets {
		start := time.Now()
		conn, err := net.DialTimeout("tcp", target, 3*time.Second)
		if err == nil {
			conn.Close()
			latency := time.Since(start)
			return InternetStatus{
				Connected: true,
				Latency:   fmt.Sprintf("%dms", latency.Milliseconds()),
			}
		}
	}
	return InternetStatus{Connected: false}
}

func detectLAN() LANInfo {
	lan := LANInfo{}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return lan
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				lan.IPs = append(lan.IPs, ipnet.IP.String())
			}
		}
	}
	return lan
}

func checkEndpoints() []ServiceCheck {
	checks := make([]ServiceCheck, 0, len(defaultEndpoints))
	for _, ep := range defaultEndpoints {
		sc := ServiceCheck{
			Name:     ep.name,
			Endpoint: ep.endpoint,
		}
		start := time.Now()
		conn, err := net.DialTimeout("tcp", ep.endpoint, 2*time.Second)
		if err == nil {
			conn.Close()
			sc.Reachable = true
			sc.Latency = fmt.Sprintf("%dms", time.Since(start).Milliseconds())
		}
		checks = append(checks, sc)
	}
	return checks
}

func detectVPN() VPNInfo {
	vpn := VPNInfo{}

	ifaces, err := net.Interfaces()
	if err != nil {
		return vpn
	}

	vpnPrefixes := []string{"utun", "tun", "tap", "wg", "tailscale", "nordlynx", "proton"}

	for _, iface := range ifaces {
		// Skip down interfaces
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		name := strings.ToLower(iface.Name)
		for _, prefix := range vpnPrefixes {
			if strings.HasPrefix(name, prefix) {
				vpn.Interfaces = append(vpn.Interfaces, iface.Name)
				vpn.Active = true
				break
			}
		}
	}

	// Also check for tailscale specifically
	if !vpn.Active {
		if _, err := exec.LookPath("tailscale"); err == nil {
			if out, err := exec.Command("tailscale", "status", "--json").Output(); err == nil {
				if strings.Contains(string(out), `"Online":true`) || strings.Contains(string(out), `"BackendState":"Running"`) {
					vpn.Active = true
					vpn.Interfaces = append(vpn.Interfaces, "tailscale")
				}
			}
		}
	}

	return vpn
}
