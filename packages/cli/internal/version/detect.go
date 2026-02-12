package version

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// InstallMethod represents how the CLI was installed
type InstallMethod string

const (
	InstallMethodNPM      InstallMethod = "npm"
	InstallMethodNPX      InstallMethod = "npx"
	InstallMethodHomebrew InstallMethod = "homebrew"
	InstallMethodBinary   InstallMethod = "binary"
)

// DetectInstallMethod detects how the CLI was installed
func DetectInstallMethod() InstallMethod {
	execPath, err := os.Executable()
	if err != nil {
		return InstallMethodBinary
	}

	// Resolve symlinks to get the real path
	realPath, err := filepath.EvalSymlinks(execPath)
	if err != nil {
		realPath = execPath
	}

	pathLower := strings.ToLower(realPath)

	// Check for npx (temporary cache)
	if strings.Contains(pathLower, "_npx") ||
		strings.Contains(pathLower, "npx-") {
		return InstallMethodNPX
	}

	// Check for npm global installation
	if strings.Contains(pathLower, "node_modules") ||
		strings.Contains(pathLower, "@keywaysh") {
		return InstallMethodNPM
	}

	// Check for Homebrew installation (macOS and Linux)
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" {
		if strings.Contains(pathLower, "/cellar/") ||
			strings.Contains(pathLower, "/homebrew/") ||
			strings.Contains(pathLower, "/linuxbrew/") {
			return InstallMethodHomebrew
		}
	}

	return InstallMethodBinary
}
