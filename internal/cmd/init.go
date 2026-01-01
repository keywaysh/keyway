package cmd

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
	"github.com/spf13/cobra"
)

const dashboardURL = "https://www.keyway.sh/dashboard/vaults"

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialize a vault for the current repository",
	Long:  `Initialize a new Keyway vault for the current GitHub repository.`,
	RunE:  runInit,
}

// InitOptions contains the parsed flags for the init command
type InitOptions struct {
	// No flags currently
}

// runInit is the entry point for the init command (uses default dependencies)
func runInit(cmd *cobra.Command, args []string) error {
	opts := InitOptions{}
	return runInitWithDeps(opts, defaultDeps)
}

// runInitWithDeps is the testable version of runInit
func runInitWithDeps(opts InitOptions, deps *Dependencies) error {
	deps.UI.Intro("init")

	// Check gitignore
	if !deps.Git.CheckEnvGitignore() {
		deps.UI.Warn(".env files are not in .gitignore - secrets may be committed")
		if deps.UI.IsInteractive() {
			add, _ := deps.UI.Confirm("Add .env* to .gitignore?", true)
			if add {
				if err := deps.Git.AddEnvToGitignore(); err == nil {
					deps.UI.Success("Added .env* to .gitignore")
				}
			}
		}
	}

	repo, err := deps.Git.DetectRepo()
	if err != nil {
		deps.UI.Error("Not in a git repository with GitHub remote")
		return err
	}
	deps.UI.Step(fmt.Sprintf("Repository: %s", deps.UI.Value(repo)))

	// Check for monorepo setup and warn user
	monorepoInfo := deps.Git.DetectMonorepo()
	if monorepoInfo.IsMonorepo {
		analytics.Track(analytics.EventMonorepoDetected, map[string]interface{}{
			"repo": repo,
			"tool": monorepoInfo.Tool,
		})
		deps.UI.Warn(fmt.Sprintf("Monorepo detected (%s)", monorepoInfo.Tool))
		deps.UI.Message(deps.UI.Dim("Keyway doesn't fully support monorepos yet — secrets are shared across the entire repository."))
		deps.UI.Message(deps.UI.Dim("If per-package secrets management is important to you, let us know:"))
		deps.UI.Message(deps.UI.Dim(fmt.Sprintf("  → %s", deps.UI.Link("https://github.com/keywaysh/feedback/issues"))))
		deps.UI.Message("")
	}

	// Ensure login and GitHub App
	token, err := ensureLoginAndGitHubAppWithDeps(repo, deps)
	if err != nil {
		deps.UI.Error(err.Error())
		return err
	}

	client := deps.APIFactory.NewClient(token)
	ctx := context.Background()

	// Check if vault already exists
	exists, err := client.CheckVaultExists(ctx, repo)
	if err != nil {
		// Handle auth errors (expired token)
		if isAuthError(err) {
			newToken, authErr := handleAuthError(err, deps)
			if authErr != nil {
				return authErr
			}
			// Retry with new token
			token = newToken
			client = deps.APIFactory.NewClient(token)
			exists, err = client.CheckVaultExists(ctx, repo)
		}
	}
	if err == nil && exists {
		deps.UI.Success("Already initialized!")

		// Still try to add badge if not present
		badgeAdded, _ := AddBadgeToReadme(true)
		if badgeAdded {
			analytics.Track(analytics.EventReadmeBadge, map[string]interface{}{
				"repo":        repo,
				"badge_added": true,
				"source":      "init-existing",
			})
			deps.UI.Success("Added Keyway badge to README")
		}

		deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Run %s to sync your secrets", deps.UI.Command("keyway push"))))
		deps.UI.Outro(fmt.Sprintf("Dashboard: %s", deps.UI.Link(dashboardURL+"/"+repo)))
		return nil
	}

	// Track init event
	analytics.Track(analytics.EventInit, map[string]interface{}{
		"repoFullName":       repo,
		"githubAppInstalled": true,
	})

	// Create vault
	err = deps.UI.Spin("Creating vault...", func() error {
		_, err := client.InitVault(ctx, repo)
		return err
	})

	if err != nil {
		if apiErr, ok := err.(*api.APIError); ok {
			// Handle auth errors (expired token)
			if apiErr.StatusCode == 401 {
				newToken, authErr := handleAuthError(err, deps)
				if authErr != nil {
					return authErr
				}
				// Retry with new token
				client = deps.APIFactory.NewClient(newToken)
				err = deps.UI.Spin("Creating vault...", func() error {
					_, err := client.InitVault(ctx, repo)
					return err
				})
				if err == nil {
					goto vaultCreated
				}
				// If still error, continue to handle it
				apiErr, ok = err.(*api.APIError)
				if !ok {
					deps.UI.Error(err.Error())
					return err
				}
			}

			// Already exists (409 Conflict)
			if apiErr.StatusCode == 409 {
				deps.UI.Success("Already initialized!")

				// Still try to add badge if not present
				badgeAdded, _ := AddBadgeToReadme(true)
				if badgeAdded {
					analytics.Track(analytics.EventReadmeBadge, map[string]interface{}{
						"repo":        repo,
						"badge_added": true,
						"source":      "init-conflict",
					})
					deps.UI.Success("Added Keyway badge to README")
				}

				deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Run %s to sync your secrets", deps.UI.Command("keyway push"))))
				deps.UI.Outro(fmt.Sprintf("Dashboard: %s", deps.UI.Link(dashboardURL+"/"+repo)))
				return nil
			}

			// Check if trial is available (from structured error response)
			if apiErr.StatusCode == 403 && apiErr.TrialInfo != nil && apiErr.TrialInfo.Eligible && deps.UI.IsInteractive() {
				trialInfo := apiErr.TrialInfo
				deps.UI.Warn("This repository belongs to an organization on the Free plan")
				deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Private organization repos require a Team plan, but you can start a %d-day free trial.", trialInfo.DaysAvailable)))

				startTrial, _ := deps.UI.Confirm(fmt.Sprintf("Start %d-day free trial for %s?", trialInfo.DaysAvailable, trialInfo.OrgLogin), true)
				if startTrial {
					var trialResult *api.StartTrialResponse
					trialErr := deps.UI.Spin("Starting trial...", func() error {
						var err error
						trialResult, err = client.StartOrganizationTrial(ctx, trialInfo.OrgLogin)
						return err
					})

					if trialErr != nil {
						deps.UI.Error(fmt.Sprintf("Failed to start trial: %s", trialErr.Error()))
						return trialErr
					}

					deps.UI.Success(trialResult.Message)

					// Retry vault creation now that trial is active
					err = deps.UI.Spin("Creating vault...", func() error {
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
			deps.UI.Error(apiErr.Error())
			if apiErr.UpgradeURL != "" {
				deps.UI.Message(fmt.Sprintf("Upgrade: %s", deps.UI.Link(apiErr.UpgradeURL)))
			}
		} else {
			analytics.Track(analytics.EventError, map[string]interface{}{
				"command": "init",
				"error":   err.Error(),
			})
			deps.UI.Error(err.Error())
		}
		return err
	}

vaultCreated:

	deps.UI.Success("Vault created!")

	// Add badge to README (silent mode)
	badgeAdded, _ := AddBadgeToReadme(true)
	if badgeAdded {
		analytics.Track(analytics.EventReadmeBadge, map[string]interface{}{
			"repo":        repo,
			"badge_added": true,
			"source":      "init",
		})
		deps.UI.Success("Added Keyway badge to README")
	}

	// Check for env files and offer to push
	candidates := deps.Env.Discover()
	if len(candidates) > 0 && deps.UI.IsInteractive() {
		deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Found %d env file(s): %s", len(candidates), formatEnvCandidates(candidates))))

		shouldPush, _ := deps.UI.Confirm("Push secrets now?", true)
		if shouldPush {
			// Run push command with deps
			return runPushWithDeps(PushOptions{}, deps)
		}
	} else if len(candidates) == 0 {
		if deps.UI.IsInteractive() {
			create, _ := deps.UI.Confirm("No .env file found. Create one?", true)
			if create {
				if err := deps.FS.WriteFile(".env", []byte("# Add your environment variables here\n"), 0600); err == nil {
					deps.UI.Success("Created .env file")
				}
			}
		}
		deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Add your variables and run %s", deps.UI.Command("keyway push"))))
	} else {
		deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Run %s to sync your secrets", deps.UI.Command("keyway push"))))
	}

	deps.UI.Outro(fmt.Sprintf("Dashboard: %s", deps.UI.Link(dashboardURL+"/"+repo)))
	return nil
}

// formatEnvCandidates formats EnvCandidate slice for display
func formatEnvCandidates(candidates []EnvCandidate) string {
	names := make([]string, len(candidates))
	for i, c := range candidates {
		names[i] = c.File
	}
	return strings.Join(names, ", ")
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

func ensureLoginAndGitHubAppWithDeps(repo string, deps *Dependencies) (string, error) {
	// First ensure login
	token, err := deps.Auth.EnsureLogin()
	if err != nil {
		return "", err
	}

	// Check GitHub App installation
	parts := strings.Split(repo, "/")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid repository format: %s", repo)
	}

	client := deps.APIFactory.NewClient(token)
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
	deps.UI.Warn("GitHub App not installed for this repository")
	deps.UI.Message(deps.UI.Dim("The Keyway GitHub App is required for secure access."))

	// Get repo IDs for deep linking
	repoIds := getRepoIdsWithFallbackAndDeps(ctx, repo, deps)
	installURL := buildDeepLinkInstallURL(status.InstallURL, repoIds)

	if !deps.UI.IsInteractive() {
		deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Install: %s", installURL)))
		return "", fmt.Errorf("GitHub App installation required")
	}

	install, _ := deps.UI.Confirm("Open browser to install GitHub App?", true)
	if !install {
		deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Install later: %s", installURL)))
		return "", fmt.Errorf("GitHub App installation required")
	}

	_ = deps.Browser.OpenURL(installURL)

	// Poll for installation (user completes installation in browser)
	const pollInterval = 3 * time.Second
	const pollTimeout = 2 * time.Minute
	const maxConsecutiveErrors = 5

	err = deps.UI.Spin("Waiting for GitHub App installation...", func() error {
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

	deps.UI.Success("GitHub App installed!")
	return token, nil
}

func formatCandidates(candidates []env.Candidate) string {
	names := make([]string, len(candidates))
	for i, c := range candidates {
		names[i] = c.File
	}
	return strings.Join(names, ", ")
}
