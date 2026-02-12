package cmd

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
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

// PullOptions contains the parsed flags for the pull command
type PullOptions struct {
	EnvName    string
	File       string
	Yes        bool
	Force      bool
	EnvFlagSet bool
}

// runPull is the entry point for the pull command (uses default dependencies)
func runPull(cmd *cobra.Command, args []string) error {
	opts := PullOptions{
		EnvFlagSet: cmd.Flags().Changed("env"),
	}
	opts.EnvName, _ = cmd.Flags().GetString("env")
	opts.File, _ = cmd.Flags().GetString("file")
	opts.Yes, _ = cmd.Flags().GetBool("yes")
	opts.Force, _ = cmd.Flags().GetBool("force")

	return runPullWithDeps(opts, defaultDeps)
}

// runPullWithDeps is the testable version of runPull
func runPullWithDeps(opts PullOptions, deps *Dependencies) error {
	deps.UI.Intro("pull")

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

	token, err := deps.Auth.EnsureLogin()
	if err != nil {
		deps.UI.Error(err.Error())
		return err
	}

	client := deps.APIFactory.NewClient(token)
	ctx := context.Background()

	envName := opts.EnvName

	// Prompt for environment if not specified
	if !opts.EnvFlagSet && deps.UI.IsInteractive() {
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

		selected, err := deps.UI.Select("Environment:", vaultEnvs)
		if err != nil {
			return err
		}
		envName = selected
	}

	deps.UI.Step(fmt.Sprintf("Environment: %s", deps.UI.Value(envName)))

	// Track pull event
	analytics.Track(analytics.EventPull, map[string]interface{}{
		"repoFullName": repo,
		"environment":  envName,
	})

	var vaultContent string
	err = deps.UI.Spin("Downloading secrets...", func() error {
		resp, err := client.PullSecrets(ctx, repo, envName)
		if err != nil {
			return err
		}
		vaultContent = resp.Content
		return nil
	})

	if err != nil {
		// Handle auth errors (expired token)
		if isAuthError(err) {
			newToken, authErr := handleAuthError(err, deps)
			if authErr != nil {
				return authErr
			}
			// Retry with new token
			client = deps.APIFactory.NewClient(newToken)
			err = deps.UI.Spin("Downloading secrets...", func() error {
				resp, pullErr := client.PullSecrets(ctx, repo, envName)
				if pullErr != nil {
					return pullErr
				}
				vaultContent = resp.Content
				return nil
			})
		}
		if err != nil {
			analytics.Track(analytics.EventError, map[string]interface{}{
				"command": "pull",
				"error":   err.Error(),
			})
			if apiErr, ok := err.(*api.APIError); ok {
				deps.UI.Error(apiErr.Error())
				if apiErr.UpgradeURL != "" {
					deps.UI.Message(fmt.Sprintf("Upgrade: %s", deps.UI.Link(apiErr.UpgradeURL)))
				}
			} else {
				deps.UI.Error(err.Error())
			}
			return err
		}
	}

	// Tip about keyway run (Zero-Trust)
	if deps.UI.IsInteractive() {
		deps.UI.Message("")
		deps.UI.Message(fmt.Sprintf("%s %s", deps.UI.Bold("💡 Tip:"), "To avoid writing secrets to disk (safer for AI agents), use:"))
		deps.UI.Message(fmt.Sprintf("   %s", deps.UI.Command(fmt.Sprintf("keyway run --env %s -- <command>", envName))))
		deps.UI.Message("")
	}

	vaultSecrets := env.Parse(vaultContent)
	envFilePath := filepath.Join(".", opts.File)

	// Read existing local file if it exists
	var localSecrets map[string]string
	localExists := false
	if data, err := deps.FS.ReadFile(envFilePath); err == nil {
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
			deps.UI.Message("")
			deps.UI.Message("Changes from vault:")
			for _, key := range diff.Added {
				deps.UI.DiffAdded(key)
			}
			for _, key := range diff.Changed {
				deps.UI.DiffChanged(key)
			}
		}

		// Show local-only variables
		if len(diff.LocalOnly) > 0 {
			deps.UI.Message("")
			if !opts.Force {
				deps.UI.Message("Not in vault (will be preserved):")
				for _, key := range diff.LocalOnly {
					deps.UI.DiffKept(key)
				}
			} else {
				deps.UI.Message("Not in vault (will be removed):")
				for _, key := range diff.LocalOnly {
					deps.UI.DiffRemoved(key)
				}
			}
		}
		deps.UI.Message("")
	}

	// Confirm if file exists
	if localExists {
		if !opts.Yes && deps.UI.IsInteractive() {
			var promptMsg string
			if opts.Force {
				promptMsg = fmt.Sprintf("Replace %s with secrets from vault?", opts.File)
			} else {
				promptMsg = fmt.Sprintf("Merge secrets from vault into %s?", opts.File)
			}
			confirm, _ := deps.UI.Confirm(promptMsg, true)
			if !confirm {
				deps.UI.Warn("Pull aborted.")
				return nil
			}
		} else if !opts.Yes {
			return fmt.Errorf("file %s exists - use --yes to confirm", opts.File)
		}
	}

	// Prepare final content
	var finalContent string
	if opts.Force || !localExists {
		// Replace mode: use vault content as-is
		finalContent = vaultContent
	} else {
		// Merge mode: start with vault secrets, add local-only secrets
		finalContent = env.Merge(vaultContent, localSecrets, vaultSecrets)
	}

	// Write file with restricted permissions
	if err := deps.FS.WriteFile(envFilePath, []byte(finalContent), 0600); err != nil {
		deps.UI.Error(fmt.Sprintf("Failed to write file: %s", err.Error()))
		return err
	}

	lines := env.CountLines(finalContent)
	deps.UI.Success(fmt.Sprintf("Secrets downloaded to %s", deps.UI.File(opts.File)))
	deps.UI.Message(fmt.Sprintf("Variables: %s", deps.UI.Value(lines)))

	if !opts.Force && len(diff.LocalOnly) > 0 {
		deps.UI.Message(fmt.Sprintf("Kept %s local-only variables", deps.UI.Value(len(diff.LocalOnly))))
	}

	deps.UI.Outro("Secrets synced!")

	return nil
}
