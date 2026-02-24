package registry

// All returns the complete list of known capabilities (27 plugins).
func All() []Capability {
	return []Capability{
		// ── workspace ──
		{
			Name: "state-changes", Script: "./plugins/state-watcher.sh",
			Description: "Workspace state changes (files, processes, git)",
			Category: CategoryWorkspace, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "docker", Kind: KindBinary, Check: "docker", Required: false, Install: InstallHint{Method: InstallBrew, Package: "docker"}},
				{Name: "git", Kind: KindBinary, Check: "git", Required: false, Install: InstallHint{Method: InstallBrew, Package: "git"}},
				{Name: "lsof", Kind: KindBinary, Check: "lsof", Required: false},
			},
		},
		{
			Name: "tasks", Script: "./plugins/task-tracker.sh",
			Description: "Task tracking from HEARTBEAT.md",
			Category: CategoryWorkspace, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "git", Kind: KindBinary, Check: "git", Required: false, Install: InstallHint{Method: InstallBrew, Package: "git"}},
			},
		},
		{
			Name: "focus-context", Script: "./plugins/focus-context.sh",
			Description: "Current app focus context (macOS)",
			Category: CategoryWorkspace, DefaultOn: true,
			Platform: Platform{OS: []string{"darwin"}},
			Dependencies: []Dependency{
				{Name: "osascript", Kind: KindBinary, Check: "osascript", Required: true},
			},
		},
		{
			Name: "mobile", Script: "./plugins/mobile-perception.sh",
			Description: "Mobile sensor data (GPS, accelerometer)",
			Category: CategoryWorkspace, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "jq", Kind: KindBinary, Check: "jq", Required: true, Install: InstallHint{Method: InstallBrew, Package: "jq"}},
				{Name: "curl", Kind: KindBinary, Check: "curl", Required: false},
				{Name: "python3", Kind: KindBinary, Check: "python3", Required: false, Install: InstallHint{Method: InstallBrew, Package: "python@3.11"}},
			},
		},
		{
			Name: "claude-code-inbox", Script: "./plugins/claude-code-inbox.sh",
			Description: "Claude Code message inbox",
			Category: CategoryWorkspace, DefaultOn: true,
		},
		{
			Name: "chat-room-inbox", Script: "./plugins/chat-room-inbox.sh",
			Description: "Chat room message inbox",
			Category: CategoryWorkspace, DefaultOn: true,
		},
		{
			Name: "git-detail", Script: "./plugins/git-status.sh",
			Description: "Detailed git status and recent commits",
			Category: CategoryWorkspace, DefaultOn: false,
			Dependencies: []Dependency{
				{Name: "git", Kind: KindBinary, Check: "git", Required: true, Install: InstallHint{Method: InstallBrew, Package: "git"}},
			},
		},

		// ── chrome ──
		{
			Name: "chrome", Script: "./plugins/chrome-status.sh",
			Description: "Chrome browser tab and page status",
			Category: CategoryChrome, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "curl", Kind: KindBinary, Check: "curl", Required: true},
				{Name: "python3", Kind: KindBinary, Check: "python3", Required: true, Install: InstallHint{Method: InstallBrew, Package: "python@3.11"}},
				{Name: "pinchtab", Kind: KindService, Check: "localhost:9867", Required: false},
			},
		},
		{
			Name: "web", Script: "./plugins/web-fetch.sh",
			Description: "Web page fetching via Pinchtab",
			Category: CategoryChrome, DefaultOn: true, Timeout: 15000,
			Dependencies: []Dependency{
				{Name: "curl", Kind: KindBinary, Check: "curl", Required: true},
				{Name: "pinchtab", Kind: KindService, Check: "localhost:9867", Required: false},
				{Name: "XAI_API_KEY", Kind: KindEnvVar, Check: "XAI_API_KEY", Required: false},
			},
		},
		{
			Name: "screen-vision", Script: "./plugins/screen-vision.sh",
			Description: "Screen OCR via Pinchtab + ocrmac",
			Category: CategoryChrome, DefaultOn: false,
			Dependencies: []Dependency{
				{Name: "curl", Kind: KindBinary, Check: "curl", Required: true},
				{Name: "pinchtab", Kind: KindService, Check: "localhost:9867", Required: true},
				{Name: "ocrmac", Kind: KindPython, Check: "ocrmac", Required: true, Install: InstallHint{Method: InstallPip, Package: "ocrmac"}},
			},
		},

		// ── telegram ──
		{
			Name: "telegram-inbox", Script: "./plugins/telegram-inbox.sh",
			Description: "Telegram message inbox",
			Category: CategoryTelegram, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "TELEGRAM_BOT_TOKEN", Kind: KindEnvVar, Check: "TELEGRAM_BOT_TOKEN", Required: true},
			},
		},

		// ── heartbeat ──
		{
			Name: "docker", Script: "./plugins/docker-status.sh",
			Description: "Docker container status",
			Category: CategoryHeartbeat, DefaultOn: false,
			Dependencies: []Dependency{
				{Name: "docker", Kind: KindBinary, Check: "docker", Required: true, Install: InstallHint{Method: InstallBrew, Package: "docker"}},
			},
		},
		{
			Name: "docker-services", Script: "./plugins/docker-services.sh",
			Description: "Docker service health checks",
			Category: CategoryHeartbeat, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "docker", Kind: KindBinary, Check: "docker", Required: true, Install: InstallHint{Method: InstallBrew, Package: "docker"}},
				{Name: "curl", Kind: KindBinary, Check: "curl", Required: false},
			},
		},
		{
			Name: "github-issues", Script: "./plugins/github-issues.sh",
			Description: "GitHub issues tracking",
			Category: CategoryHeartbeat, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "gh", Kind: KindBinary, Check: "gh", Required: true, Install: InstallHint{Method: InstallBrew, Package: "gh"}},
				{Name: "jq", Kind: KindBinary, Check: "jq", Required: true, Install: InstallHint{Method: InstallBrew, Package: "jq"}},
			},
		},
		{
			Name: "github-prs", Script: "./plugins/github-prs.sh",
			Description: "GitHub pull requests tracking",
			Category: CategoryHeartbeat, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "gh", Kind: KindBinary, Check: "gh", Required: true, Install: InstallHint{Method: InstallBrew, Package: "gh"}},
				{Name: "jq", Kind: KindBinary, Check: "jq", Required: true, Install: InstallHint{Method: InstallBrew, Package: "jq"}},
			},
		},
		{
			Name: "x-feed", Script: "./plugins/x-perception.sh",
			Description: "X/Twitter feed via Grok API",
			Category: CategoryHeartbeat, DefaultOn: true, Timeout: 35000,
			Dependencies: []Dependency{
				{Name: "curl", Kind: KindBinary, Check: "curl", Required: true},
				{Name: "jq", Kind: KindBinary, Check: "jq", Required: true, Install: InstallHint{Method: InstallBrew, Package: "jq"}},
				{Name: "XAI_API_KEY", Kind: KindEnvVar, Check: "XAI_API_KEY", Required: true},
			},
		},
		{
			Name: "self-awareness", Script: "./plugins/self-awareness.sh",
			Description: "Agent self-awareness metrics",
			Category: CategoryHeartbeat, DefaultOn: true,
		},
		{
			Name: "self-healing", Script: "./plugins/self-healing.sh",
			Description: "Auto-detect and repair system issues",
			Category: CategoryHeartbeat, DefaultOn: true,
			Dependencies: []Dependency{
				{Name: "curl", Kind: KindBinary, Check: "curl", Required: false},
				{Name: "docker", Kind: KindBinary, Check: "docker", Required: false, Install: InstallHint{Method: InstallBrew, Package: "docker"}},
				{Name: "git", Kind: KindBinary, Check: "git", Required: false, Install: InstallHint{Method: InstallBrew, Package: "git"}},
			},
		},
		{
			Name: "anomaly-detector", Script: "./plugins/anomaly-detector.sh",
			Description: "Anomaly detection in logs and metrics",
			Category: CategoryHeartbeat, DefaultOn: true,
		},
		{
			Name: "feedback-status", Script: "./plugins/feedback-status.sh",
			Description: "Feedback loop status monitoring",
			Category: CategoryHeartbeat, DefaultOn: true,
		},
		{
			Name: "website", Script: "./plugins/website-monitor.sh",
			Description: "Website monitoring and health check",
			Category: CategoryHeartbeat, DefaultOn: true, Timeout: 15000,
			Dependencies: []Dependency{
				{Name: "curl", Kind: KindBinary, Check: "curl", Required: true},
			},
		},

		// ── disabled by default / commented out ──
		{
			Name: "disk", Script: "./plugins/disk-usage.sh",
			Description: "Disk usage monitoring",
			Category: CategoryHeartbeat, DefaultOn: false,
		},
		{
			Name: "brew", Script: "./plugins/homebrew-outdated.sh",
			Description: "Homebrew outdated packages",
			Category: CategoryHeartbeat, DefaultOn: false, Timeout: 10000,
			Platform: Platform{OS: []string{"darwin"}},
			Dependencies: []Dependency{
				{Name: "brew", Kind: KindBinary, Check: "brew", Required: true},
			},
		},
		{
			Name: "ports", Script: "./plugins/port-check.sh",
			Description: "Network port status check",
			Category: CategoryHeartbeat, DefaultOn: false,
			Dependencies: []Dependency{
				{Name: "lsof", Kind: KindBinary, Check: "lsof", Required: false},
			},
		},
		{
			Name: "handoff-watcher", Script: "./plugins/handoff-watcher.sh",
			Description: "Watch handoff directory for changes",
			Category: CategoryWorkspace, DefaultOn: false,
		},
		{
			Name: "lighthouse-audit", Script: "./plugins/lighthouse-audit.sh",
			Description: "Lighthouse web audit",
			Category: CategoryHeartbeat, DefaultOn: false,
			Dependencies: []Dependency{
				{Name: "lighthouse", Kind: KindBinary, Check: "lighthouse", Required: true, Install: InstallHint{Method: InstallManual, Command: "npm install -g lighthouse"}},
			},
		},
		{
			Name: "skeptic", Script: "./plugins/skeptic.sh",
			Description: "Skeptic analysis plugin",
			Category: CategoryHeartbeat, DefaultOn: false,
		},
	}
}

// ByName returns a capability by name, or nil if not found.
func ByName(name string) *Capability {
	for _, c := range All() {
		if c.Name == name {
			return &c
		}
	}
	return nil
}

// ByCategory returns all capabilities in a given category.
func ByCategory(cat Category) []Capability {
	var result []Capability
	for _, c := range All() {
		if c.Category == cat {
			result = append(result, c)
		}
	}
	return result
}
