package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/auth"
	"github.com/keywaysh/cli/internal/config"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
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

func runDoctor(cmd *cobra.Command, args []string) error {
	jsonOutput, _ := cmd.Flags().GetBool("json")
	strict, _ := cmd.Flags().GetBool("strict")

	if !jsonOutput {
		ui.Intro("doctor")
	}

	checks := []checkResult{}

	// 1. Authentication check
	authCheck := checkAuth()
	checks = append(checks, authCheck)

	// 2. GitHub repository check
	githubCheck := checkGitHub()
	checks = append(checks, githubCheck)

	// 3. Network/API check
	networkCheck := checkNetwork()
	checks = append(checks, networkCheck)

	// 4. Env file check
	envCheck := checkEnvFile()
	checks = append(checks, envCheck)

	// 5. Gitignore check
	gitignoreCheck := checkGitignore()
	checks = append(checks, gitignoreCheck)

	// Apply strict mode
	if strict {
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
		"strict": strict,
	})

	// Output
	if jsonOutput {
		output, _ := json.MarshalIndent(summary, "", "  ")
		fmt.Println(string(output))
	} else {
		for _, c := range checks {
			switch c.Status {
			case "pass":
				ui.Success(fmt.Sprintf("%s: %s", c.Name, c.Detail))
			case "warn":
				ui.Warn(fmt.Sprintf("%s: %s", c.Name, c.Detail))
			case "fail":
				ui.Error(fmt.Sprintf("%s: %s", c.Name, c.Detail))
			}
		}

		fmt.Println()
		ui.Message(fmt.Sprintf("Results: %d passed, %d warnings, %d failed",
			summary.Summary.Pass, summary.Summary.Warn, summary.Summary.Fail))
	}

	if summary.ExitCode != 0 {
		return fmt.Errorf("doctor found issues")
	}
	return nil
}

func checkAuth() checkResult {
	store := auth.NewStore()
	storedAuth, err := store.GetAuth()

	if err != nil || storedAuth == nil {
		return checkResult{
			ID:     "auth",
			Name:   "Authentication",
			Status: "warn",
			Detail: "Not logged in. Run: keyway login",
		}
	}

	// Validate token
	client := api.NewClient(storedAuth.KeywayToken)
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

func checkGitHub() checkResult {
	if !git.IsGitRepository() {
		return checkResult{
			ID:     "github",
			Name:   "GitHub repository",
			Status: "warn",
			Detail: "Not in a git repository",
		}
	}

	repo, err := git.DetectRepo()
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

func checkNetwork() checkResult {
	healthURL := config.GetAPIURL() + "/v1/health"

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Head(healthURL)

	if err != nil {
		return checkResult{
			ID:     "network",
			Name:   "API connectivity",
			Status: "warn",
			Detail: "Cannot connect to API server",
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return checkResult{
			ID:     "network",
			Name:   "API connectivity",
			Status: "warn",
			Detail: fmt.Sprintf("Server returned %d", resp.StatusCode),
		}
	}

	return checkResult{
		ID:     "network",
		Name:   "API connectivity",
		Status: "pass",
		Detail: fmt.Sprintf("Connected to %s", config.GetAPIURL()),
	}
}

func checkEnvFile() checkResult {
	envFiles := []string{".env", ".env.local", ".env.development", ".env.production"}
	found := []string{}

	for _, f := range envFiles {
		if _, err := os.Stat(f); err == nil {
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

func checkGitignore() checkResult {
	if !git.IsGitRepository() {
		return checkResult{
			ID:     "gitignore",
			Name:   ".gitignore",
			Status: "pass",
			Detail: "Not in a git repository",
		}
	}

	if git.CheckEnvGitignore() {
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
