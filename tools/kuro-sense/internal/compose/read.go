package compose

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Load reads and parses an agent-compose.yaml file.
func Load(agentDir string) (*ComposeFile, error) {
	path := filepath.Join(agentDir, "agent-compose.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read compose file: %w", err)
	}

	var cf ComposeFile
	if err := yaml.Unmarshal(data, &cf); err != nil {
		return nil, fmt.Errorf("parse compose file: %w", err)
	}
	return &cf, nil
}

// LoadRaw reads the compose file as a yaml.Node tree for comment-preserving edits.
func LoadRaw(agentDir string) (*yaml.Node, error) {
	path := filepath.Join(agentDir, "agent-compose.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read compose file: %w", err)
	}

	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse compose file: %w", err)
	}
	return &doc, nil
}

// GetCustomPerceptions extracts the custom perception list from a parsed compose file.
func GetCustomPerceptions(cf *ComposeFile) []ComposePerception {
	for _, agent := range cf.Agents {
		if agent.Perception != nil && agent.Perception.Custom != nil {
			return agent.Perception.Custom
		}
	}
	return nil
}

// GetEnabledPluginNames returns the names of all enabled custom perception plugins.
func GetEnabledPluginNames(cf *ComposeFile) []string {
	perceptions := GetCustomPerceptions(cf)
	var names []string
	for _, p := range perceptions {
		if p.Enabled == nil || *p.Enabled {
			names = append(names, p.Name)
		}
	}
	return names
}
