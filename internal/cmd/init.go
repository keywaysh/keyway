package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/pkg/browser"
	"github.com/spf13/cobra"
)

const dashboardURL = "https://www.keyway.sh/dashboard/vaults"

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialize a vault for the current repository",
	Long:  `Initialize a new Keyway vault for the current GitHub repository.`,
	RunE:  runInit,
}

func runInit(cmd *cobra.Command, args []string) error {
	ui.Intro("init")

	// Check gitignore
	if !git.CheckEnvGitignore() {
		ui.Warn(".env files are not in .gitignore - secrets may be committed")
		if ui.IsInteractive() {
			add, _ := ui.Confirm("Add .env* to .gitignore?", true)
			if add {
				if err := git.AddEnvToGitignore(); err == nil {
					ui.Success("Added .env* to .gitignore")
				}
			}
		}
	}

	repo, err := git.DetectRepo()
	if err != nil {
		ui.Error("Not in a git repository with GitHub remote")
		return err
	}
	ui.Step(fmt.Sprintf("Repository: %s", ui.Value(repo)))

	// Ensure login and GitHub App
	token, err := ensureLoginAndGitHubApp(repo)
	if err != nil {
		ui.Error(err.Error())
		return err
	}

	client := api.NewClient(token)
	ctx := context.Background()

	// Check if vault already exists
	exists, err := client.CheckVaultExists(ctx, repo)
	if err == nil && exists {
		ui.Success("Already initialized!")
		ui.Message(ui.Dim(fmt.Sprintf("Run %s to sync your secrets", ui.Command("keyway push"))))
		ui.Outro(fmt.Sprintf("Dashboard: %s", ui.Link(dashboardURL+"/"+repo)))
		return nil
	}

	// Track init event
	analytics.Track(analytics.EventInit, map[string]interface{}{
		"repoFullName":       repo,
		"githubAppInstalled": true,
	})

	// Create vault
	err = ui.Spin("Creating vault...", func() error {
		_, err := client.InitVault(ctx, repo)
		return err
	})

	if err != nil {
		if apiErr, ok := err.(*api.APIError); ok {
			// Already exists (409 Conflict)
			if apiErr.StatusCode == 409 {
				ui.Success("Already initialized!")
				ui.Message(ui.Dim(fmt.Sprintf("Run %s to sync your secrets", ui.Command("keyway push"))))
				ui.Outro(fmt.Sprintf("Dashboard: %s", ui.Link(dashboardURL+"/"+repo)))
				return nil
			}

			// Check if trial is available (from structured error response)
			if apiErr.StatusCode == 403 && apiErr.TrialInfo != nil && apiErr.TrialInfo.Eligible && ui.IsInteractive() {
				trialInfo := apiErr.TrialInfo
				ui.Warn("This repository belongs to an organization on the Free plan")
				ui.Message(ui.Dim(fmt.Sprintf("Private organization repos require a Team plan, but you can start a %d-day free trial.", trialInfo.DaysAvailable)))

				startTrial, _ := ui.Confirm(fmt.Sprintf("Start %d-day free trial for %s?", trialInfo.DaysAvailable, trialInfo.OrgLogin), true)
				if startTrial {
					var trialResult *api.StartTrialResponse
					trialErr := ui.Spin("Starting trial...", func() error {
						var err error
						trialResult, err = client.StartOrganizationTrial(ctx, trialInfo.OrgLogin)
						return err
					})

					if trialErr != nil {
						ui.Error(fmt.Sprintf("Failed to start trial: %s", trialErr.Error()))
						return trialErr
					}

					ui.Success(trialResult.Message)

					// Retry vault creation now that trial is active
					err = ui.Spin("Creating vault...", func() error {
						_, err := client.InitVault(ctx, repo)
						return err
					})

					if err == nil {
						// Success! Continue with the rest of the flow
						goto vaultCreated
					}
					// If it still fails, fall through to error handling
				}
			}

			analytics.Track(analytics.EventError, map[string]interface{}{
				"command": "init",
				"error":   err.Error(),
			})
			ui.Error(apiErr.Error())
			if apiErr.UpgradeURL != "" {
				ui.Message(fmt.Sprintf("Upgrade: %s", ui.Link(apiErr.UpgradeURL)))
			}
		} else {
			analytics.Track(analytics.EventError, map[string]interface{}{
				"command": "init",
				"error":   err.Error(),
			})
			ui.Error(err.Error())
		}
		return err
	}

vaultCreated:

	ui.Success("Vault created!")

	// Add badge to README (silent mode)
	badgeAdded, _ := AddBadgeToReadme(true)
	if badgeAdded {
		analytics.Track(analytics.EventReadmeBadge, map[string]interface{}{
			"repo":        repo,
			"badge_added": true,
			"source":      "init",
		})
		ui.Success("Added Keyway badge to README")
	}

	// Check for env files and offer to push
	candidates := discoverEnvFiles()
	if len(candidates) > 0 && ui.IsInteractive() {
		ui.Message(ui.Dim(fmt.Sprintf("Found %d env file(s): %s", len(candidates), formatCandidates(candidates))))

		shouldPush, _ := ui.Confirm("Push secrets now?", true)
		if shouldPush {
			// Run push command
			return runPush(pushCmd, nil)
		}
	} else if len(candidates) == 0 {
		if ui.IsInteractive() {
			create, _ := ui.Confirm("No .env file found. Create one?", true)
			if create {
				if err := os.WriteFile(".env", []byte("# Add your environment variables here\n"), 0600); err == nil {
					ui.Success("Created .env file")
				}
			}
		}
		ui.Message(ui.Dim(fmt.Sprintf("Add your variables and run %s", ui.Command("keyway push"))))
	} else {
		ui.Message(ui.Dim(fmt.Sprintf("Run %s to sync your secrets", ui.Command("keyway push"))))
	}

	ui.Outro(fmt.Sprintf("Dashboard: %s", ui.Link(dashboardURL+"/"+repo)))
	return nil
}

// buildDeepLinkInstallURL adds deep linking params to the GitHub App install URL
func buildDeepLinkInstallURL(baseURL string, repoIds *api.RepoIds) string {
	if repoIds == nil {
		return baseURL
	}
	// Format: baseURL/permissions?suggested_target_id=OWNER_ID&repository_ids[]=REPO_ID
	return fmt.Sprintf("%s/permissions?suggested_target_id=%d&repository_ids[]=%d",
		strings.TrimSuffix(baseURL, "/"), repoIds.OwnerID, repoIds.RepoID)
}

func ensureLoginAndGitHubApp(repo string) (string, error) {
	// First ensure login
	token, err := EnsureLogin()
	if err != nil {
		return "", err
	}

	// Check GitHub App installation
	parts := strings.Split(repo, "/")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid repository format: %s", repo)
	}

	client := api.NewClient(token)
	ctx := context.Background()

	status, err := client.CheckGitHubAppInstallation(ctx, parts[0], parts[1])
	if err != nil {
		// If we can't check, continue anyway
		return token, nil
	}

	if status.Installed {
		return token, nil
	}

	// GitHub App not installed
	ui.Warn("GitHub App not installed for this repository")
	ui.Message(ui.Dim("The Keyway GitHub App is required for secure access."))

	// Get repo IDs for deep linking
	repoIds := getRepoIdsWithFallback(ctx, repo)
	installURL := buildDeepLinkInstallURL(status.InstallURL, repoIds)

	if !ui.IsInteractive() {
		ui.Message(ui.Dim(fmt.Sprintf("Install: %s", installURL)))
		return "", fmt.Errorf("GitHub App installation required")
	}

	install, _ := ui.Confirm("Open browser to install GitHub App?", true)
	if !install {
		ui.Message(ui.Dim(fmt.Sprintf("Install later: %s", installURL)))
		return "", fmt.Errorf("GitHub App installation required")
	}

	_ = browser.OpenURL(installURL)

	// Poll for installation (user completes installation in browser)
	const pollInterval = 3 * time.Second
	const pollTimeout = 2 * time.Minute
	const maxConsecutiveErrors = 5

	err = ui.Spin("Waiting for GitHub App installation...", func() error {
		startTime := time.Now()
		consecutiveErrors := 0

		for time.Since(startTime) < pollTimeout {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(pollInterval):
				// Continue polling
			}

			pollStatus, checkErr := client.CheckGitHubAppInstallation(ctx, parts[0], parts[1])
			if checkErr == nil && pollStatus.Installed {
				return nil // Success!
			}

			if checkErr != nil {
				consecutiveErrors++
				if consecutiveErrors >= maxConsecutiveErrors {
					return fmt.Errorf("installation check failed after %d consecutive errors: %w", maxConsecutiveErrors, checkErr)
				}
				// Continue polling on transient errors
			} else {
				consecutiveErrors = 0 // Reset on successful API call (but not installed yet)
			}
		}

		// Timeout
		return fmt.Errorf("timed out waiting for installation (2 minutes)")
	})

	if err != nil {
		return "", err
	}

	ui.Success("GitHub App installed!")
	return token, nil
}

func formatCandidates(candidates []envCandidate) string {
	names := make([]string, len(candidates))
	for i, c := range candidates {
		names[i] = c.file
	}
	return strings.Join(names, ", ")
}
