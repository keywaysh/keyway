package cmd

import (
	"context"
	"fmt"

	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
	"github.com/spf13/cobra"
)

var runCmd = &cobra.Command{
	Use:   "run [command]",
	Short: "Inject secrets into a command",
	Long:  `Run a command with secrets injected into the environment.
Secrets are fetched from the vault and injected directly into the process memory.
They are never written to disk.

This is particularly useful for:
- Running local development servers without .env files
- CI/CD pipelines
- Using AI agents (Claude Code, Gemini CLI, Codex) safely: the agent runs the command but cannot see the secrets on disk.`,
	Example: `  keyway run --env development -- npm run dev
  keyway run --env development -- python3 main.py
  keyway run --env production -- ./deploy.sh`,
	RunE: runRunCmd,
}

func init() {
	runCmd.Flags().StringP("env", "e", "development", "Environment name")
}

// RunOptions contains the parsed flags for the run command
type RunOptions struct {
	EnvName    string
	EnvFlagSet bool
	Command    string
	Args       []string
}

// runRunCmd is the entry point for the run command (uses default dependencies)
func runRunCmd(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("command required")
	}

	opts := RunOptions{
		EnvFlagSet: cmd.Flags().Changed("env"),
		Command:    args[0],
		Args:       args[1:],
	}
	opts.EnvName, _ = cmd.Flags().GetString("env")

	return runRunWithDeps(opts, defaultDeps)
}

// runRunWithDeps is the testable version of runRun
func runRunWithDeps(opts RunOptions, deps *Dependencies) error {
	// 1. Detect Repo
	repo, err := deps.Git.DetectRepo()
	if err != nil {
		deps.UI.Error("Not in a git repository with GitHub remote")
		return err
	}

	// 2. Ensure Login
	token, err := deps.Auth.EnsureLogin()
	if err != nil {
		deps.UI.Error(err.Error())
		return err
	}

	// 3. Setup Client
	client := deps.APIFactory.NewClient(token)
	ctx := context.Background()

	// 4. Determine Environment
	envName := opts.EnvName

	if !opts.EnvFlagSet && deps.UI.IsInteractive() {
		// Fetch available environments
		vaultEnvs, err := client.GetVaultEnvironments(ctx, repo)
		if err != nil || len(vaultEnvs) == 0 {
			vaultEnvs = []string{"development", "staging", "production"}
		}

		// Find default index (development)
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

	// 5. Fetch Secrets
	var vaultContent string
	err = deps.UI.Spin("Fetching secrets...", func() error {
		resp, err := client.PullSecrets(ctx, repo, envName)
		if err != nil {
			return err
		}
		vaultContent = resp.Content
		return nil
	})

	if err != nil {
		if apiErr, ok := err.(*api.APIError); ok {
			deps.UI.Error(apiErr.Error())
		} else {
			deps.UI.Error(err.Error())
		}
		return err
	}

	// 6. Parse Secrets
	secrets := env.Parse(vaultContent)
	deps.UI.Success(fmt.Sprintf("Injected %d secrets", len(secrets)))

	// 7. Execute Command
	return deps.CmdRunner.RunCommand(opts.Command, opts.Args, secrets)
}