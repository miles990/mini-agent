package compose

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// ApplyChanges modifies the compose file to enable/disable perception plugins.
// It uses the Node API to preserve comments and formatting.
func ApplyChanges(agentDir string, enable, disable []string) error {
	doc, err := LoadRaw(agentDir)
	if err != nil {
		return err
	}

	// Navigate: doc.Content[0] → mapping → agents → {agent} → perception → custom
	customNode := findCustomNode(doc)
	if customNode == nil {
		return fmt.Errorf("could not find perception.custom in compose file")
	}

	enableSet := toSet(enable)
	disableSet := toSet(disable)

	// Walk existing entries and update enabled field
	for _, item := range customNode.Content {
		if item.Kind != yaml.MappingNode {
			continue
		}
		name := getScalarField(item, "name")
		if name == "" {
			continue
		}
		if _, ok := enableSet[name]; ok {
			setEnabledField(item, true)
			delete(enableSet, name)
		}
		if _, ok := disableSet[name]; ok {
			setEnabledField(item, false)
			delete(disableSet, name)
		}
	}

	// Add new entries for plugins not already in the file
	for name := range enableSet {
		node := newPerceptionNode(name)
		customNode.Content = append(customNode.Content, node)
	}

	path := filepath.Join(agentDir, "agent-compose.yaml")
	return writeYAML(path, doc)
}

// findCustomNode navigates the YAML tree to find the perception.custom sequence node.
func findCustomNode(doc *yaml.Node) *yaml.Node {
	if doc == nil || len(doc.Content) == 0 {
		return nil
	}
	root := doc.Content[0] // document root mapping

	agentsNode := findMappingValue(root, "agents")
	if agentsNode == nil {
		return nil
	}

	// Find first agent
	if agentsNode.Kind != yaml.MappingNode || len(agentsNode.Content) < 2 {
		return nil
	}
	agentNode := agentsNode.Content[1] // first agent value

	percNode := findMappingValue(agentNode, "perception")
	if percNode == nil {
		return nil
	}

	return findMappingValue(percNode, "custom")
}

func findMappingValue(node *yaml.Node, key string) *yaml.Node {
	if node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i < len(node.Content)-1; i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func getScalarField(mapping *yaml.Node, key string) string {
	for i := 0; i < len(mapping.Content)-1; i += 2 {
		if mapping.Content[i].Value == key {
			return mapping.Content[i+1].Value
		}
	}
	return ""
}

func setEnabledField(mapping *yaml.Node, enabled bool) {
	val := "true"
	if !enabled {
		val = "false"
	}
	for i := 0; i < len(mapping.Content)-1; i += 2 {
		if mapping.Content[i].Value == "enabled" {
			mapping.Content[i+1].Value = val
			return
		}
	}
	// Add enabled field if not present
	keyNode := &yaml.Node{Kind: yaml.ScalarNode, Value: "enabled"}
	valNode := &yaml.Node{Kind: yaml.ScalarNode, Value: val, Tag: "!!bool"}
	mapping.Content = append(mapping.Content, keyNode, valNode)
}

func newPerceptionNode(name string) *yaml.Node {
	// Look up registry for script path
	script := fmt.Sprintf("./plugins/%s.sh", name)

	node := &yaml.Node{Kind: yaml.MappingNode, Content: []*yaml.Node{
		{Kind: yaml.ScalarNode, Value: "name"},
		{Kind: yaml.ScalarNode, Value: name},
		{Kind: yaml.ScalarNode, Value: "script"},
		{Kind: yaml.ScalarNode, Value: script},
	}}
	return node
}

func writeYAML(path string, doc *yaml.Node) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	enc := yaml.NewEncoder(f)
	enc.SetIndent(2)
	if err := enc.Encode(doc); err != nil {
		return fmt.Errorf("encode yaml: %w", err)
	}
	return enc.Close()
}

func toSet(items []string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, item := range items {
		m[item] = true
	}
	return m
}
