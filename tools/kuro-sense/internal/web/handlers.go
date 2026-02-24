package web

import (
	"encoding/json"
	"net/http"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/compose"
	"github.com/miles990/mini-agent/tools/kuro-sense/internal/detect"
	"github.com/miles990/mini-agent/tools/kuro-sense/internal/registry"
)

type handler struct {
	agentDir string
}

func (h *handler) handleDetect(w http.ResponseWriter, r *http.Request) {
	caps := registry.All()
	results := detect.RunAll(caps)
	writeJSON(w, results)
}

func (h *handler) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, registry.All())
}

func (h *handler) handleApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Enable  []string `json:"enable"`
		Disable []string `json:"disable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := compose.ApplyChanges(h.agentDir, req.Enable, req.Disable); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"ok": true})
}

func (h *handler) handleInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Placeholder: actual installation will be done via installer package
	writeJSON(w, map[string]string{"status": "not_implemented", "name": req.Name})
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
