package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/config"
	"github.com/keywaysh/cli/internal/version"
	"github.com/spf13/cobra"
)

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Run environment checks to ensure Keyway runs smoothly",
	Long:  `Run diagnostic checks on your environment to identify potential issues with Keyway.`,
	RunE:  runDoctor,
}

func init() {
	doctorCmd.Flags().Bool("json", false, "Output results as JSON")
	doctorCmd.Flags().Bool("strict", false, "Treat warnings as failures")
}

type checkResult struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"` // pass, warn, fail
	Detail string `json:"detail,omitempty"`
}

type doctorSummary struct {
	Checks  []checkResult `json:"checks"`
	Summary struct {
		Pass int `json:"pass"`
		Warn int `json:"warn"`
		Fail int `json:"fail"`
	} `json:"summary"`
	ExitCode int `json:"exitCode"`
}

// DoctorOptions contains the parsed flags for the doctor command
type DoctorOptions struct {
	JSONOutput bool
	Strict     bool
	Version    string
}

// runDoctor is the entry point for the doctor command (uses default dependencies)
func runDoctor(cmd *cobra.Command, args []string) error {
	opts := DoctorOptions{}
	opts.JSONOutput, _ = cmd.Flags().GetBool("json")
	opts.Strict, _ = cmd.Flags().GetBool("strict")
	opts.Version = rootCmd.Version

	return runDoctorWithDeps(opts, defaultDeps)
}

// runDoctorWithDeps is the testable version of runDoctor
func runDoctorWithDeps(opts DoctorOptions, deps *Dependencies) error {
	if !opts.JSONOutput {
		deps.UI.Intro("doctor")
	}

	checks := []checkResult{}

	// 1. Version check
	versionCheck := checkVersion(opts.Version)
	checks = append(checks, versionCheck)

	// 2. Authentication check
	authCheck := checkAuthWithDeps(deps)
	checks = append(checks, authCheck)

	// 3. GitHub repository check
	githubCheck := checkGitHubWithDeps(deps)
	checks = append(checks, githubCheck)

	// 4. Network/API check
	networkCheck := checkNetworkWithDeps(deps)
	checks = append(checks, networkCheck)

	// 5. Env file check
	envCheck := checkEnvFileWithDeps(deps)
	checks = append(checks, envCheck)

	// 6. Gitignore check
	gitignoreCheck := checkGitignoreWithDeps(deps)
	checks = append(checks, gitignoreCheck)

	// Apply strict mode
	if opts.Strict {
		for i := range checks {
			if checks[i].Status == "warn" {
				checks[i].Status = "fail"
			}
		}
	}

	// Calculate summary
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
	summary.ExitCode = 0
	if summary.Summary.Fail > 0 {
		summary.ExitCode = 1
	}

	// Track doctor event
	analytics.Track(analytics.EventDoctor, map[string]interface{}{
		"pass":   summary.Summary.Pass,
		"warn":   summary.Summary.Warn,
		"fail":   summary.Summary.Fail,
		"strict": opts.Strict,
	})

	// Output
	if opts.JSONOutput {
		output, _ := json.MarshalIndent(summary, "", "  ")
		fmt.Println(string(output))
	} else {
		for _, c := range checks {
			switch c.Status {
			case "pass":
				deps.UI.Success(fmt.Sprintf("%s: %s", c.Name, c.Detail))
			case "warn":
				deps.UI.Warn(fmt.Sprintf("%s: %s", c.Name, c.Detail))
			case "fail":
				deps.UI.Error(fmt.Sprintf("%s: %s", c.Name, c.Detail))
			}
		}

		fmt.Println()
		deps.UI.Message(fmt.Sprintf("Results: %d passed, %d warnings, %d failed",
			summary.Summary.Pass, summary.Summary.Warn, summary.Summary.Fail))
	}

	if summary.ExitCode != 0 {
		return fmt.Errorf("doctor found issues")
	}
	return nil
}

func checkAuthWithDeps(deps *Dependencies) checkResult {
	storedAuth, err := deps.AuthStore.GetAuth()

	if err != nil || storedAuth == nil {
		return checkResult{
			ID:     "auth",
			Name:   "Authentication",
			Status: "warn",
			Detail: "Not logged in. Run: keyway login",
		}
	}

	// Validate token
	client := deps.APIFactory.NewClient(storedAuth.KeywayToken)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	validation, err := client.ValidateToken(ctx)
	if err != nil {
		return checkResult{
			ID:     "auth",
			Name:   "Authentication",
			Status: "warn",
			Detail: fmt.Sprintf("Token expired or invalid (%v). Run: keyway login", err),
		}
	}

	username := validation.Username
	if username == "" {
		username = storedAuth.GitHubLogin
	}
	if username == "" {
		username = "user"
	}

	return checkResult{
		ID:     "auth",
		Name:   "Authentication",
		Status: "pass",
		Detail: fmt.Sprintf("Logged in as %s", username),
	}
}

func checkGitHubWithDeps(deps *Dependencies) checkResult {
	if !deps.Git.IsGitRepository() {
		return checkResult{
			ID:     "github",
			Name:   "GitHub repository",
			Status: "warn",
			Detail: "Not in a git repository",
		}
	}

	repo, err := deps.Git.DetectRepo()
	if err != nil {
		return checkResult{
			ID:     "github",
			Name:   "GitHub repository",
			Status: "warn",
			Detail: "No GitHub remote configured",
		}
	}

	return checkResult{
		ID:     "github",
		Name:   "GitHub repository",
		Status: "pass",
		Detail: repo,
	}
}

func checkNetworkWithDeps(deps *Dependencies) checkResult {
	healthURL := config.GetAPIURL() + "/v1/health"

	statusCode, err := deps.HTTP.Head(healthURL)

	if err != nil {
		return checkResult{
			ID:     "network",
			Name:   "API connectivity",
			Status: "warn",
			Detail: "Cannot connect to API server",
		}
	}

	if statusCode >= 500 {
		return checkResult{
			ID:     "network",
			Name:   "API connectivity",
			Status: "warn",
			Detail: fmt.Sprintf("Server returned %d", statusCode),
		}
	}

	return checkResult{
		ID:     "network",
		Name:   "API connectivity",
		Status: "pass",
		Detail: fmt.Sprintf("Connected to %s", config.GetAPIURL()),
	}
}

func checkEnvFileWithDeps(deps *Dependencies) checkResult {
	envFiles := []string{".env", ".env.local", ".env.development", ".env.production"}
	found := []string{}

	for _, f := range envFiles {
		if _, err := deps.Stat.Stat(f); err == nil {
			found = append(found, f)
		}
	}

	if len(found) == 0 {
		return checkResult{
			ID:     "envfile",
			Name:   "Environment file",
			Status: "warn",
			Detail: "No .env file found. Run: keyway pull",
		}
	}

	return checkResult{
		ID:     "envfile",
		Name:   "Environment file",
		Status: "pass",
		Detail: fmt.Sprintf("Found: %s", found[0]),
	}
}

func checkGitignoreWithDeps(deps *Dependencies) checkResult {
	if !deps.Git.IsGitRepository() {
		return checkResult{
			ID:     "gitignore",
			Name:   ".gitignore",
			Status: "pass",
			Detail: "Not in a git repository",
		}
	}

	if deps.Git.CheckEnvGitignore() {
		return checkResult{
			ID:     "gitignore",
			Name:   ".gitignore",
			Status: "pass",
			Detail: "Environment files are ignored",
		}
	}

	return checkResult{
		ID:     "gitignore",
		Name:   ".gitignore",
		Status: "warn",
		Detail: "Missing .env patterns in .gitignore",
	}
}

func checkVersion(currentVersion string) checkResult {
	ctx, cancel := context.WithTimeout(context.Background(), version.CheckTimeout)
	defer cancel()

	info := version.CheckForUpdate(ctx, currentVersion)
	if info != nil && info.Available {
		return checkResult{
			ID:     "version",
			Name:   "CLI version",
			Status: "warn",
			Detail: fmt.Sprintf("%s available (current: %s). Run: %s", info.LatestVersion, info.CurrentVersion, info.UpdateCommand),
		}
	}

	return checkResult{
		ID:     "version",
		Name:   "CLI version",
		Status: "pass",
		Detail: fmt.Sprintf("%s (latest)", currentVersion),
	}
}
