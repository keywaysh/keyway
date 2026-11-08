package cmd

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/auth"
	"github.com/keywaysh/cli/internal/config"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/pkg/browser"
	"github.com/spf13/cobra"
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with GitHub via Keyway",
	Long: `Authenticate with GitHub in your browser (device flow).

In CI, set KEYWAY_TOKEN to a Keyway API key (kw_live_…) created in the dashboard.`,
	RunE: runLogin,
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Clear stored Keyway credentials",
	RunE:  runLogout,
}

func init() {
	// Kept so scripts that still pass --token get an explanation instead of "unknown flag"
	loginCmd.Flags().Bool("token", false, "Removed: GitHub personal access tokens are no longer supported")
	_ = loginCmd.Flags().MarkHidden("token")
}

func runLogin(cmd *cobra.Command, args []string) error {
	ui.Intro("login")

	if useToken, _ := cmd.Flags().GetBool("token"); useToken {
		err := tokenLoginRemovedError()
		ui.Error(err.Error())
		return err
	}

	if _, err := RunDeviceLogin(); err != nil {
		ui.Error(err.Error())
		return err
	}

	ui.Outro("Ready to sync secrets!")
	return nil
}

// getRepoIdsWithFallback tries to get repo IDs from backend first, then GitHub public API
func getRepoIdsWithFallback(ctx context.Context, repoFullName string) *api.RepoIds {
	return getRepoIdsWithFallbackAndDeps(ctx, repoFullName, defaultDeps)
}

func getRepoIdsWithFallbackAndDeps(ctx context.Context, repoFullName string, deps *Dependencies) *api.RepoIds {
	if repoFullName == "" {
		return nil
	}

	parts := strings.Split(repoFullName, "/")
	if len(parts) != 2 {
		return nil
	}
	owner, repo := parts[0], parts[1]

	// 1. Try backend (works for private repos if app installed with "all repos")
	client := deps.APIFactory.NewClient("")
	ids, _ := client.GetRepoIdsFromBackend(ctx, repoFullName)
	if ids != nil {
		return ids
	}

	// 2. Fallback: GitHub public API (public repos only)
	ids, _ = api.GetRepoIdsFromGitHub(ctx, owner, repo)
	return ids
}

// RunDeviceLogin runs the device login flow and returns the token
func RunDeviceLogin() (string, error) {
	ctx := context.Background()
	client := api.NewClient("")

	// Detect repo for better UX
	repo, _ := git.DetectRepo()

	// Get repo IDs for deep linking (best effort)
	repoIds := getRepoIdsWithFallback(ctx, repo)

	start, err := client.StartDeviceLogin(ctx, repo, repoIds)
	if err != nil {
		return "", fmt.Errorf("failed to start login: %w", err)
	}

	verifyURL := start.VerificationURIComplete
	if verifyURL == "" {
		verifyURL = start.VerificationURI
	}

	ui.Step(fmt.Sprintf("Code: %s", ui.Bold(start.UserCode)))
	ui.Message(ui.Dim(fmt.Sprintf("Open: %s", verifyURL)))
	ui.Message(ui.Dim("If the browser doesn't open, copy the URL above and paste it in your browser."))

	// Try to open browser (in goroutine to avoid blocking in headless/CLI environments)
	go func() {
		_ = browser.OpenURL(verifyURL)
	}()

	pollInterval := time.Duration(start.Interval) * time.Second
	if pollInterval < 3*time.Second {
		pollInterval = 5 * time.Second
	}

	timeout := time.Duration(start.ExpiresIn) * time.Second
	if timeout == 0 || timeout > 30*time.Minute {
		timeout = 30 * time.Minute
	}

	deadline := time.Now().Add(timeout)

	var token string
	var githubLogin string
	var expiresAt string

	err = ui.Spin("Waiting for authorization...", func() error {
		for time.Now().Before(deadline) {
			time.Sleep(pollInterval)

			result, err := client.PollDeviceLogin(ctx, start.DeviceCode)
			if err != nil {
				// Continue polling on errors (network issues, etc.)
				continue
			}

			switch result.Status {
			case "approved":
				if result.KeywayToken == "" {
					continue
				}
				token = result.KeywayToken
				githubLogin = result.GitHubLogin
				expiresAt = result.ExpiresAt
				return nil
			case "expired":
				return fmt.Errorf("login code expired")
			case "denied":
				return fmt.Errorf("login denied")
			}
			// status == "pending", continue polling
		}
		return fmt.Errorf("login timed out")
	})

	if err != nil {
		return "", err
	}

	// Save token
	store := auth.NewStore()
	if err := store.SaveAuth(token, githubLogin, expiresAt); err != nil {
		return "", fmt.Errorf("failed to save credentials: %w", err)
	}

	// Track login event
	analytics.Track(analytics.EventLogin, map[string]interface{}{
		"method": "device",
		"repo":   repo,
	})

	// Identify user
	if githubLogin != "" {
		analytics.Identify(githubLogin, map[string]interface{}{
			"github_username": githubLogin,
			"login_method":    "device",
		})
		ui.Success(fmt.Sprintf("Logged in as %s", ui.Value("@"+githubLogin)))
	} else {
		ui.Success("Logged in!")
	}

	return token, nil
}

func runLogout(cmd *cobra.Command, args []string) error {
	ui.Intro("logout")

	store := auth.NewStore()
	if err := store.ClearAuth(); err != nil {
		ui.Error(err.Error())
		return err
	}

	ui.Success("Logged out of Keyway")
	ui.Message(ui.Dim(fmt.Sprintf("Auth cache cleared: %s", store.GetConfigPath())))

	return nil
}

// EnsureLogin ensures the user is logged in, prompting if necessary
func EnsureLogin() (string, error) {
	token, err := resolveToken(defaultDeps.AuthStore)
	if err != nil || token != "" {
		return token, err
	}

	// Need to login
	if !ui.IsInteractive() {
		return "", fmt.Errorf("no Keyway session found - run 'keyway login' to authenticate")
	}

	proceed, _ := ui.Confirm("No Keyway session found. Open browser to sign in?", true)
	if !proceed {
		return "", fmt.Errorf("login required")
	}

	return RunDeviceLogin()
}

// resolveToken returns the token commands authenticate with: KEYWAY_TOKEN, else the stored
// credentials, or "" when there is neither. It refuses GitHub tokens before they reach the API.
func resolveToken(store AuthStore) (string, error) {
	if token := config.GetToken(); token != "" {
		if isGitHubToken(token) {
			return "", envGitHubTokenError()
		}
		return token, nil
	}

	storedAuth, err := store.GetAuth()
	if err != nil || storedAuth == nil || storedAuth.KeywayToken == "" {
		return "", nil
	}
	if isGitHubToken(storedAuth.KeywayToken) {
		return "", storedGitHubTokenError()
	}
	return storedAuth.KeywayToken, nil
}

// githubTokenPrefixes: classic and fine-grained PATs, OAuth, user-to-server, installation and
// refresh tokens. The API does not accept GitHub tokens as an identity: it checks repo access
// with the Keyway GitHub App and the username, so any GitHub token (another app's OAuth token, a
// PAT without permissions) would otherwise unlock every vault its owner can reach.
var githubTokenPrefixes = []string{"ghp_", "github_pat_", "gho_", "ghu_", "ghs_", "ghr_"}

func isGitHubToken(token string) bool {
	token = strings.TrimSpace(token)
	for _, prefix := range githubTokenPrefixes {
		if strings.HasPrefix(token, prefix) {
			return true
		}
	}
	return false
}

func apiKeysURL() string {
	return strings.TrimSuffix(config.GetDashboardURL(), "/") + "/api-keys"
}

// tokenLoginRemovedError is returned by `keyway login --token`.
func tokenLoginRemovedError() error {
	return fmt.Errorf("GitHub personal access tokens are no longer supported: run `keyway login` to sign in with your browser, or create an API key at %s and set KEYWAY_TOKEN=kw_live_…", apiKeysURL())
}

func envGitHubTokenError() error {
	return fmt.Errorf("KEYWAY_TOKEN holds a GitHub token, which Keyway no longer accepts: create an API key at %s and set KEYWAY_TOKEN=kw_live_…, or unset KEYWAY_TOKEN and run `keyway login`", apiKeysURL())
}

func storedGitHubTokenError() error {
	return errors.New("GitHub personal access tokens are no longer supported and you are signed in with one: run `keyway login` again to sign in with your browser")
}
