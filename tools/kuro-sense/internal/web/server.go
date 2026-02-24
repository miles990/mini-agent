package web

import (
	"embed"
	"fmt"
	"net/http"
)

//go:embed assets/*
var assets embed.FS

// Serve starts the web UI server.
func Serve(port int, agentDir string) error {
	h := &handler{agentDir: agentDir}

	mux := http.NewServeMux()

	// Serve embedded static files
	mux.Handle("/", http.FileServer(http.FS(assets)))

	// JSON API
	mux.HandleFunc("/api/detect", h.handleDetect)
	mux.HandleFunc("/api/capabilities", h.handleCapabilities)
	mux.HandleFunc("/api/apply", h.handleApply)
	mux.HandleFunc("/api/install", h.handleInstall)

	return http.ListenAndServe(fmt.Sprintf(":%d", port), mux)
}
