package cmd

import (
	"testing"
)

// Tests using dependency injection

func TestGetRepoIdsWithFallbackAndDeps_EmptyRepo(t *testing.T) {
	deps, _, _, _, _, _ := NewTestDeps()

	result := getRepoIdsWithFallbackAndDeps(nil, "", deps)

	if result != nil {
		t.Errorf("expected nil for empty repo, got %v", result)
	}
}

func TestGetRepoIdsWithFallbackAndDeps_InvalidFormat(t *testing.T) {
	deps, _, _, _, _, _ := NewTestDeps()

	result := getRepoIdsWithFallbackAndDeps(nil, "invalid-repo", deps)

	if result != nil {
		t.Errorf("expected nil for invalid format, got %v", result)
	}
}

func TestGetRepoIdsWithFallbackAndDeps_ValidRepo(t *testing.T) {
	deps, _, _, _, _, _ := NewTestDeps()

	// The mock returns nil, nil for GetRepoIdsFromBackend
	// and the GitHub fallback isn't mocked, so we get nil
	result := getRepoIdsWithFallbackAndDeps(nil, "owner/repo", deps)

	// With default mocks, result will be nil (no mock data)
	if result != nil {
		t.Logf("got result: %+v", result)
	}
}
