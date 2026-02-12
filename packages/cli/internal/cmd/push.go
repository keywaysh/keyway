package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/config"
	"github.com/keywaysh/cli/internal/env"
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
	pushCmd.Flags().Bool("prune", false, "Remove secrets from vault that are not in local file")
}

// PushOptions contains the parsed flags for the push command
type PushOptions struct {
	EnvName    string
	File       string
	Yes        bool
	Prune      bool
	EnvFlagSet bool
}

// runPush is the entry point for the push command (uses default dependencies)
func runPush(cmd *cobra.Command, args []string) error {
	opts := PushOptions{
		EnvFlagSet: cmd.Flags().Changed("env"),
	}
	opts.EnvName, _ = cmd.Flags().GetString("env")
	opts.File, _ = cmd.Flags().GetString("file")
	opts.Yes, _ = cmd.Flags().GetBool("yes")
	opts.Prune, _ = cmd.Flags().GetBool("prune")

	return runPushWithDeps(opts, defaultDeps)
}

// runPushWithDeps is the testable version of runPush
func runPushWithDeps(opts PushOptions, deps *Dependencies) error {
	deps.UI.Intro("push")

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

	envName := opts.EnvName
	file := opts.File

	// Discover env files
	candidates := deps.Env.Discover()

	if len(candidates) == 0 && file == "" {
		if !deps.UI.IsInteractive() {
			deps.UI.Error("No .env file found")
			return fmt.Errorf("no .env file found")
		}
		create, _ := deps.UI.Confirm("No .env file found. Create one?", true)
		if create {
			if err := deps.FS.WriteFile(".env", []byte("# Add your environment variables here\n# Example: API_KEY=your-api-key\n"), 0600); err != nil {
				return err
			}
			deps.UI.Success("Created .env file")
			deps.UI.Message(deps.UI.Dim("Add your variables and run keyway push again"))
		}
		return nil
	}

	// Select file if not specified
	if file == "" && deps.UI.IsInteractive() && len(candidates) > 1 {
		options := make([]string, len(candidates))
		for i, c := range candidates {
			options[i] = fmt.Sprintf("%s (env: %s)", c.File, c.Env)
		}
		selected, err := deps.UI.Select("Select an env file to push:", options)
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
		envName = deps.Env.DeriveEnvFromFile(file)
	}

	// Read file
	content, err := deps.FS.ReadFile(file)
	if err != nil {
		deps.UI.Error(fmt.Sprintf("File not found: %s", file))
		return err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		deps.UI.Error(fmt.Sprintf("File is empty: %s", file))
		return fmt.Errorf("file is empty")
	}

	secrets := env.Parse(string(content))
	if len(secrets) == 0 {
		deps.UI.Error("No valid environment variables found in file")
		return fmt.Errorf("no variables found")
	}

	deps.UI.Step(fmt.Sprintf("File: %s", deps.UI.File(file)))
	deps.UI.Step(fmt.Sprintf("Variables: %s", deps.UI.Value(len(secrets))))

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

	// Prompt for environment if not specified
	if !opts.EnvFlagSet && deps.UI.IsInteractive() {
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

		selected, err := deps.UI.Select("Push to environment:", vaultEnvs)
		if err != nil {
			return err
		}
		envName = selected
	}

	deps.UI.Step(fmt.Sprintf("Environment: %s", deps.UI.Value(envName)))

	// Fetch current vault state to show preview
	var vaultSecrets map[string]string
	err = deps.UI.Spin("Fetching current vault state...", func() error {
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
		// Handle auth errors (expired token)
		if isAuthError(err) {
			newToken, authErr := handleAuthError(err, deps)
			if authErr != nil {
				return authErr
			}
			// Retry with new token
			client = deps.APIFactory.NewClient(newToken)
			err = deps.UI.Spin("Fetching current vault state...", func() error {
				resp, err := client.PullSecrets(ctx, repo, envName)
				if err != nil {
					if apiErr, ok := err.(*api.APIError); ok && apiErr.StatusCode == 404 {
						vaultSecrets = make(map[string]string)
						return nil
					}
					return err
				}
				vaultSecrets = env.Parse(resp.Content)
				return nil
			})
		}
		if err != nil {
			if apiErr, ok := err.(*api.APIError); ok {
				deps.UI.Error(apiErr.Error())
			} else {
				deps.UI.Error(err.Error())
			}
			return err
		}
	}

	// Calculate and show diff
	diff := env.CalculatePushDiff(secrets, vaultSecrets)

	// When --prune is NOT set, merge vault secrets into local (additive mode)
	// This preserves vault-only secrets instead of deleting them
	secretsToSend := secrets
	if !opts.Prune && len(diff.Removed) > 0 {
		// Merge: start with vault secrets, overlay local secrets
		secretsToSend = make(map[string]string)
		for k, v := range vaultSecrets {
			secretsToSend[k] = v
		}
		for k, v := range secrets {
			secretsToSend[k] = v
		}
	}

	if diff.HasChanges() {
		// Show additions and updates
		if len(diff.Added) > 0 || len(diff.Changed) > 0 {
			deps.UI.Message("")
			deps.UI.Message("Will be pushed to vault:")
			for _, key := range diff.Added {
				deps.UI.DiffAdded(key)
			}
			for _, key := range diff.Changed {
				deps.UI.DiffChanged(key)
			}
		}

		// Show removals only when --prune is set
		if opts.Prune && len(diff.Removed) > 0 {
			deps.UI.Message("")
			deps.UI.Message("Will be moved to trash (not in local file):")
			for _, key := range diff.Removed {
				deps.UI.DiffRemoved(key)
			}
		}

		// Warn about vault-only secrets when --prune is NOT set
		if !opts.Prune && len(diff.Removed) > 0 {
			deps.UI.Message("")
			deps.UI.Warn(fmt.Sprintf("%d secret(s) in vault not in local file: %s", len(diff.Removed), strings.Join(diff.Removed, ", ")))
			deps.UI.Message(deps.UI.Dim("Use --prune to remove them, or keyway pull to fetch them"))
		}
		deps.UI.Message("")
	} else {
		deps.UI.Info("No changes detected")
	}

	// Confirm
	if !opts.Yes && deps.UI.IsInteractive() {
		confirm, _ := deps.UI.Confirm(fmt.Sprintf("Push %d secrets from %s to %s?", len(secrets), file, repo), true)
		if !confirm {
			deps.UI.Warn("Push aborted.")
			return nil
		}
	} else if !opts.Yes {
		return fmt.Errorf("confirmation required - use --yes in non-interactive mode")
	}

	// Track push event
	analytics.Track(analytics.EventPush, map[string]interface{}{
		"repoFullName":  repo,
		"environment":   envName,
		"variableCount": len(secrets),
	})

	var resp *api.PushSecretsResponse
	err = deps.UI.Spin("Uploading secrets...", func() error {
		var err error
		resp, err = client.PushSecrets(ctx, repo, envName, secretsToSend)
		return err
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
			err = deps.UI.Spin("Uploading secrets...", func() error {
				var pushErr error
				resp, pushErr = client.PushSecrets(ctx, repo, envName, secretsToSend)
				return pushErr
			})
		}
		if err != nil {
			analytics.Track(analytics.EventError, map[string]interface{}{
				"command": "push",
				"error":   err.Error(),
			})
			if apiErr, ok := err.(*api.APIError); ok {
				deps.UI.Error(apiErr.Error())
				if apiErr.UpgradeURL != "" {
					analytics.Track(analytics.EventUpgradePrompt, map[string]interface{}{
						"reason":  "push_error",
						"command": "push",
					})
					deps.UI.Message(fmt.Sprintf("Upgrade: %s", deps.UI.Link(apiErr.UpgradeURL)))
				}
			} else {
				deps.UI.Error(err.Error())
			}
			return err
		}
	}

	deps.UI.Success(resp.Message)
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
			deps.UI.Message(fmt.Sprintf("Stats: %s", strings.Join(parts, ", ")))
		}
	}

	dashboardURL := fmt.Sprintf("%s/vaults/%s", config.GetDashboardURL(), repo)
	deps.UI.Outro(fmt.Sprintf("Dashboard: %s", deps.UI.Link(dashboardURL)))

	return nil
}
