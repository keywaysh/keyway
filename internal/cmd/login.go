package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/auth"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/pkg/browser"
	"github.com/spf13/cobra"
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with GitHub via Keyway",
	Long:  `Authenticate with GitHub using the device flow or a personal access token.`,
	RunE:  runLogin,
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Clear stored Keyway credentials",
	RunE:  runLogout,
}

func init() {
	loginCmd.Flags().Bool("token", false, "Authenticate using a GitHub fine-grained PAT")
}

func runLogin(cmd *cobra.Command, args []string) error {
	ui.Intro("login")

	useToken, _ := cmd.Flags().GetBool("token")

	var err error
	if useToken {
		err = runTokenLogin()
	} else {
		_, err = RunDeviceLogin()
	}

	if err != nil {
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

func runTokenLogin() error {
	repo, _ := git.DetectRepo()
	if repo != "" {
		ui.Step(fmt.Sprintf("Detected repository: %s", ui.Value(repo)))
	}

	// Build URL for creating PAT
	description := "Keyway CLI"
	if repo != "" {
		description = fmt.Sprintf("Keyway CLI for %s", repo)
	}
	url := fmt.Sprintf("https://github.com/settings/personal-access-tokens/new?description=%s", description)

	ui.Message(ui.Dim("Opening GitHub to create a fine-grained PAT..."))
	ui.Info("Select the detected repo (or scope manually).")
	ui.Message(ui.Dim("Permissions: Metadata -> Read-only; Account permissions: None."))

	_ = browser.OpenURL(url)

	token, err := ui.Password("Paste your GitHub PAT:")
	if err != nil {
		return err
	}

	token = trimSpace(token)
	if token == "" {
		return fmt.Errorf("token is required")
	}

	if !hasPrefix(token, "github_pat_") {
		return fmt.Errorf("token must start with github_pat_")
	}

	var validation *api.ValidateTokenResponse
	err = ui.Spin("Validating token...", func() error {
		client := api.NewClient(token)
		var err error
		validation, err = client.ValidateToken(context.Background())
		return err
	})

	if err != nil {
		return fmt.Errorf("token validation failed: %w", err)
	}

	store := auth.NewStore()
	if err := store.SaveAuth(token, validation.Username, ""); err != nil {
		return fmt.Errorf("failed to save credentials: %w", err)
	}

	// Track login event
	analytics.Track(analytics.EventLogin, map[string]interface{}{
		"method": "pat",
		"repo":   repo,
	})

	// Identify user with plan info
	analytics.Identify(validation.Username, map[string]interface{}{
		"github_username": validation.Username,
		"login_method":    "pat",
		"plan":            validation.Plan,
		"created_at":      validation.CreatedAt,
	})

	ui.Success(fmt.Sprintf("Logged in as %s", ui.Value("@"+validation.Username)))
	return nil
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
	// Check env var first
	if token := os.Getenv("KEYWAY_TOKEN"); token != "" {
		return token, nil
	}

	// Check stored auth
	store := auth.NewStore()
	storedAuth, err := store.GetAuth()
	if err == nil && storedAuth != nil && storedAuth.KeywayToken != "" {
		return storedAuth.KeywayToken, nil
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

// Helper functions to avoid importing strings package
func trimSpace(s string) string {
	start := 0
	end := len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\n' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\n' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
