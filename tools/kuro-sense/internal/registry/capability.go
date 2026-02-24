package registry

// Category represents a perception plugin category.
type Category string

const (
	CategoryWorkspace Category = "workspace"
	CategoryChrome    Category = "chrome"
	CategoryTelegram  Category = "telegram"
	CategoryHeartbeat Category = "heartbeat"
)

// DependencyKind represents what kind of dependency to check.
type DependencyKind string

const (
	KindBinary  DependencyKind = "binary"
	KindService DependencyKind = "service"
	KindFile    DependencyKind = "file"
	KindEnvVar  DependencyKind = "envvar"
	KindPython  DependencyKind = "python"
)

// InstallMethod represents how to install a dependency.
type InstallMethod string

const (
	InstallBrew   InstallMethod = "brew"
	InstallApt    InstallMethod = "apt"
	InstallCurl   InstallMethod = "curl"
	InstallPip    InstallMethod = "pip"
	InstallManual InstallMethod = "manual"
)

// Platform constraints for a capability.
type Platform struct {
	OS   []string // empty = all
	Arch []string // empty = all
}

// InstallHint tells the installer how to install a dependency.
type InstallHint struct {
	Method  InstallMethod
	Package string // brew/apt package name, or URL for curl
	Command string // fallback manual command
}

// Dependency represents a prerequisite for a capability.
type Dependency struct {
	Name     string
	Kind     DependencyKind
	Check    string // binary name / "host:port" / file path / env var / python module
	Required bool
	Install  InstallHint
}

// Capability is the full definition of a perception plugin.
type Capability struct {
	Name         string
	Script       string   // e.g. "./plugins/docker-status.sh"
	Description  string
	Category     Category
	Dependencies []Dependency
	Platform     Platform
	Timeout      int  // ms, 0 = default (10000)
	DefaultOn    bool
	Tags         []string
}

// DetectionResult is the result of checking one capability.
type DetectionResult struct {
	Capability  Capability
	Available   bool // all required deps present
	Degraded    bool // some optional deps missing
	MissingDeps []Dependency
}
