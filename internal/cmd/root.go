package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/auth"
	"github.com/keywaysh/cli/internal/config"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/keywaysh/cli/internal/version"
	"github.com/pkg/browser"
	"github.com/spf13/cobra"
)

var (
	bold = color.New(color.Bold).SprintFunc()
	dim  = color.New(color.Faint).SprintFunc()
	cyan = color.New(color.FgCyan).SprintFunc()
)

var rootCmd = &cobra.Command{
	Use:           "keyway",
	Short:         "Sync secrets with your team and infra",
	SilenceUsage:  true,
	SilenceErrors: true,
	RunE:          runRoot,
}

func runRoot(cmd *cobra.Command, args []string) error {
	// Check if running in non-interactive mode
	if !ui.IsInteractive() {
		printCustomHelp(cmd)
		return nil
	}

	// Check if user is logged in
	store := auth.NewStore()
	storedAuth, err := store.GetAuth()
	var token string
	isLoggedIn := false

	if err == nil && storedAuth != nil && storedAuth.KeywayToken != "" {
		isLoggedIn = true
		token = storedAuth.KeywayToken
	}

	// Also check env var
	if envToken := os.Getenv("KEYWAY_TOKEN"); envToken != "" {
		isLoggedIn = true
		token = envToken
	}

	if !isLoggedIn {
		// Not logged in: run full onboarding flow
		return runOnboarding(cmd)
	}

	// Logged in: show action menu (will check if vault exists)
	return runActionMenu(cmd, token)
}

func runOnboarding(cmd *cobra.Command) error {
	ui.Intro("welcome")

	ui.Message("Let's set up Keyway for this project.")
	ui.Message("")

	// Check if we're in a git repo
	repo, err := git.DetectRepo()
	if err != nil {
		ui.Error("Not in a git repository with GitHub remote")
		ui.Message(ui.Dim("Navigate to your project folder and try again."))
		return err
	}

	ui.Step(fmt.Sprintf("Repository: %s", ui.Value(repo)))

	// Run init (which handles login, GitHub App, vault creation, and push)
	return runInit(initCmd, nil)
}

func runActionMenu(cmd *cobra.Command, token string) error {
	fmt.Println()

	// Check current repo
	repo, err := git.DetectRepo()
	if err != nil {
		ui.Error("Not in a git repository with GitHub remote")
		ui.Message(ui.Dim("Navigate to your project folder and try again."))
		return err
	}
	if repo == "" {
		ui.Error("Could not detect GitHub remote")
		ui.Message(ui.Dim("Make sure this repo has a GitHub remote configured."))
		return fmt.Errorf("no GitHub remote found")
	}

	ui.Step(fmt.Sprintf("Repository: %s", ui.Value(repo)))

	// Check vault status (single API call)
	client := api.NewClient(token)
	ctx := context.Background()
	vaultDetails, err := client.GetVaultDetails(ctx, repo)

	if err != nil {
		// Check error type
		if apiErr, ok := err.(*api.APIError); ok {
			switch apiErr.StatusCode {
			case 401:
				// Token expired: clear and prompt re-login
				store := auth.NewStore()
				_ = store.ClearAuth()
				ui.Warn("Session expired")
				ui.Message(ui.Dim("Run: keyway login"))
				return err
			case 403:
				ui.Error("Permission denied")
				ui.Message(ui.Dim("You don't have access to this repository's vault."))
				return err
			case 404:
				// Vault doesn't exist: run init flow
				ui.Message("")
				ui.Message("No vault found for this repository. Let's set one up!")
				ui.Message("")
				return runInit(initCmd, nil)
			}
		}
		// Other errors (network, server, etc.)
		ui.Error(fmt.Sprintf("Failed to check vault: %s", err.Error()))
		return err
	}

	if vaultDetails.SecretCount == 0 {
		// Vault exists but is empty: run init flow to push secrets
		ui.Message("")
		ui.Message("Vault found but empty. Let's add some secrets!")
		ui.Message("")
		return runInit(initCmd, nil)
	}

	// Vault exists with secrets: show action menu
	options := []string{
		"Pull secrets from vault",
		"Push secrets to vault",
		"Sync with Vercel/Railway/Netlify",
		"Open dashboard",
		"Show help",
	}

	selected, err := ui.Select("What would you like to do?", options)
	if err != nil {
		return err
	}

	switch selected {
	case "Pull secrets from vault":
		return runPull(pullCmd, nil)
	case "Push secrets to vault":
		return runPush(pushCmd, nil)
	case "Sync with Vercel/Railway/Netlify":
		return runSync(syncCmd, nil)
	case "Open dashboard":
		url := fmt.Sprintf("%s/vaults/%s", config.GetDashboardURL(), repo)
		ui.Success(fmt.Sprintf("Opening %s", ui.Link(url)))
		_ = browser.OpenURL(url)
		return nil
	case "Show help":
		printCustomHelp(cmd)
		return nil
	}

	return nil
}

func printCustomHelp(cmd *cobra.Command) {
	fmt.Println()
	fmt.Printf("  %s  %s\n", bold("keyway"), dim("— Sync secrets with your team and infra"))
	fmt.Println()

	// Core Commands
	fmt.Printf("  %s\n", bold("Core Commands:"))
	fmt.Printf("    %s           %s\n", cyan("keyway init"), "Initialize vault for this repo")
	fmt.Printf("    %s           %s\n", cyan("keyway push"), "Upload secrets to vault")
	fmt.Printf("    %s           %s\n", cyan("keyway pull"), "Download secrets from vault")
	fmt.Printf("    %s            %s\n", cyan("keyway set"), "Set a single secret in vault")
	fmt.Printf("    %s            %s\n", cyan("keyway run"), "Run command with injected secrets (Zero-Trust)")
	fmt.Printf("    %s           %s\n", cyan("keyway login"), "Sign in with GitHub")
	fmt.Println()

	// Provider Sync
	fmt.Printf("  %s\n", bold("Provider Sync:"))
	fmt.Printf("    %s        %s\n", cyan("keyway connect"), "Connect to Vercel, Railway...")
	fmt.Printf("    %s           %s\n", cyan("keyway sync"), "Sync secrets with providers")
	fmt.Printf("    %s    %s\n", cyan("keyway connections"), "List provider connections")
	fmt.Printf("    %s     %s\n", cyan("keyway disconnect"), "Remove a provider connection")
	fmt.Println()

	// Utilities
	fmt.Printf("  %s\n", bold("Utilities:"))
	fmt.Printf("    %s           %s\n", cyan("keyway diff"), "Compare secrets between environments")
	fmt.Printf("    %s           %s\n", cyan("keyway scan"), "Scan codebase for leaked secrets")
	fmt.Printf("    %s         %s\n", cyan("keyway doctor"), "Check your setup")
	fmt.Printf("    %s         %s\n", cyan("keyway logout"), "Clear stored credentials")
	fmt.Println()

	// Footer
	fmt.Printf("  %s %s\n", dim("Run"), fmt.Sprintf("%s %s", cyan("keyway <command> --help"), dim("for details")))
	fmt.Printf("  %s %s\n", dim("Docs:"), config.GetDocsURL())

	// Version
	if cmd.Version != "" {
		fmt.Printf("  %s %s\n", dim("Version:"), cmd.Version)
	}
	fmt.Println()
}

// Execute runs the root command
func Execute(ver string) error {
	rootCmd.Version = ver

	// Start non-blocking version check
	updateChan := make(chan *version.UpdateInfo, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), version.CheckTimeout)
		defer cancel()
		info := version.CheckForUpdate(ctx, ver)
		updateChan <- info
	}()

	// Execute the command
	err := rootCmd.Execute()

	// Display error and help for unknown commands
	if err != nil {
		red := color.New(color.FgRed).SprintFunc()
		fmt.Fprintf(os.Stderr, "\n  %s %s\n", red("Error:"), err)
		fmt.Println()
		printCustomHelp(rootCmd)
		return err
	}

	// Display update notice if available (non-blocking receive)
	select {
	case info := <-updateChan:
		if info != nil && info.Available {
			displayUpdateNotice(info)
		}
	default:
		// Check not complete, don't wait
	}

	return nil
}

func displayUpdateNotice(info *version.UpdateInfo) {
	// Skip update notice for self-hosted instances (no update command)
	if info.UpdateCommand == "" {
		return
	}

	yellow := color.New(color.FgYellow).SprintFunc()
	fmt.Println()
	fmt.Printf("  %s Update available: %s → %s\n",
		yellow("!"),
		dim(info.CurrentVersion),
		bold(info.LatestVersion))
	fmt.Printf("  %s Run: %s\n",
		dim("→"),
		cyan(info.UpdateCommand))
}

func init() {
	// Add commands
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(pushCmd)
	rootCmd.AddCommand(pullCmd)
	rootCmd.AddCommand(setCmd)
	rootCmd.AddCommand(doctorCmd)
	rootCmd.AddCommand(connectCmd)
	rootCmd.AddCommand(connectionsCmd)
	rootCmd.AddCommand(disconnectCmd)
	rootCmd.AddCommand(syncCmd)
	rootCmd.AddCommand(readmeCmd)
	rootCmd.AddCommand(diffCmd)
	rootCmd.AddCommand(scanCmd)
	rootCmd.AddCommand(runCmd)
}
