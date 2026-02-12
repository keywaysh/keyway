package version

import "os"

// IsUpdateCheckDisabled returns true if update check is disabled via env var
func IsUpdateCheckDisabled() bool {
	val := os.Getenv("KEYWAY_DISABLE_UPDATE_CHECK")
	return val == "1" || val == "true"
}
