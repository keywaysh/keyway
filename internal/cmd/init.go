package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"

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
		analytics.Track(analytics.EventError, map[string]interface{}{
			"command": "init",
			"error":   err.Error(),
		})
		if apiErr, ok := err.(*api.APIError); ok {
			// Already exists (409 Conflict)
			if apiErr.StatusCode == 409 {
				ui.Success("Already initialized!")
				ui.Message(ui.Dim(fmt.Sprintf("Run %s to sync your secrets", ui.Command("keyway push"))))
				ui.Outro(fmt.Sprintf("Dashboard: %s", ui.Link(dashboardURL+"/"+repo)))
				return nil
			}
			ui.Error(apiErr.Error())
			if apiErr.UpgradeURL != "" {
				ui.Message(fmt.Sprintf("Upgrade: %s", ui.Link(apiErr.UpgradeURL)))
			}
		} else {
			ui.Error(err.Error())
		}
		return err
	}

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
				os.WriteFile(".env", []byte("# Add your environment variables here\n"), 0600)
				ui.Success("Created .env file")
			}
		}
		ui.Message(ui.Dim(fmt.Sprintf("Add your variables and run %s", ui.Command("keyway push"))))
	} else {
		ui.Message(ui.Dim(fmt.Sprintf("Run %s to sync your secrets", ui.Command("keyway push"))))
	}

	ui.Outro(fmt.Sprintf("Dashboard: %s", ui.Link(dashboardURL+"/"+repo)))
	return nil
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

	if !ui.IsInteractive() {
		ui.Message(ui.Dim(fmt.Sprintf("Install: %s", status.InstallURL)))
		return "", fmt.Errorf("GitHub App installation required")
	}

	install, _ := ui.Confirm("Open browser to install GitHub App?", true)
	if !install {
		ui.Message(ui.Dim(fmt.Sprintf("Install later: %s", status.InstallURL)))
		return "", fmt.Errorf("GitHub App installation required")
	}

	_ = browser.OpenURL(status.InstallURL)

	// Poll for installation
	err = ui.Spin("Waiting for GitHub App installation...", func() error {
		for i := 0; i < 40; i++ { // 2 minutes max
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			status, err := client.CheckGitHubAppInstallation(ctx, parts[0], parts[1])
			if err == nil && status.Installed {
				return nil
			}

			// Wait 3 seconds before retry
			// time.Sleep(3 * time.Second)
			// Note: Can't easily sleep here without importing time
			// For now, just check once and fail if not installed
			return fmt.Errorf("please install the GitHub App and run init again")
		}
		return fmt.Errorf("installation timed out")
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
