package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
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
	pullCmd.Flags().BoolP("yes", "y", false, "Overwrite target file without confirmation")
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

	env, _ := cmd.Flags().GetString("env")
	file, _ := cmd.Flags().GetString("file")
	yes, _ := cmd.Flags().GetBool("yes")

	ui.Step(fmt.Sprintf("Environment: %s", ui.Value(env)))

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

	// Track pull event
	analytics.Track(analytics.EventPull, map[string]interface{}{
		"repoFullName": repo,
		"environment":  env,
	})

	var content string
	err = ui.Spin("Downloading secrets...", func() error {
		resp, err := client.PullSecrets(ctx, repo, env)
		if err != nil {
			return err
		}
		content = resp.Content
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

	// Check if file exists
	envFilePath := filepath.Join(".", file)
	if _, err := os.Stat(envFilePath); err == nil {
		if !yes && ui.IsInteractive() {
			overwrite, _ := ui.Confirm(fmt.Sprintf("%s exists. Overwrite with secrets from %s?", file, env), false)
			if !overwrite {
				ui.Warn("Pull aborted.")
				return nil
			}
		} else if !yes {
			return fmt.Errorf("file %s exists - use --yes to overwrite", file)
		}
		ui.Warn(fmt.Sprintf("Overwriting existing file: %s", file))
	}

	// Write file with restricted permissions
	if err := os.WriteFile(envFilePath, []byte(content), 0600); err != nil {
		ui.Error(fmt.Sprintf("Failed to write file: %s", err.Error()))
		return err
	}

	lines := countEnvLines(content)
	ui.Success(fmt.Sprintf("Secrets downloaded to %s", ui.File(file)))
	ui.Message(fmt.Sprintf("Variables: %s", ui.Value(lines)))
	ui.Outro("Secrets synced!")

	return nil
}

// countEnvLines counts non-empty, non-comment lines in env content
func countEnvLines(content string) int {
	count := 0
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			count++
		}
	}
	return count
}
