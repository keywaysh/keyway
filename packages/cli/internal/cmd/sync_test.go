package cmd

import (
	"testing"
)

func TestMapToProviderEnvironment_Vercel(t *testing.T) {
	tests := []struct {
		keywayEnv string
		expected  string
	}{
		{"production", "production"},
		{"staging", "preview"},
		{"dev", "development"},
		{"development", "development"},
		{"PRODUCTION", "production"}, // case insensitive
		{"Staging", "preview"},
		{"unknown", "production"}, // default to production
		{"", "production"},
	}

	for _, tt := range tests {
		t.Run(tt.keywayEnv, func(t *testing.T) {
			got := mapToProviderEnvironment("vercel", tt.keywayEnv)
			if got != tt.expected {
				t.Errorf("mapToProviderEnvironment(vercel, %q) = %q, want %q", tt.keywayEnv, got, tt.expected)
			}
		})
	}
}

func TestMapToProviderEnvironment_Railway(t *testing.T) {
	tests := []struct {
		keywayEnv string
		expected  string
	}{
		{"production", "production"},
		{"staging", "staging"},
		{"dev", "development"},
		{"development", "development"},
		{"unknown", "production"},
	}

	for _, tt := range tests {
		t.Run(tt.keywayEnv, func(t *testing.T) {
			got := mapToProviderEnvironment("railway", tt.keywayEnv)
			if got != tt.expected {
				t.Errorf("mapToProviderEnvironment(railway, %q) = %q, want %q", tt.keywayEnv, got, tt.expected)
			}
		})
	}
}

func TestMapToProviderEnvironment_UnknownProvider(t *testing.T) {
	// Unknown provider should return the keyway env as-is
	got := mapToProviderEnvironment("unknown-provider", "custom-env")
	if got != "custom-env" {
		t.Errorf("mapToProviderEnvironment(unknown, custom-env) = %q, want %q", got, "custom-env")
	}
}

func TestGetProjectDisplayName(t *testing.T) {
	tests := []struct {
		name     string
		project  ProjectWithLinkedRepo
		expected string
	}{
		{
			name:     "with service name",
			project:  ProjectWithLinkedRepo{Name: "project-name", ServiceName: strPtr("service-name")},
			expected: "service-name",
		},
		{
			name:     "without service name",
			project:  ProjectWithLinkedRepo{Name: "project-name"},
			expected: "project-name",
		},
		{
			name:     "empty service name",
			project:  ProjectWithLinkedRepo{Name: "project-name", ServiceName: strPtr("")},
			expected: "project-name",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := getProjectDisplayName(tt.project)
			if got != tt.expected {
				t.Errorf("getProjectDisplayName() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestProjectMatchesRepo(t *testing.T) {
	tests := []struct {
		name         string
		project      ProjectWithLinkedRepo
		repoFullName string
		expected     bool
	}{
		{
			name:         "linked repo match",
			project:      ProjectWithLinkedRepo{Name: "other-name", LinkedRepo: strPtr("owner/repo")},
			repoFullName: "owner/repo",
			expected:     true,
		},
		{
			name:         "linked repo match case insensitive",
			project:      ProjectWithLinkedRepo{Name: "other-name", LinkedRepo: strPtr("Owner/Repo")},
			repoFullName: "owner/repo",
			expected:     true,
		},
		{
			name:         "exact name match",
			project:      ProjectWithLinkedRepo{Name: "repo"},
			repoFullName: "owner/repo",
			expected:     true,
		},
		{
			name:         "exact name match case insensitive",
			project:      ProjectWithLinkedRepo{Name: "Repo"},
			repoFullName: "owner/repo",
			expected:     true,
		},
		{
			name:         "no match",
			project:      ProjectWithLinkedRepo{Name: "different-name"},
			repoFullName: "owner/repo",
			expected:     false,
		},
		{
			name:         "partial name doesn't match",
			project:      ProjectWithLinkedRepo{Name: "repo-extended"},
			repoFullName: "owner/repo",
			expected:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := projectMatchesRepo(tt.project, tt.repoFullName)
			if got != tt.expected {
				t.Errorf("projectMatchesRepo() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestFindMatchingProject(t *testing.T) {
	projects := []ProjectWithLinkedRepo{
		{ID: "1", Name: "project-a"},
		{ID: "2", Name: "project-b", LinkedRepo: strPtr("owner/linked-repo")},
		{ID: "3", Name: "my-app"},
		{ID: "4", Name: "my-app-backend"},
	}

	tests := []struct {
		name          string
		repoFullName  string
		expectedID    string
		expectedMatch string
		shouldFind    bool
	}{
		{
			name:          "linked repo match",
			repoFullName:  "owner/linked-repo",
			expectedID:    "2",
			expectedMatch: "linked_repo",
			shouldFind:    true,
		},
		{
			name:          "exact name match",
			repoFullName:  "owner/my-app",
			expectedID:    "3",
			expectedMatch: "exact_name",
			shouldFind:    true,
		},
		{
			name:          "no match",
			repoFullName:  "owner/unknown-repo",
			expectedID:    "",
			expectedMatch: "",
			shouldFind:    false,
		},
		{
			name:          "partial match - unique",
			repoFullName:  "owner/project-a-extended",
			expectedID:    "1",
			expectedMatch: "partial_name",
			shouldFind:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			match := findMatchingProject(projects, tt.repoFullName)

			if tt.shouldFind {
				if match == nil {
					t.Fatal("expected to find a match, got nil")
				}
				if match.Project.ID != tt.expectedID {
					t.Errorf("expected project ID %q, got %q", tt.expectedID, match.Project.ID)
				}
				if match.MatchType != tt.expectedMatch {
					t.Errorf("expected match type %q, got %q", tt.expectedMatch, match.MatchType)
				}
			} else {
				if match != nil {
					t.Errorf("expected no match, got project ID %q", match.Project.ID)
				}
			}
		})
	}
}

func TestFindMatchingProject_LinkedRepoPriority(t *testing.T) {
	// Test that linked repo has higher priority than exact name match
	projects := []ProjectWithLinkedRepo{
		{ID: "1", Name: "repo"}, // exact name match
		{ID: "2", Name: "other", LinkedRepo: strPtr("owner/repo")}, // linked repo match
	}

	match := findMatchingProject(projects, "owner/repo")

	if match == nil {
		t.Fatal("expected to find a match")
	}
	if match.Project.ID != "2" {
		t.Errorf("linked repo should have priority, got project ID %q", match.Project.ID)
	}
	if match.MatchType != "linked_repo" {
		t.Errorf("expected match type 'linked_repo', got %q", match.MatchType)
	}
}

func TestFindMatchingProject_MultiplePartialMatches(t *testing.T) {
	// When there are multiple partial matches, should return nil
	projects := []ProjectWithLinkedRepo{
		{ID: "1", Name: "app-frontend"},
		{ID: "2", Name: "app-backend"},
	}

	match := findMatchingProject(projects, "owner/app")

	if match != nil {
		t.Errorf("should not match when multiple partial matches exist, got project ID %q", match.Project.ID)
	}
}

func TestFindMatchingProject_InvalidRepoFormat(t *testing.T) {
	projects := []ProjectWithLinkedRepo{
		{ID: "1", Name: "project"},
	}

	// Invalid repo format (no slash)
	match := findMatchingProject(projects, "invalid-repo-format")

	if match != nil {
		t.Error("should return nil for invalid repo format")
	}
}

func TestFindMatchingProject_EmptyProjects(t *testing.T) {
	var projects []ProjectWithLinkedRepo

	match := findMatchingProject(projects, "owner/repo")

	if match != nil {
		t.Error("should return nil for empty projects list")
	}
}

// Helper function to create string pointer
func strPtr(s string) *string {
	return &s
}
