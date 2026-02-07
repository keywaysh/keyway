//go:build !windows

package injector

import (
	"os"
	"syscall"
)

var signals = []os.Signal{syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP}
