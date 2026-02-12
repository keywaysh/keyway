package version

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// CacheData represents the cached version check data
type CacheData struct {
	LastCheck     time.Time     `json:"lastCheck"`
	LatestVersion string        `json:"latestVersion"`
	InstallMethod InstallMethod `json:"installMethod"`
}

// getCacheFilePath returns the path to the cache file
func getCacheFilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "keyway", "update-check.json"), nil
}

// LoadCache loads the cached version check data
func LoadCache() (*CacheData, error) {
	path, err := getCacheFilePath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cache CacheData
	if err := json.Unmarshal(data, &cache); err != nil {
		return nil, err
	}

	return &cache, nil
}

// SaveCache saves the version check data to cache
func SaveCache(cache *CacheData) error {
	path, err := getCacheFilePath()
	if err != nil {
		return err
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}
