package cmd

import (
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/keywaysh/cli/internal/auth"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
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
	isLoggedIn := err == nil && storedAuth != nil && storedAuth.KeywayToken != ""

	// Also check env var
	if os.Getenv("KEYWAY_TOKEN") != "" {
		isLoggedIn = true
	}

	if !isLoggedIn {
		// Not logged in: run full onboarding flow
		return runOnboarding(cmd)
	}

	// Logged in: show action menu
	return runActionMenu(cmd)
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

func runActionMenu(cmd *cobra.Command) error {
	fmt.Println()

	// Show current repo if available
	repo, _ := git.DetectRepo()
	if repo != "" {
		ui.Step(fmt.Sprintf("Repository: %s", ui.Value(repo)))
	}

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
		url := "https://www.keyway.sh/dashboard"
		if repo != "" {
			url = fmt.Sprintf("https://www.keyway.sh/dashboard/vaults/%s", repo)
		}
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

	// Quick Start
	fmt.Printf("  %s\n", bold("Quick Start:"))
	fmt.Printf("    %s          %s\n", cyan("keyway login"), "Sign in with GitHub")
	fmt.Printf("    %s           %s\n", cyan("keyway init"), "Initialize vault for this repo")
	fmt.Printf("    %s           %s\n", cyan("keyway push"), "Upload secrets to vault")
	fmt.Printf("    %s           %s\n", cyan("keyway pull"), "Download secrets from vault")
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
	fmt.Printf("    %s         %s\n", cyan("keyway readme"), "Add badge to README")
	fmt.Printf("    %s         %s\n", cyan("keyway logout"), "Clear stored credentials")
	fmt.Println()

	// Footer
	fmt.Printf("  %s %s\n", dim("Run"), fmt.Sprintf("%s %s", cyan("keyway <command> --help"), dim("for details")))
	fmt.Printf("  %s %s\n", dim("Docs:"), "https://docs.keyway.sh")

	// Version
	if cmd.Version != "" {
		fmt.Printf("  %s %s\n", dim("Version:"), cmd.Version)
	}
	fmt.Println()
}

// Execute runs the root command
func Execute(version string) error {
	rootCmd.Version = version
	return rootCmd.Execute()
}

func init() {
	// Add commands
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(pushCmd)
	rootCmd.AddCommand(pullCmd)
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
