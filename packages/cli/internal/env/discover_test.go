package env

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDeriveEnvFromFile(t *testing.T) {
	tests := []struct {
		file     string
		expected string
	}{
		{".env", "development"},
		{".env.local", "local"},
		{".env.development", "development"},
		{".env.production", "production"},
		{".env.staging", "staging"},
		{".env.test", "test"},
		{".env.custom", "custom"},
		{"path/to/.env", "development"},
		{"path/to/.env.production", "production"},
	}

	for _, tt := range tests {
		t.Run(tt.file, func(t *testing.T) {
			result := DeriveEnvFromFile(tt.file)
			if result != tt.expected {
				t.Errorf("DeriveEnvFromFile(%q) = %q, want %q", tt.file, result, tt.expected)
			}
		})
	}
}

func TestDiscover(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test files
	testFiles := []string{".env", ".env.production", ".env.staging", "not-env.txt"}
	for _, f := range testFiles {
		path := filepath.Join(tmpDir, f)
		if err := os.WriteFile(path, []byte("TEST=value"), 0644); err != nil {
			t.Fatalf("failed to create %s: %v", f, err)
		}
	}

	// Change to temp directory
	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	candidates := Discover()

	// Should find .env files but not .env.local or non-env files
	if len(candidates) != 3 {
		t.Errorf("expected 3 env files, got %d: %v", len(candidates), candidates)
	}

	// Check that files are correctly identified
	foundEnv := false
	foundProd := false
	foundStaging := false
	for _, c := range candidates {
		switch c.File {
		case ".env":
			foundEnv = true
			if c.Env != "development" {
				t.Errorf(".env should map to development, got %q", c.Env)
			}
		case ".env.production":
			foundProd = true
			if c.Env != "production" {
				t.Errorf(".env.production should map to production, got %q", c.Env)
			}
		case ".env.staging":
			foundStaging = true
			if c.Env != "staging" {
				t.Errorf(".env.staging should map to staging, got %q", c.Env)
			}
		}
	}

	if !foundEnv {
		t.Error("should find .env")
	}
	if !foundProd {
		t.Error("should find .env.production")
	}
	if !foundStaging {
		t.Error("should find .env.staging")
	}
}

func TestDiscover_IncludesEnvLocal(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create .env.local (should be included)
	os.WriteFile(filepath.Join(tmpDir, ".env.local"), []byte("TEST=value"), 0644)
	os.WriteFile(filepath.Join(tmpDir, ".env"), []byte("TEST=value"), 0644)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	candidates := Discover()

	if len(candidates) != 2 {
		t.Errorf("expected 2 candidates (.env and .env.local), got %d: %v", len(candidates), candidates)
	}

	foundEnvLocal := false
	for _, c := range candidates {
		if c.File == ".env.local" {
			foundEnvLocal = true
			if c.Env != "local" {
				t.Errorf(".env.local should map to 'local', got %q", c.Env)
			}
		}
	}
	if !foundEnvLocal {
		t.Error(".env.local should be included in discovery")
	}
}

func TestDiscover_EmptyDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	candidates := Discover()

	if len(candidates) != 0 {
		t.Errorf("expected 0 candidates in empty dir, got %d", len(candidates))
	}
}

func TestDiscover_ExcludesTemplateFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create template files that should be excluded
	templateFiles := []string{".env.example", ".env.sample", ".env.template"}
	for _, f := range templateFiles {
		os.WriteFile(filepath.Join(tmpDir, f), []byte("TEST=value"), 0644)
	}
	// Create real env file that should be included
	os.WriteFile(filepath.Join(tmpDir, ".env"), []byte("TEST=value"), 0644)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	candidates := Discover()

	// Should only find .env, not the template files
	if len(candidates) != 1 {
		t.Errorf("expected 1 candidate, got %d: %v", len(candidates), candidates)
	}
	if len(candidates) > 0 && candidates[0].File != ".env" {
		t.Errorf("expected .env, got %s", candidates[0].File)
	}
}

func TestDiscover_ExcludesDirectories(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a directory starting with .env
	os.Mkdir(filepath.Join(tmpDir, ".env-backup"), 0755)
	// Create a real env file
	os.WriteFile(filepath.Join(tmpDir, ".env"), []byte("TEST=value"), 0644)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	candidates := Discover()

	// Should only find .env file, not .env-backup directory
	if len(candidates) != 1 {
		t.Errorf("expected 1 candidate, got %d: %v", len(candidates), candidates)
	}
	for _, c := range candidates {
		if c.File == ".env-backup" {
			t.Error("directories should be excluded from discovery")
		}
	}
}

func TestDeriveEnvFromFile_EdgeCases(t *testing.T) {
	tests := []struct {
		file     string
		expected string
	}{
		// Edge cases
		{".env.", ""},                             // Empty suffix
		{".env.dev.local", "dev.local"},           // Multiple dots
		{"config", "development"},                 // Not an env file format
		{"", "development"},                       // Empty string
		{".env.PRODUCTION", "PRODUCTION"},         // Case preserved
		{"./path/to/.env.staging", "staging"},     // Relative path
		{"/absolute/path/.env.prod", "prod"},      // Absolute path
		{".env.development.backup", "development.backup"}, // Multiple parts
	}

	for _, tt := range tests {
		t.Run(tt.file, func(t *testing.T) {
			result := DeriveEnvFromFile(tt.file)
			if result != tt.expected {
				t.Errorf("DeriveEnvFromFile(%q) = %q, want %q", tt.file, result, tt.expected)
			}
		})
	}
}

func TestDiscover_NonexistentDirectory(t *testing.T) {
	// Change to a non-existent directory simulation
	// by changing to a temp dir and then removing it
	tmpDir, err := os.MkdirTemp("", "env-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	os.RemoveAll(tmpDir) // Remove the directory while we're in it
	defer os.Chdir(originalDir)

	// This should return nil without panicking
	candidates := Discover()

	if candidates != nil {
		t.Errorf("expected nil for non-readable dir, got %v", candidates)
	}
}
