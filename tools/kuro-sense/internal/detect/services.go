package detect

import (
	"net"
	"time"
)

// HasService checks if a TCP service is listening on the given address.
// addr should be "host:port" (e.g. "localhost:9867").
func HasService(addr string) bool {
	conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
