package cmd

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/keywaysh/cli/internal/auth"
	"github.com/spf13/cobra"
)

// The Keyway API refuses raw GitHub tokens as identities, so the CLI must refuse them
// before they reach the network.

var githubTokens = []string{
	"ghp_fake_token_for_tests",
	"github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
	"gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
	"ghu_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
	"ghs_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
	"ghr_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
}

// failOnRequest points the CLI at a server that fails the test on any request.
func failOnRequest(t *testing.T) *atomic.Int32 {
	t.Helper()
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("KEYWAY_API_URL", srv.URL)
	// No browser, git or other helper binary can be started.
	t.Setenv("PATH", t.TempDir())
	return &hits
}

// isolatedHome gives the auth store an empty home directory.
func isolatedHome(t *testing.T) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("APPDATA", home)
}

func assertContainsAll(t *testing.T, msg string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(msg, want) {
			t.Errorf("message %q does not contain %q", msg, want)
		}
	}
}

func TestLoginTokenFlag_FailsWithoutNetwork(t *testing.T) {
	hits := failOnRequest(t)

	cmd := &cobra.Command{}
	cmd.Flags().Bool("token", false, "")
	if err := cmd.Flags().Set("token", "true"); err != nil {
		t.Fatal(err)
	}

	err := runLogin(cmd, nil)
	if err == nil {
		t.Fatal("keyway login --token should fail")
	}
	assertContainsAll(t, err.Error(),
		"no longer supported",
		"keyway login",
		"API key",
		"KEYWAY_TOKEN=kw_live_",
	)
	if hits.Load() != 0 {
		t.Errorf("keyway login --token made %d API requests, want 0", hits.Load())
	}
}

func TestLoginTokenFlag_KeptButHidden(t *testing.T) {
	flag := loginCmd.Flags().Lookup("token")
	if flag == nil {
		t.Fatal("--token must stay so old scripts get an explanation instead of 'unknown flag'")
	}
	if !flag.Hidden {
		t.Error("--token should be hidden from help")
	}
	if strings.Contains(loginCmd.Long, "personal access token") {
		t.Errorf("login help still advertises personal access tokens: %q", loginCmd.Long)
	}
}

func TestEnsureLogin_RejectsGitHubTokenFromEnv(t *testing.T) {
	for _, token := range githubTokens {
		t.Run(token[:4], func(t *testing.T) {
			failOnRequest(t)
			isolatedHome(t)
			t.Setenv("KEYWAY_TOKEN", token)

			got, err := EnsureLogin()
			if err == nil {
				t.Fatalf("EnsureLogin() accepted a GitHub token from KEYWAY_TOKEN (returned %q)", got)
			}
			if got != "" {
				t.Errorf("EnsureLogin() returned token %q along with the error", got)
			}
			assertContainsAll(t, err.Error(), "KEYWAY_TOKEN", "kw_live_", "keyway login")
			if strings.Contains(err.Error(), token) {
				t.Error("the error message must not echo the token")
			}
		})
	}
}

func TestEnsureLogin_AcceptsKeywayTokensFromEnv(t *testing.T) {
	for _, token := range []string{"kw_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0", "kw_test_abc", "eyJhbGciOiJIUzI1NiJ9.payload.sig"} {
		failOnRequest(t)
		isolatedHome(t)
		t.Setenv("KEYWAY_TOKEN", token)

		got, err := EnsureLogin()
		if err != nil {
			t.Fatalf("EnsureLogin() rejected %q: %v", token, err)
		}
		if got != token {
			t.Errorf("EnsureLogin() = %q, want %q", got, token)
		}
	}
}

func TestEnsureLogin_RejectsStoredGitHubToken(t *testing.T) {
	failOnRequest(t)
	isolatedHome(t)
	t.Setenv("KEYWAY_TOKEN", "")

	// A credential saved by `keyway login --token` before PATs were refused
	if err := auth.NewStore().SaveAuth(githubTokens[1], "octocat", ""); err != nil {
		t.Fatal(err)
	}

	got, err := EnsureLogin()
	if err == nil {
		t.Fatalf("EnsureLogin() accepted a stored GitHub token (returned %q)", got)
	}
	if got != "" {
		t.Errorf("EnsureLogin() returned token %q along with the error", got)
	}
	assertContainsAll(t, err.Error(), "keyway login")
}

func TestCheckAuthWithDeps_StoredGitHubTokenIsNotSent(t *testing.T) {
	deps, _, _, _, authStore, _, _ := NewTestDepsForDoctor()
	authStore.StoredAuth = &StoredAuthInfo{KeywayToken: githubTokens[0], GitHubLogin: "octocat"}

	result := checkAuthWithDeps(deps)

	if tokens := deps.APIFactory.(*MockAPIFactory).Tokens; len(tokens) != 0 {
		t.Errorf("doctor sent the GitHub token to the API (clients created with %d tokens)", len(tokens))
	}
	if result.Status != "fail" {
		t.Errorf("status = %q, want fail", result.Status)
	}
	assertContainsAll(t, result.Detail, "keyway login")
}

func TestIsGitHubToken(t *testing.T) {
	for _, token := range githubTokens {
		if !isGitHubToken(token) {
			t.Errorf("isGitHubToken(%q) = false, want true", token)
		}
	}
	if !isGitHubToken("  ghp_padded\n") {
		t.Error("isGitHubToken should ignore surrounding whitespace")
	}
	for _, token := range []string{"", "kw_live_abc", "kw_test_abc", "eyJhbGciOiJIUzI1NiJ9.e30.sig", "GHP_upper", "ghx_unknown", "xghp_inside"} {
		if isGitHubToken(token) {
			t.Errorf("isGitHubToken(%q) = true, want false", token)
		}
	}
}

func TestResolveToken(t *testing.T) {
	stored := &MockAuthStore{StoredAuth: &StoredAuthInfo{KeywayToken: "stored-jwt"}}

	t.Run("KEYWAY_TOKEN wins over the stored credentials", func(t *testing.T) {
		t.Setenv("KEYWAY_TOKEN", "kw_live_env")
		if got, err := resolveToken(stored); err != nil || got != "kw_live_env" {
			t.Errorf("resolveToken() = %q, %v; want kw_live_env, nil", got, err)
		}
	})

	t.Run("a GitHub token in KEYWAY_TOKEN is refused even with valid stored credentials", func(t *testing.T) {
		t.Setenv("KEYWAY_TOKEN", githubTokens[0])
		if got, err := resolveToken(stored); err == nil || got != "" {
			t.Errorf("resolveToken() = %q, %v; want an error", got, err)
		}
	})

	t.Run("stored credentials", func(t *testing.T) {
		t.Setenv("KEYWAY_TOKEN", "")
		if got, err := resolveToken(stored); err != nil || got != "stored-jwt" {
			t.Errorf("resolveToken() = %q, %v; want stored-jwt, nil", got, err)
		}
	})

	t.Run("nothing to resolve", func(t *testing.T) {
		t.Setenv("KEYWAY_TOKEN", "")
		if got, err := resolveToken(&MockAuthStore{}); err != nil || got != "" {
			t.Errorf("resolveToken() = %q, %v; want empty, nil", got, err)
		}
	})
}
