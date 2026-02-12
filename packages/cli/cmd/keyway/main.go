package main

import (
	"os"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/cmd"
)

// version is set at build time via ldflags
var version = "dev"

func main() {
	// Set version for analytics
	analytics.SetVersion(version)

	// Ensure analytics are flushed on exit
	defer analytics.Shutdown()

	if err := cmd.Execute(version); err != nil {
		os.Exit(1)
	}
}
