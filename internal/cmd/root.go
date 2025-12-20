package cmd

import (
	"fmt"

	"github.com/fatih/color"
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
	Run: func(cmd *cobra.Command, args []string) {
		printCustomHelp(cmd)
	},
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
}
