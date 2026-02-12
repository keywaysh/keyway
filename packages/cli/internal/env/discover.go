package env

import (
	"os"
	"path/filepath"
	"strings"
)

// Candidate represents a discovered .env file with its derived environment.
type Candidate struct {
	File string
	Env  string
}

// Discover finds .env files in the current directory.
// It excludes template files like .env.example, .env.sample, etc.
func Discover() []Candidate {
	entries, err := os.ReadDir(".")
	if err != nil {
		return nil
	}

	// Template files to exclude (not real secrets)
	excludeFiles := map[string]bool{
		".env.example":  true, // Template files
		".env.sample":   true,
		".env.template": true,
	}

	var candidates []Candidate
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".env") && !excludeFiles[name] && !entry.IsDir() {
			candidates = append(candidates, Candidate{
				File: name,
				Env:  DeriveEnvFromFile(name),
			})
		}
	}
	return candidates
}

// DeriveEnvFromFile derives the environment name from a filename.
// Examples:
//   - ".env" -> "development"
//   - ".env.production" -> "production"
//   - ".env.staging" -> "staging"
func DeriveEnvFromFile(file string) string {
	base := filepath.Base(file)
	if base == ".env" {
		return "development"
	}
	if strings.HasPrefix(base, ".env.") {
		return strings.TrimPrefix(base, ".env.")
	}
	return "development"
}
