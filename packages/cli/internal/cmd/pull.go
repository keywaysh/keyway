package cmd

import (
	"context"
	"fmt"
	"maps"
	"path/filepath"
	"sort"
	"strings"

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

	var pulled *api.PullSecretsResponse
	_, explained, err := spinWithRelogin(deps, client, "Downloading secrets...", func(c api.APIClient) error {
		var pullErr error
		pulled, pullErr = c.PullSecrets(ctx, repo, envName)
		return pullErr
	})
	if err != nil {
		if explained {
			return err
		}
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

	// Tip about keyway run (Zero-Trust)
	if deps.UI.IsInteractive() {
		deps.UI.Message("")
		deps.UI.Message(fmt.Sprintf("%s %s", deps.UI.Bold("💡 Tip:"), "To avoid writing secrets to disk (safer for AI agents), use:"))
		deps.UI.Message(fmt.Sprintf("   %s", deps.UI.Command(fmt.Sprintf("keyway run --env %s -- <command>", envName))))
		deps.UI.Message("")
	}

	envFilePath := filepath.Join(".", opts.File)

	// Read existing local file if it exists
	var localSecrets map[string]string
	localExists := false
	if data, err := deps.FS.ReadFile(envFilePath); err == nil {
		localExists = true
		// --force replaces the file: reading it only serves the preview.
		localSecrets, err = env.Parse(string(data))
		if err != nil && !opts.Force {
			deps.UI.Error(fmt.Sprintf("Cannot read %s safely to merge into it: %v", opts.File, err))
			deps.UI.Message(deps.UI.Dim("Fix that line, or use --force to replace the file."))
			return err
		}
	}
	if localSecrets == nil {
		localSecrets = make(map[string]string)
	}

	// The vault's values, and what the file will read them as: compare the local file with the
	// latter, so that a value the file cannot hold exactly does not show as changed.
	vaultSecrets, _, err := secretsOf(pulled)
	if err != nil && localExists && !opts.Force {
		showVaultReadError(deps, err)
		deps.UI.Message(deps.UI.Dim("Use --force to replace the file with the vault's content."))
		return err
	}
	// Written in key order (see env.Format), or as the server sent it when it cannot be read
	vaultContent := pulled.Content
	if vaultSecrets != nil {
		vaultContent = env.Format(vaultSecrets)
	}
	asRead := asFile(vaultContent)
	if asRead == nil {
		asRead = vaultSecrets
	}
	// Only the keys the vault holds as such: " PADDED" reads as PADDED, which the vault does
	// not hold, so a local PADDED stays the file's own
	vaultView := asRead
	if vaultSecrets != nil {
		vaultView = make(map[string]string, len(asRead))
		for key, value := range asRead {
			if _, held := vaultSecrets[key]; held {
				vaultView[key] = value
			}
		}
	}

	// Calculate diff
	diff := env.CalculatePullDiff(localSecrets, vaultView)

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
		// Replace mode: use vault content as-is, ending with a newline so that lines appended
		// later (echo >> .env) start on a line of their own
		finalContent = vaultContent
		if !strings.HasSuffix(finalContent, "\n") {
			finalContent += "\n"
		}
	} else {
		// Merge mode: start with vault secrets, add local-only secrets
		finalContent = env.Merge(vaultContent, localSecrets, vaultView)
		if !mergedReadsAsIntended(finalContent, vaultContent, localSecrets, vaultView) {
			deps.UI.Error(fmt.Sprintf("Cannot merge into %s safely: its own variables would change how the vault's secrets read.", opts.File))
			deps.UI.Message(deps.UI.Dim("Use --force to replace the file, or keyway run to use the exact values."))
			return fmt.Errorf("merged file does not read back as intended")
		}
	}

	// Write file with restricted permissions
	if err := deps.FS.WriteFile(envFilePath, []byte(finalContent), 0600); err != nil {
		deps.UI.Error(fmt.Sprintf("Failed to write file: %s", err.Error()))
		return err
	}

	count := env.CountLines(finalContent)
	written, readErr := env.Parse(finalContent)
	if readErr == nil {
		count = len(written)
	}
	deps.UI.Success(fmt.Sprintf("Secrets downloaded to %s", deps.UI.File(opts.File)))
	deps.UI.Message(fmt.Sprintf("Variables: %s", deps.UI.Value(count)))

	if vaultSecrets != nil {
		warnAboutAlteredValues(deps, opts.File, written, readErr, vaultSecrets)
	}

	if !opts.Force && len(diff.LocalOnly) > 0 {
		deps.UI.Message(fmt.Sprintf("Kept %s local-only variables", deps.UI.Value(len(diff.LocalOnly))))
	}

	deps.UI.Outro("Secrets synced!")

	return nil
}

// mergedReadsAsIntended reports whether merged, the vault's text followed by local's own
// variables (those not in vaultView), reads as the vault's text alone plus those variables,
// unchanged: a value the vault's text opens with ' could otherwise end on a local line. When
// the vault's text cannot be read anyway, pull warns after writing it.
func mergedReadsAsIntended(merged, vaultContent string, local, vaultView map[string]string) bool {
	base := asFile(vaultContent)
	if base == nil {
		return true
	}
	want := maps.Clone(base)
	for key, value := range local {
		if _, inVault := vaultView[key]; !inVault {
			want[key] = value
		}
	}
	got := asFile(merged)
	return got != nil && maps.Equal(got, want)
}

// warnAboutAlteredValues names the vault's secrets that the written file, read back as written
// (readErr if it cannot be), does not hold exactly: keys it cannot name, values it alters.
// keyway push leaves them alone, and keyway run injects the exact values.
func warnAboutAlteredValues(deps *Dependencies, file string, written map[string]string, readErr error, exact map[string]string) {
	if readErr != nil {
		deps.UI.Warn(fmt.Sprintf("%s cannot be read back safely (%v), so keyway push would refuse it. Use keyway run to get the exact values.", file, readErr))
		return
	}
	var nameless, altered []string
	for key, value := range exact {
		got, ok := written[key]
		switch {
		case !ok:
			nameless = append(nameless, key)
		case got != value:
			altered = append(altered, key)
		}
	}
	sort.Strings(nameless)
	sort.Strings(altered)
	if len(nameless) > 0 {
		deps.UI.Warn(fmt.Sprintf("%s cannot name %s: keyway push leaves it alone; use keyway run or the dashboard.", file, keyList(nameless)))
	}
	if len(altered) > 0 {
		deps.UI.Warn(fmt.Sprintf("%s cannot hold the exact value of %s. Use keyway run to get the exact values.", file, keyList(altered)))
	}
}
