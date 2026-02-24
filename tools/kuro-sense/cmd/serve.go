package cmd

import (
	"fmt"
	"net"

	"github.com/miles990/mini-agent/tools/kuro-sense/internal/web"
	"github.com/spf13/cobra"
)

var servePort int

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start web UI for mobile browser access",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Show local IP for mobile access
		if ip := getLocalIP(); ip != "" {
			fmt.Printf("Open in browser: http://%s:%d\n", ip, servePort)
		}
		fmt.Printf("Listening on http://localhost:%d\n", servePort)
		return web.Serve(servePort, agentDir)
	},
}

func init() {
	serveCmd.Flags().IntVar(&servePort, "port", 8090, "Port to listen on")
	rootCmd.AddCommand(serveCmd)
}

func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}
	return ""
}
