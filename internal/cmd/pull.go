package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/spf13/cobra"
)

var pullCmd = &cobra.Command{
	Use:   "pull",
	Short: "Download secrets from the vault to an env file",
	Long:  `Download secrets from the Keyway vault and save them to a local .env file.`,
	RunE:  runPull,
}

func init() {
	pullCmd.Flags().StringP("env", "e", "development", "Environment name")
	pullCmd.Flags().StringP("file", "f", ".env", "Env file to write to")
	pullCmd.Flags().BoolP("yes", "y", false, "Skip confirmation prompt")
	pullCmd.Flags().Bool("force", false, "Replace entire file instead of merging")
}

func runPull(cmd *cobra.Command, args []string) error {
	ui.Intro("pull")

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
	force, _ := cmd.Flags().GetBool("force")
	envFlagSet := cmd.Flags().Changed("env")

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

		// Find default index
		defaultIdx := 0
		for i, e := range vaultEnvs {
			if e == "development" {
				defaultIdx = i
				break
			}
		}

		// Reorder to put default first
		if defaultIdx > 0 {
			vaultEnvs[0], vaultEnvs[defaultIdx] = vaultEnvs[defaultIdx], vaultEnvs[0]
		}

		selected, err := ui.Select("Environment:", vaultEnvs)
		if err != nil {
			return err
		}
		envName = selected
	}

	ui.Step(fmt.Sprintf("Environment: %s", ui.Value(envName)))

	// Track pull event
	analytics.Track(analytics.EventPull, map[string]interface{}{
		"repoFullName": repo,
		"environment":  envName,
	})

	var vaultContent string
	err = ui.Spin("Downloading secrets...", func() error {
		resp, err := client.PullSecrets(ctx, repo, envName)
		if err != nil {
			return err
		}
		vaultContent = resp.Content
		return nil
	})

	if err != nil {
		analytics.Track(analytics.EventError, map[string]interface{}{
			"command": "pull",
			"error":   err.Error(),
		})
		if apiErr, ok := err.(*api.APIError); ok {
			ui.Error(apiErr.Error())
			if apiErr.UpgradeURL != "" {
				ui.Message(fmt.Sprintf("Upgrade: %s", ui.Link(apiErr.UpgradeURL)))
			}
		} else {
			ui.Error(err.Error())
		}
		return err
	}

	// Tip about keyway run (Zero-Trust)
	if ui.IsInteractive() {
		ui.Message("")
		ui.Message(fmt.Sprintf("%s %s", ui.Bold("💡 Tip:"), "To avoid writing secrets to disk (safer for AI agents), use:"))
		ui.Message(fmt.Sprintf("   %s", ui.Command(fmt.Sprintf("keyway run --env %s -- <command>", envName))))
		ui.Message("")
	}

	vaultSecrets := env.Parse(vaultContent)
	envFilePath := filepath.Join(".", file)

	// Read existing local file if it exists
	var localSecrets map[string]string
	localExists := false
	if data, err := os.ReadFile(envFilePath); err == nil {
		localExists = true
		localSecrets = env.Parse(string(data))
	} else {
		localSecrets = make(map[string]string)
	}

	// Calculate diff
	diff := env.CalculatePullDiff(localSecrets, vaultSecrets)

	// Show diff if there are changes and file exists
	if localExists && diff.HasChanges() {
		// Show vault changes (added/changed)
		if len(diff.Added) > 0 || len(diff.Changed) > 0 {
			ui.Message("")
			ui.Message("Changes from vault:")
			for _, key := range diff.Added {
				ui.DiffAdded(key)
			}
			for _, key := range diff.Changed {
				ui.DiffChanged(key)
			}
		}

		// Show local-only variables
		if len(diff.LocalOnly) > 0 {
			ui.Message("")
			if !force {
				ui.Message("Not in vault (will be preserved):")
				for _, key := range diff.LocalOnly {
					ui.DiffKept(key)
				}
			} else {
				ui.Message("Not in vault (will be removed):")
				for _, key := range diff.LocalOnly {
					ui.DiffRemoved(key)
				}
			}
		}
		ui.Message("")
	}

	// Confirm if file exists
	if localExists {
		if !yes && ui.IsInteractive() {
			var promptMsg string
			if force {
				promptMsg = fmt.Sprintf("Replace %s with secrets from vault?", file)
			} else {
				promptMsg = fmt.Sprintf("Merge secrets from vault into %s?", file)
			}
			confirm, _ := ui.Confirm(promptMsg, true)
			if !confirm {
				ui.Warn("Pull aborted.")
				return nil
			}
		} else if !yes {
			return fmt.Errorf("file %s exists - use --yes to confirm", file)
		}
	}

	// Prepare final content
	var finalContent string
	if force || !localExists {
		// Replace mode: use vault content as-is
		finalContent = vaultContent
	} else {
		// Merge mode: start with vault secrets, add local-only secrets
		finalContent = env.Merge(vaultContent, localSecrets, vaultSecrets)
	}

	// Write file with restricted permissions
	if err := os.WriteFile(envFilePath, []byte(finalContent), 0600); err != nil {
		ui.Error(fmt.Sprintf("Failed to write file: %s", err.Error()))
		return err
	}

	lines := env.CountLines(finalContent)
	ui.Success(fmt.Sprintf("Secrets downloaded to %s", ui.File(file)))
	ui.Message(fmt.Sprintf("Variables: %s", ui.Value(lines)))

	if !force && len(diff.LocalOnly) > 0 {
		ui.Message(fmt.Sprintf("Kept %s local-only variables", ui.Value(len(diff.LocalOnly))))
	}

	ui.Outro("Secrets synced!")

	return nil
}
