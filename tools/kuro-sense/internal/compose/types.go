package compose

// ComposeFile represents the top-level agent-compose.yaml structure.
type ComposeFile struct {
	Version string                 `yaml:"version"`
	Paths   *ComposePaths          `yaml:"paths,omitempty"`
	Agents  map[string]ComposeAgent `yaml:"agents"`
}

// ComposePaths holds path configuration.
type ComposePaths struct {
	Memory string `yaml:"memory,omitempty"`
	Logs   string `yaml:"logs,omitempty"`
}

// ComposeAgent represents an agent definition.
type ComposeAgent struct {
	Name       string           `yaml:"name,omitempty"`
	Port       int              `yaml:"port,omitempty"`
	Persona    string           `yaml:"persona,omitempty"`
	Loop       *ComposeLoop     `yaml:"loop,omitempty"`
	Cron       []ComposeCron    `yaml:"cron,omitempty"`
	Perception *ComposePerc     `yaml:"perception,omitempty"`
	Skills     []string         `yaml:"skills,omitempty"`
	DependsOn  []string         `yaml:"depends_on,omitempty"`
}

// ComposeLoop holds loop configuration.
type ComposeLoop struct {
	Enabled     *bool         `yaml:"enabled,omitempty"`
	Interval    string        `yaml:"interval,omitempty"`
	ActiveHours *ActiveHours  `yaml:"activeHours,omitempty"`
}

// ActiveHours defines when the agent is active.
type ActiveHours struct {
	Start *int `yaml:"start,omitempty"`
	End   *int `yaml:"end,omitempty"`
}

// ComposeCron represents a scheduled task.
type ComposeCron struct {
	Schedule string `yaml:"schedule"`
	Task     string `yaml:"task"`
}

// ComposePerc holds perception configuration.
type ComposePerc struct {
	Builtin []string            `yaml:"builtin,omitempty"`
	Custom  []ComposePerception `yaml:"custom,omitempty"`
}

// ComposePerception represents a single perception plugin entry.
type ComposePerception struct {
	Name     string `yaml:"name"`
	Script   string `yaml:"script"`
	Interval string `yaml:"interval,omitempty"`
	Timeout  int    `yaml:"timeout,omitempty"`
	Enabled  *bool  `yaml:"enabled,omitempty"`
}
