package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/spf13/cobra"
)

var pushCmd = &cobra.Command{
	Use:   "push",
	Short: "Upload secrets from an env file to the vault",
	Long:  `Upload secrets from a local .env file to the Keyway vault.`,
	RunE:  runPush,
}

func init() {
	pushCmd.Flags().StringP("env", "e", "", "Environment name")
	pushCmd.Flags().StringP("file", "f", "", "Env file to push")
	pushCmd.Flags().BoolP("yes", "y", false, "Skip confirmation prompt")
}

func runPush(cmd *cobra.Command, args []string) error {
	ui.Intro("push")

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

	envName, _ := cmd.Flags().GetString("env")
	file, _ := cmd.Flags().GetString("file")
	yes, _ := cmd.Flags().GetBool("yes")
	envFlagSet := cmd.Flags().Changed("env")

	// Discover env files
	candidates := env.Discover()

	if len(candidates) == 0 && file == "" {
		if !ui.IsInteractive() {
			ui.Error("No .env file found")
			return fmt.Errorf("no .env file found")
		}
		create, _ := ui.Confirm("No .env file found. Create one?", true)
		if create {
			if err := os.WriteFile(".env", []byte("# Add your environment variables here\n# Example: API_KEY=your-api-key\n"), 0600); err != nil {
				return err
			}
			ui.Success("Created .env file")
			ui.Message(ui.Dim("Add your variables and run keyway push again"))
		}
		return nil
	}

	// Select file if not specified
	if file == "" && ui.IsInteractive() && len(candidates) > 1 {
		options := make([]string, len(candidates))
		for i, c := range candidates {
			options[i] = fmt.Sprintf("%s (env: %s)", c.File, c.Env)
		}
		selected, err := ui.Select("Select an env file to push:", options)
		if err != nil {
			return err
		}
		for _, c := range candidates {
			if strings.HasPrefix(selected, c.File) {
				file = c.File
				if envName == "" {
					envName = c.Env
				}
				break
			}
		}
	}

	// Defaults
	if file == "" {
		if len(candidates) > 0 {
			file = candidates[0].File
			if envName == "" {
				envName = candidates[0].Env
			}
		} else {
			file = ".env"
		}
	}
	if envName == "" {
		envName = env.DeriveEnvFromFile(file)
	}

	// Read file
	content, err := os.ReadFile(file)
	if err != nil {
		ui.Error(fmt.Sprintf("File not found: %s", file))
		return err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		ui.Error(fmt.Sprintf("File is empty: %s", file))
		return fmt.Errorf("file is empty")
	}

	secrets := env.Parse(string(content))
	if len(secrets) == 0 {
		ui.Error("No valid environment variables found in file")
		return fmt.Errorf("no variables found")
	}

	ui.Step(fmt.Sprintf("File: %s", ui.File(file)))
	ui.Step(fmt.Sprintf("Variables: %s", ui.Value(len(secrets))))

	repo, err := git.DetectRepo()
	if err != nil {
		ui.Error("Not in a git repository with GitHub remote")
		return err
	}
	ui.Step(fmt.Sprintf("Repository: %s", ui.Value(repo)))

	token, err := EnsureLogin()
	if err != nil {
		ui.Error(err.Error())
		return err
	}

	client := api.NewClient(token)
	ctx := context.Background()

	// Prompt for environment if not specified
	if !envFlagSet && ui.IsInteractive() {
		// Fetch available environments
		vaultEnvs, err := client.GetVaultEnvironments(ctx, repo)
		if err != nil || len(vaultEnvs) == 0 {
			vaultEnvs = []string{"development", "staging", "production"}
		}

		// Find current env in list or add it
		derivedEnv := envName
		found := false
		for _, e := range vaultEnvs {
			if e == derivedEnv {
				found = true
				break
			}
		}
		if !found && derivedEnv != "" {
			vaultEnvs = append([]string{derivedEnv}, vaultEnvs...)
		}

		// Put derived env first
		for i, e := range vaultEnvs {
			if e == derivedEnv {
				if i > 0 {
					vaultEnvs[0], vaultEnvs[i] = vaultEnvs[i], vaultEnvs[0]
				}
				break
			}
		}

		selected, err := ui.Select("Push to environment:", vaultEnvs)
		if err != nil {
			return err
		}
		envName = selected
	}

	ui.Step(fmt.Sprintf("Environment: %s", ui.Value(envName)))

	// Fetch current vault state to show preview
	var vaultSecrets map[string]string
	err = ui.Spin("Fetching current vault state...", func() error {
		resp, err := client.PullSecrets(ctx, repo, envName)
		if err != nil {
			// Vault might not exist yet, that's ok
			if apiErr, ok := err.(*api.APIError); ok && apiErr.StatusCode == 404 {
				vaultSecrets = make(map[string]string)
				return nil
			}
			return err
		}
		vaultSecrets = env.Parse(resp.Content)
		return nil
	})

	if err != nil {
		if apiErr, ok := err.(*api.APIError); ok {
			ui.Error(apiErr.Error())
		} else {
			ui.Error(err.Error())
		}
		return err
	}

	// Calculate and show diff
	diff := env.CalculatePushDiff(secrets, vaultSecrets)

	if diff.HasChanges() {
		// Show additions and updates
		if len(diff.Added) > 0 || len(diff.Changed) > 0 {
			ui.Message("")
			ui.Message("Will be pushed to vault:")
			for _, key := range diff.Added {
				ui.DiffAdded(key)
			}
			for _, key := range diff.Changed {
				ui.DiffChanged(key)
			}
		}

		// Show removals separately (soft-delete to trash)
		if len(diff.Removed) > 0 {
			ui.Message("")
			ui.Message("Will be moved to trash (not in local file):")
			for _, key := range diff.Removed {
				ui.DiffRemoved(key)
			}
		}
		ui.Message("")
	} else {
		ui.Info("No changes detected")
	}

	// Confirm
	if !yes && ui.IsInteractive() {
		confirm, _ := ui.Confirm(fmt.Sprintf("Push %d secrets from %s to %s?", len(secrets), file, repo), true)
		if !confirm {
			ui.Warn("Push aborted.")
			return nil
		}
	} else if !yes {
		return fmt.Errorf("confirmation required - use --yes in non-interactive mode")
	}

	// Track push event
	analytics.Track(analytics.EventPush, map[string]interface{}{
		"repoFullName":  repo,
		"environment":   envName,
		"variableCount": len(secrets),
	})

	var resp *api.PushSecretsResponse
	err = ui.Spin("Uploading secrets...", func() error {
		var err error
		resp, err = client.PushSecrets(ctx, repo, envName, secrets)
		return err
	})

	if err != nil {
		analytics.Track(analytics.EventError, map[string]interface{}{
			"command": "push",
			"error":   err.Error(),
		})
		if apiErr, ok := err.(*api.APIError); ok {
			ui.Error(apiErr.Error())
			if apiErr.UpgradeURL != "" {
				analytics.Track(analytics.EventUpgradePrompt, map[string]interface{}{
					"reason":  "push_error",
					"command": "push",
				})
				ui.Message(fmt.Sprintf("Upgrade: %s", ui.Link(apiErr.UpgradeURL)))
			}
		} else {
			ui.Error(err.Error())
		}
		return err
	}

	ui.Success(resp.Message)
	if resp.Stats != nil {
		parts := []string{}
		if resp.Stats.Created > 0 {
			parts = append(parts, fmt.Sprintf("+%d created", resp.Stats.Created))
		}
		if resp.Stats.Updated > 0 {
			parts = append(parts, fmt.Sprintf("~%d updated", resp.Stats.Updated))
		}
		if resp.Stats.Deleted > 0 {
			parts = append(parts, fmt.Sprintf("-%d deleted", resp.Stats.Deleted))
		}
		if len(parts) > 0 {
			ui.Message(fmt.Sprintf("Stats: %s", strings.Join(parts, ", ")))
		}
	}

	dashboardURL := fmt.Sprintf("https://www.keyway.sh/dashboard/vaults/%s", repo)
	ui.Outro(fmt.Sprintf("Dashboard: %s", ui.Link(dashboardURL)))

	return nil
}
