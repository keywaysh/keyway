//go:build windows

package injector

import (
	"os"
	"syscall"
)

// SIGTERM is included because signal.Notify delivers it on console shutdown events
// (CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT). Note that forwarding
// SIGTERM to child processes via Process.Signal is not supported on Windows —
// the attempt will fail silently.
var signals = []os.Signal{syscall.SIGINT, syscall.SIGTERM}
