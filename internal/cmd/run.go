package cmd

import (
	"context"
	"fmt"

	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/injector"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/spf13/cobra"
)

var runCmd = &cobra.Command{
	Use:   "run [command]",
	Short: "Inject secrets into a command",
	Long:  `Run a command with secrets injected into the environment.
Secrets are fetched from the vault and injected directly into the process memory.
They are never written to disk.`,
	Example: `  keyway run npm run dev
  keyway run -- python script.py
  keyway run --env prod -- ./deploy.sh`,
	RunE: runRun,
}

func init() {
	runCmd.Flags().StringP("env", "e", "development", "Environment name")
}

func runRun(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("command required")
	}

	commandName := args[0]
	commandArgs := args[1:]

	// 1. Detect Repo
	repo, err := git.DetectRepo()
	if err != nil {
		ui.Error("Not in a git repository with GitHub remote")
		return err
	}

	// 2. Ensure Login
	token, err := EnsureLogin()
	if err != nil {
		ui.Error(err.Error())
		return err
	}

	// 3. Setup Client
	client := api.NewClient(token)
	ctx := context.Background()

	// 4. Determine Environment
	env, _ := cmd.Flags().GetString("env")
	envFlagSet := cmd.Flags().Changed("env")

	if !envFlagSet && ui.IsInteractive() {
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

		selected, err := ui.Select("Environment:", vaultEnvs)
		if err != nil {
			return err
		}
		env = selected
	}

	ui.Step(fmt.Sprintf("Environment: %s", ui.Value(env)))

	// 5. Fetch Secrets
	var vaultContent string
	err = ui.Spin("Fetching secrets...", func() error {
		resp, err := client.PullSecrets(ctx, repo, env)
		if err != nil {
			return err
		}
		vaultContent = resp.Content
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

	// 6. Parse Secrets
	secrets := parseEnvContent(vaultContent)
	ui.Success(fmt.Sprintf("Injected %d secrets", len(secrets)))

	// 7. Execute Command
	return injector.RunCommand(commandName, commandArgs, secrets)
}