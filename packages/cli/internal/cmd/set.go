package cmd

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/config"
	"github.com/keywaysh/cli/internal/env"
	"github.com/spf13/cobra"
)

var setCmd = &cobra.Command{
	Use:   "set <KEY> [VALUE]",
	Short: "Set a secret in the vault",
	Long: `Set a secret in the vault for the current repository.

Examples:
  keyway set API_KEY                    # Prompt for value (masked)
  keyway set API_KEY=sk_live_xxx        # Set with inline value
  keyway set API_KEY -e production      # Set in specific environment
  keyway set API_KEY -y                 # Skip confirmation if updating`,
	Args: cobra.RangeArgs(1, 2),
	RunE: runSet,
}

func init() {
	setCmd.Flags().StringP("env", "e", "", "Environment name (default: development)")
	setCmd.Flags().BoolP("local", "l", false, "Write to local .env file instead of vault (legacy)")
	setCmd.Flags().BoolP("yes", "y", false, "Skip confirmation prompts")
}

// SetOptions contains the parsed flags for the set command
type SetOptions struct {
	Key        string
	Value      string
	EnvName    string
	LocalOnly  bool
	Yes        bool
	EnvFlagSet bool
}

// runSet is the entry point for the set command (uses default dependencies)
func runSet(cmd *cobra.Command, args []string) error {
	opts := SetOptions{
		EnvFlagSet: cmd.Flags().Changed("env"),
	}

	// Parse KEY or KEY=VALUE from first arg
	if strings.Contains(args[0], "=") {
		parts := strings.SplitN(args[0], "=", 2)
		opts.Key = parts[0]
		opts.Value = parts[1]
	} else {
		opts.Key = args[0]
		if len(args) > 1 {
			opts.Value = args[1]
		}
	}

	opts.EnvName, _ = cmd.Flags().GetString("env")
	opts.LocalOnly, _ = cmd.Flags().GetBool("local")
	opts.Yes, _ = cmd.Flags().GetBool("yes")

	return runSetWithDeps(opts, defaultDeps)
}

// runSetWithDeps is the testable version of runSet
func runSetWithDeps(opts SetOptions, deps *Dependencies) error {
	deps.UI.Intro("set")

	// Validate key
	if opts.Key == "" {
		deps.UI.Error("Key is required")
		return fmt.Errorf("key is required")
	}

	// Validate key format (alphanumeric and underscores only)
	for _, c := range opts.Key {
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			deps.UI.Error("Key must contain only alphanumeric characters and underscores")
			return fmt.Errorf("invalid key format")
		}
	}

	deps.UI.Step(fmt.Sprintf("Key: %s", deps.UI.Value(opts.Key)))

	// Prompt for value if not provided
	if opts.Value == "" {
		if !deps.UI.IsInteractive() {
			deps.UI.Error("Value is required in non-interactive mode")
			return fmt.Errorf("value is required")
		}
		value, err := deps.UI.Password(fmt.Sprintf("Enter value for %s:", opts.Key))
		if err != nil {
			return err
		}
		if value == "" {
			deps.UI.Error("Value cannot be empty")
			return fmt.Errorf("value cannot be empty")
		}
		opts.Value = value
	}

	// Handle legacy --local mode
	if opts.LocalOnly {
		deps.UI.Warn("Local .env files are deprecated. Consider using 'keyway run' to inject secrets at runtime.")
		return runSetLocal(opts, deps)
	}

	// Default: push to vault
	return runSetRemote(opts, deps)
}

// runSetLocal handles the legacy --local mode
func runSetLocal(opts SetOptions, deps *Dependencies) error {
	envFile := ".env"

	// Read existing local file
	var localSecrets map[string]string
	if content, err := deps.FS.ReadFile(envFile); err == nil {
		localSecrets = env.Parse(string(content))
	} else {
		localSecrets = make(map[string]string)
	}

	// Check if key exists
	if existingValue, ok := localSecrets[opts.Key]; ok {
		if !opts.Yes {
			deps.UI.Warn(fmt.Sprintf("%s already exists in %s", opts.Key, envFile))
			deps.UI.Message(fmt.Sprintf("  Current: %s", deps.UI.Dim(maskValue(existingValue))))
			deps.UI.Message(fmt.Sprintf("  New:     %s", deps.UI.Value(maskValue(opts.Value))))

			if !deps.UI.IsInteractive() {
				deps.UI.Error("Use --yes to update existing secret in non-interactive mode")
				return fmt.Errorf("confirmation required")
			}

			confirm, _ := deps.UI.Confirm("Update this secret?", false)
			if !confirm {
				deps.UI.Warn("Aborted.")
				return nil
			}
		}
	}

	// Update and write
	localSecrets[opts.Key] = opts.Value
	content := formatEnvContent(localSecrets)

	if err := deps.FS.WriteFile(envFile, []byte(content), 0600); err != nil {
		deps.UI.Error(fmt.Sprintf("Failed to write %s: %s", envFile, err.Error()))
		return err
	}

	deps.UI.Success(fmt.Sprintf("Set %s in %s", opts.Key, envFile))
	return nil
}

// runSetRemote handles pushing to the vault (default behavior)
func runSetRemote(opts SetOptions, deps *Dependencies) error {
	// Detect repo
	repo, err := deps.Git.DetectRepo()
	if err != nil {
		deps.UI.Error("Not in a git repository with GitHub remote")
		return err
	}
	deps.UI.Step(fmt.Sprintf("Repository: %s", deps.UI.Value(repo)))

	// Ensure logged in
	token, err := deps.Auth.EnsureLogin()
	if err != nil {
		deps.UI.Error(err.Error())
		return err
	}

	client := deps.APIFactory.NewClient(token)
	ctx := context.Background()

	envName := opts.EnvName

	// Default to development if not specified
	if envName == "" {
		if !opts.EnvFlagSet && deps.UI.IsInteractive() {
			// Fetch available environments
			vaultEnvs, err := client.GetVaultEnvironments(ctx, repo)
			if err != nil || len(vaultEnvs) == 0 {
				vaultEnvs = []string{"development", "staging", "production"}
			}

			selected, err := deps.UI.Select("Environment:", vaultEnvs)
			if err != nil {
				return err
			}
			envName = selected
		} else {
			envName = "development"
		}
	}

	deps.UI.Step(fmt.Sprintf("Environment: %s", deps.UI.Value(envName)))

	// Fetch current vault state
	var vaultSecrets map[string]string
	err = deps.UI.Spin("Fetching current secrets...", func() error {
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

	if err != nil {
		if isAuthError(err) {
			newToken, authErr := handleAuthError(err, deps)
			if authErr != nil {
				return authErr
			}
			client = deps.APIFactory.NewClient(newToken)
			err = deps.UI.Spin("Fetching current secrets...", func() error {
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
			deps.UI.Error(err.Error())
			return err
		}
	}

	// Check if key exists in vault
	existsInVault := false
	if existingValue, ok := vaultSecrets[opts.Key]; ok {
		existsInVault = true
		if !opts.Yes {
			deps.UI.Warn(fmt.Sprintf("%s already exists in vault (%s)", opts.Key, envName))
			deps.UI.Message(fmt.Sprintf("  Current: %s", deps.UI.Dim(maskValue(existingValue))))
			deps.UI.Message(fmt.Sprintf("  New:     %s", deps.UI.Value(maskValue(opts.Value))))

			if !deps.UI.IsInteractive() {
				deps.UI.Error("Use --yes to update existing secret in non-interactive mode")
				return fmt.Errorf("confirmation required")
			}

			confirm, _ := deps.UI.Confirm("Update this secret?", false)
			if !confirm {
				deps.UI.Warn("Aborted.")
				return nil
			}
		}
	}

	// Track analytics
	analytics.Track("cli_set", map[string]interface{}{
		"repoFullName": repo,
		"environment":  envName,
		"isUpdate":     existsInVault,
	})

	// Merge and push
	vaultSecrets[opts.Key] = opts.Value

	err = deps.UI.Spin("Pushing to vault...", func() error {
		_, pushErr := client.PushSecrets(ctx, repo, envName, vaultSecrets)
		return pushErr
	})

	if err != nil {
		if isAuthError(err) {
			newToken, authErr := handleAuthError(err, deps)
			if authErr != nil {
				return authErr
			}
			client = deps.APIFactory.NewClient(newToken)
			err = deps.UI.Spin("Pushing to vault...", func() error {
				_, pushErr := client.PushSecrets(ctx, repo, envName, vaultSecrets)
				return pushErr
			})
		}
		if err != nil {
			analytics.Track(analytics.EventError, map[string]interface{}{
				"command": "set",
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

	if existsInVault {
		deps.UI.Success(fmt.Sprintf("Updated %s in vault (%s)", opts.Key, envName))
	} else {
		deps.UI.Success(fmt.Sprintf("Added %s to vault (%s)", opts.Key, envName))
	}

	// Show tip for using the secret
	deps.UI.Message("")
	if envName == "development" {
		deps.UI.Message(deps.UI.Dim("Use with: keyway run <command>"))
	} else {
		deps.UI.Message(deps.UI.Dim(fmt.Sprintf("Use with: keyway run -e %s <command>", envName)))
	}

	dashboardURL := fmt.Sprintf("%s/vaults/%s", config.GetDashboardURL(), repo)
	deps.UI.Outro(fmt.Sprintf("Dashboard: %s", deps.UI.Link(dashboardURL)))

	return nil
}

// formatEnvContent formats a map as env file content (sorted for deterministic output)
func formatEnvContent(secrets map[string]string) string {
	keys := make([]string, 0, len(secrets))
	for k := range secrets {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var lines []string
	for _, k := range keys {
		lines = append(lines, fmt.Sprintf("%s=%s", k, secrets[k]))
	}
	return strings.Join(lines, "\n") + "\n"
}
