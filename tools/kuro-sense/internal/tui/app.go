package tui

import (
	"github.com/charmbracelet/bubbletea"
	"github.com/miles990/mini-agent/tools/kuro-sense/internal/compose"
	"github.com/miles990/mini-agent/tools/kuro-sense/internal/detect"
	"github.com/miles990/mini-agent/tools/kuro-sense/internal/registry"
)

type phase int

const (
	phaseDetect  phase = iota
	phaseSelect
	phaseInstall
	phaseApply
)

type model struct {
	phase    phase
	agentDir string

	// Detection
	results detect.Results

	// Selection
	cursor   int
	selected map[string]bool // plugin name → enabled

	// Install
	installQueue []string
	installIdx   int
	installDone  bool

	// Apply
	toEnable  []string
	toDisable []string
	applied   bool
	applyErr  error

	// Current compose state
	currentEnabled map[string]bool
}

// Run starts the TUI interactive mode.
func Run(agentDir string) error {
	caps := registry.All()
	results := detect.RunAll(caps)

	// Load current compose state
	currentEnabled := make(map[string]bool)
	if cf, err := compose.Load(agentDir); err == nil {
		for _, name := range compose.GetEnabledPluginNames(cf) {
			currentEnabled[name] = true
		}
	}

	// Pre-select: currently enabled + available defaults
	selected := make(map[string]bool)
	for name := range currentEnabled {
		selected[name] = true
	}
	for _, r := range results.Capabilities {
		if r.Available && r.Capability.DefaultOn {
			if _, exists := currentEnabled[r.Capability.Name]; !exists {
				selected[r.Capability.Name] = true
			}
		}
	}

	m := model{
		phase:          phaseDetect,
		agentDir:       agentDir,
		results:        results,
		selected:       selected,
		currentEnabled: currentEnabled,
	}

	p := tea.NewProgram(m)
	_, err := p.Run()
	return err
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		return m.handleKey(msg)
	}
	return m, nil
}

func (m model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c", "q":
		if m.phase == phaseApply && m.applied {
			return m, tea.Quit
		}
		if m.phase == phaseApply && !m.applied {
			m.phase = phaseSelect
			return m, nil
		}
		return m, tea.Quit

	case "enter":
		return m.handleEnter()

	case "up", "k":
		if m.phase == phaseSelect && m.cursor > 0 {
			m.cursor--
		}
		return m, nil

	case "down", "j":
		if m.phase == phaseSelect && m.cursor < len(m.results.Capabilities)-1 {
			m.cursor++
		}
		return m, nil

	case " ":
		if m.phase == phaseSelect {
			name := m.results.Capabilities[m.cursor].Capability.Name
			m.selected[name] = !m.selected[name]
		}
		return m, nil
	}

	return m, nil
}

func (m model) handleEnter() (tea.Model, tea.Cmd) {
	switch m.phase {
	case phaseDetect:
		m.phase = phaseSelect
		return m, nil

	case phaseSelect:
		// Calculate changes
		m.toEnable = nil
		m.toDisable = nil
		for _, r := range m.results.Capabilities {
			name := r.Capability.Name
			wantEnabled := m.selected[name]
			currentlyEnabled := m.currentEnabled[name]
			if wantEnabled && !currentlyEnabled {
				m.toEnable = append(m.toEnable, name)
			} else if !wantEnabled && currentlyEnabled {
				m.toDisable = append(m.toDisable, name)
			}
		}

		// Check if any missing deps need installing
		deps := collectMissingDeps(m)
		if len(deps) > 0 {
			m.installQueue = deps
			m.installIdx = 0
			m.installDone = false
			m.phase = phaseInstall
			return m, nil
		}

		m.phase = phaseApply
		return m, nil

	case phaseInstall:
		if m.installDone {
			m.phase = phaseApply
			return m, nil
		}
		// Skip install for now (Phase 4 will implement actual installation)
		m.installDone = true
		return m, nil

	case phaseApply:
		if m.applied {
			return m, tea.Quit
		}
		// Do the apply
		err := compose.ApplyChanges(m.agentDir, m.toEnable, m.toDisable)
		m.applyErr = err
		m.applied = true
		return m, nil
	}

	return m, nil
}

func (m model) View() string {
	switch m.phase {
	case phaseDetect:
		return renderDetectView(m)
	case phaseSelect:
		return renderSelectView(m)
	case phaseInstall:
		return renderInstallView(m)
	case phaseApply:
		return renderApplyView(m)
	}
	return ""
}
