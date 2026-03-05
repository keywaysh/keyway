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

// envAliases maps common framework-specific env file suffixes to standard
// vault environment names (e.g. Next.js/Vite ".env.local" → "development").
var envAliases = map[string]string{
	"local":             "development",
	"dev":               "development",
	"prod":              "production",
	"stage":             "staging",
	"development.local": "development",
	"production.local":  "production",
	"staging.local":     "staging",
	"test.local":        "development",
}

// DeriveEnvFromFile derives the environment name from a filename.
// Examples:
//   - ".env" -> "development"
//   - ".env.local" -> "development"
//   - ".env.production" -> "production"
//   - ".env.staging" -> "staging"
func DeriveEnvFromFile(file string) string {
	base := filepath.Base(file)
	if base == ".env" {
		return "development"
	}
	if strings.HasPrefix(base, ".env.") {
		suffix := strings.TrimPrefix(base, ".env.")
		if mapped, ok := envAliases[suffix]; ok {
			return mapped
		}
		return suffix
	}
	return "development"
}
