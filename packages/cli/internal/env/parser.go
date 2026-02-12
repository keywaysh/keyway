// Package env provides utilities for parsing and manipulating .env files.
package env

import (
	"sort"
	"strings"
)

// Parse parses env file content and returns a map of key-value pairs.
// It handles comments, empty lines, and quoted values.
func Parse(content string) map[string]string {
	result := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.Index(line, "=")
		if idx == -1 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := line[idx+1:]

		// Remove surrounding quotes
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}

		if key != "" {
			result[key] = value
		}
	}
	return result
}

// CountLines counts non-empty, non-comment lines in env content.
func CountLines(content string) int {
	count := 0
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			count++
		}
	}
	return count
}

// Merge merges vault content with local-only secrets.
// Returns the merged content with local-only secrets appended.
func Merge(vaultContent string, local, vault map[string]string) string {
	// Start with vault content
	result := strings.TrimRight(vaultContent, "\n")

	// Find local-only secrets and collect keys for sorting
	var localOnlyKeys []string
	for key := range local {
		if _, exists := vault[key]; !exists {
			localOnlyKeys = append(localOnlyKeys, key)
		}
	}

	if len(localOnlyKeys) > 0 {
		// Sort keys for deterministic output
		sort.Strings(localOnlyKeys)

		result += "\n\n# Local variables (not in vault)\n"
		for _, key := range localOnlyKeys {
			result += key + "=" + local[key] + "\n"
		}
	} else {
		result += "\n"
	}

	return result
}
