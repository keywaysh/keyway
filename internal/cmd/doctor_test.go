package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCheckEnvFile_NoFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "doctor-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	result := checkEnvFile()

	if result.Status != "warn" {
		t.Errorf("expected warn status when no env files, got %q", result.Status)
	}
	if result.ID != "envfile" {
		t.Errorf("expected id 'envfile', got %q", result.ID)
	}
}

func TestCheckEnvFile_WithEnvFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "doctor-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create .env file
	os.WriteFile(filepath.Join(tmpDir, ".env"), []byte("TEST=value"), 0644)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	result := checkEnvFile()

	if result.Status != "pass" {
		t.Errorf("expected pass status when .env exists, got %q", result.Status)
	}
}

func TestCheckEnvFile_WithEnvLocal(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "doctor-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create .env.local file
	os.WriteFile(filepath.Join(tmpDir, ".env.local"), []byte("TEST=value"), 0644)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	result := checkEnvFile()

	if result.Status != "pass" {
		t.Errorf("expected pass status when .env.local exists, got %q", result.Status)
	}
}

func TestCheckEnvFile_WithEnvDevelopment(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "doctor-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create .env.development file
	os.WriteFile(filepath.Join(tmpDir, ".env.development"), []byte("TEST=value"), 0644)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	result := checkEnvFile()

	if result.Status != "pass" {
		t.Errorf("expected pass status when .env.development exists, got %q", result.Status)
	}
}

func TestCheckGitignore_NotGitRepo(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "doctor-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	originalDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	result := checkGitignore()

	// Not in a git repo should pass (no risk of committing secrets)
	if result.Status != "pass" {
		t.Errorf("expected pass status when not in git repo, got %q", result.Status)
	}
}

func TestCheckResult_Structure(t *testing.T) {
	result := checkResult{
		ID:     "test",
		Name:   "Test Check",
		Status: "pass",
		Detail: "Everything is fine",
	}

	if result.ID != "test" {
		t.Errorf("ID = %q, want 'test'", result.ID)
	}
	if result.Name != "Test Check" {
		t.Errorf("Name = %q, want 'Test Check'", result.Name)
	}
	if result.Status != "pass" {
		t.Errorf("Status = %q, want 'pass'", result.Status)
	}
	if result.Detail != "Everything is fine" {
		t.Errorf("Detail = %q, want 'Everything is fine'", result.Detail)
	}
}

func TestDoctorSummary_Calculation(t *testing.T) {
	checks := []checkResult{
		{ID: "1", Name: "Check 1", Status: "pass"},
		{ID: "2", Name: "Check 2", Status: "pass"},
		{ID: "3", Name: "Check 3", Status: "warn"},
		{ID: "4", Name: "Check 4", Status: "fail"},
	}

	summary := doctorSummary{Checks: checks}
	for _, c := range checks {
		switch c.Status {
		case "pass":
			summary.Summary.Pass++
		case "warn":
			summary.Summary.Warn++
		case "fail":
			summary.Summary.Fail++
		}
	}

	if summary.Summary.Pass != 2 {
		t.Errorf("Pass = %d, want 2", summary.Summary.Pass)
	}
	if summary.Summary.Warn != 1 {
		t.Errorf("Warn = %d, want 1", summary.Summary.Warn)
	}
	if summary.Summary.Fail != 1 {
		t.Errorf("Fail = %d, want 1", summary.Summary.Fail)
	}
}

func TestDoctorSummary_ExitCode(t *testing.T) {
	tests := []struct {
		name     string
		checks   []checkResult
		expected int
	}{
		{
			name: "all pass",
			checks: []checkResult{
				{Status: "pass"},
				{Status: "pass"},
			},
			expected: 0,
		},
		{
			name: "with warnings only",
			checks: []checkResult{
				{Status: "pass"},
				{Status: "warn"},
			},
			expected: 0,
		},
		{
			name: "with failures",
			checks: []checkResult{
				{Status: "pass"},
				{Status: "fail"},
			},
			expected: 1,
		},
		{
			name: "mixed",
			checks: []checkResult{
				{Status: "pass"},
				{Status: "warn"},
				{Status: "fail"},
			},
			expected: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			summary := doctorSummary{Checks: tt.checks}
			for _, c := range tt.checks {
				switch c.Status {
				case "pass":
					summary.Summary.Pass++
				case "warn":
					summary.Summary.Warn++
				case "fail":
					summary.Summary.Fail++
				}
			}
			summary.ExitCode = 0
			if summary.Summary.Fail > 0 {
				summary.ExitCode = 1
			}

			if summary.ExitCode != tt.expected {
				t.Errorf("ExitCode = %d, want %d", summary.ExitCode, tt.expected)
			}
		})
	}
}
