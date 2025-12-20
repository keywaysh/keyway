package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/fatih/color"
	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/spf13/cobra"
)

var syncCmd = &cobra.Command{
	Use:   "sync [provider]",
	Short: "Sync secrets with a provider (vercel, railway)",
	Long: `Sync secrets between your Keyway vault and a provider like Vercel or Railway.

If no provider is specified, you'll be prompted to select one.

Examples:
  keyway sync              # Interactive provider selection
  keyway sync vercel       # Sync with Vercel
  keyway sync railway      # Sync with Railway
  keyway sync vercel --push --env production
  keyway sync vercel --pull --env staging`,
	Args: cobra.MaximumNArgs(1),
	RunE: runSync,
}

func init() {
	syncCmd.Flags().Bool("push", false, "Push secrets from Keyway to provider")
	syncCmd.Flags().Bool("pull", false, "Pull secrets from provider to Keyway")
	syncCmd.Flags().StringP("env", "e", "", "Keyway environment (default: production)")
	syncCmd.Flags().String("provider-env", "", "Provider environment (auto-mapped if not specified)")
	syncCmd.Flags().StringP("project", "p", "", "Provider project name or ID")
	syncCmd.Flags().String("team", "", "Filter by team/organization")
	syncCmd.Flags().Bool("allow-delete", false, "Allow deleting secrets during push")
	syncCmd.Flags().BoolP("yes", "y", false, "Skip confirmation prompts")
}

// Environment mapping functions
func mapToProviderEnvironment(provider, keywayEnv string) string {
	switch strings.ToLower(provider) {
	case "vercel":
		mapping := map[string]string{
			"production":  "production",
			"staging":     "preview",
			"dev":         "development",
			"development": "development",
		}
		if env, ok := mapping[strings.ToLower(keywayEnv)]; ok {
			return env
		}
		return "production"
	case "railway":
		mapping := map[string]string{
			"production":  "production",
			"staging":     "staging",
			"dev":         "development",
			"development": "development",
		}
		if env, ok := mapping[strings.ToLower(keywayEnv)]; ok {
			return env
		}
		return "production"
	default:
		return keywayEnv
	}
}

// ProjectWithLinkedRepo represents a provider project with metadata
type ProjectWithLinkedRepo struct {
	ID           string
	Name         string
	ServiceID    *string
	ServiceName  *string
	LinkedRepo   *string
	Environments []string
	ConnectionID string
	TeamID       *string
	TeamName     *string
}

func getProjectDisplayName(p ProjectWithLinkedRepo) string {
	if p.ServiceName != nil && *p.ServiceName != "" {
		return *p.ServiceName
	}
	return p.Name
}

func projectMatchesRepo(project ProjectWithLinkedRepo, repoFullName string) bool {
	repoLower := strings.ToLower(repoFullName)
	repoName := strings.ToLower(strings.Split(repoFullName, "/")[1])

	if project.LinkedRepo != nil && strings.ToLower(*project.LinkedRepo) == repoLower {
		return true
	}

	if strings.ToLower(project.Name) == repoName {
		return true
	}

	return false
}

type projectMatch struct {
	Project   ProjectWithLinkedRepo
	MatchType string // "linked_repo", "exact_name", "partial_name"
}

func findMatchingProject(projects []ProjectWithLinkedRepo, repoFullName string) *projectMatch {
	repoLower := strings.ToLower(repoFullName)
	parts := strings.Split(repoFullName, "/")
	if len(parts) != 2 {
		return nil
	}
	repoName := strings.ToLower(parts[1])

	// Priority 1: Linked repo exact match
	for _, p := range projects {
		if p.LinkedRepo != nil && strings.ToLower(*p.LinkedRepo) == repoLower {
			return &projectMatch{Project: p, MatchType: "linked_repo"}
		}
	}

	// Priority 2: Exact name match
	for _, p := range projects {
		if strings.ToLower(p.Name) == repoName {
			return &projectMatch{Project: p, MatchType: "exact_name"}
		}
	}

	// Priority 3: Partial match (only if unique)
	var partialMatches []ProjectWithLinkedRepo
	for _, p := range projects {
		nameLower := strings.ToLower(p.Name)
		if strings.Contains(nameLower, repoName) || strings.Contains(repoName, nameLower) {
			partialMatches = append(partialMatches, p)
		}
	}

	if len(partialMatches) == 1 {
		return &projectMatch{Project: partialMatches[0], MatchType: "partial_name"}
	}

	return nil
}

func runSync(cmd *cobra.Command, args []string) error {
	pushFlag, _ := cmd.Flags().GetBool("push")
	pullFlag, _ := cmd.Flags().GetBool("pull")
	envFlag, _ := cmd.Flags().GetString("env")
	providerEnvFlag, _ := cmd.Flags().GetString("provider-env")
	projectFlag, _ := cmd.Flags().GetString("project")
	teamFlag, _ := cmd.Flags().GetString("team")
	allowDelete, _ := cmd.Flags().GetBool("allow-delete")
	skipConfirm, _ := cmd.Flags().GetBool("yes")

	// Validate incompatible options
	if pullFlag && allowDelete {
		ui.Error("--allow-delete cannot be used with --pull")
		ui.Message(ui.Dim("The --allow-delete flag is only for push operations."))
		return fmt.Errorf("invalid options")
	}

	token, err := EnsureLogin()
	if err != nil {
		return err
	}

	client := api.NewClient(token)
	ctx := context.Background()

	// Get provider - either from args or prompt
	var provider string
	if len(args) > 0 {
		provider = strings.ToLower(args[0])
	} else {
		// No provider specified - show list
		providers, err := client.GetProviders(ctx)
		if err != nil {
			// Check if it's an auth error
			if apiErr, ok := err.(*api.APIError); ok {
				if apiErr.StatusCode == 401 {
					ui.Error("Authentication failed. Please login again.")
					ui.Message(ui.Dim("Run: keyway login"))
					return err
				}
				ui.Error(fmt.Sprintf("Failed to fetch providers: %s", apiErr.Error()))
			} else {
				ui.Error(fmt.Sprintf("Failed to fetch providers: %v", err))
			}
			return err
		}

		if len(providers) == 0 {
			ui.Error("No providers available")
			return fmt.Errorf("no providers")
		}

		// Create options for selection
		options := make([]string, len(providers))
		for i, p := range providers {
			options[i] = p.DisplayName
		}

		selected, err := ui.Select("Select a provider to sync with:", options)
		if err != nil {
			return err
		}

		// Find the provider name from display name
		for _, p := range providers {
			if p.DisplayName == selected {
				provider = p.Name
				break
			}
		}
	}

	// Detect current repo
	repo, err := git.DetectRepo()
	if err != nil {
		ui.Error("Could not detect Git repository.")
		ui.Message(ui.Dim("Run this command from a Git repository directory."))
		return err
	}

	ui.Intro("sync")
	ui.Step(fmt.Sprintf("Repository: %s", ui.Value(repo)))

	// Check if vault exists
	exists, err := client.CheckVaultExists(ctx, repo)
	if err != nil {
		ui.Error("Failed to check vault")
		return err
	}

	if !exists {
		ui.Warn(fmt.Sprintf("No vault found for %s.", repo))

		if ui.IsInteractive() {
			shouldCreate, _ := ui.Confirm("Create vault now?", true)
			if !shouldCreate {
				return nil
			}

			err = ui.Spin("Creating vault...", func() error {
				_, err := client.InitVault(ctx, repo)
				return err
			})
			if err != nil {
				ui.Error("Failed to create vault")
				return err
			}
			ui.Success("Vault created!")
		} else {
			return fmt.Errorf("vault not found")
		}
	}

	// Get all projects from provider
	providerDisplayName := strings.Title(provider)
	allProjects, connections, err := client.GetAllProviderProjects(ctx, provider)
	if err != nil {
		// Check if not connected
		if strings.Contains(err.Error(), "not connected") || len(connections) == 0 {
			ui.Warn(fmt.Sprintf("Not connected to %s.", providerDisplayName))

			if ui.IsInteractive() {
				shouldConnect, _ := ui.Confirm(fmt.Sprintf("Connect to %s now?", providerDisplayName), true)
				if !shouldConnect {
					return nil
				}

				err = RunConnectCommand(provider)
				if err != nil {
					return err
				}

				// Refresh projects
				allProjects, connections, err = client.GetAllProviderProjects(ctx, provider)
				if err != nil {
					ui.Error("Failed to fetch projects after connecting")
					return err
				}
			} else {
				ui.Message(ui.Dim(fmt.Sprintf("Run `keyway connect %s` first.", provider)))
				return fmt.Errorf("not connected to provider")
			}
		} else {
			ui.Error("Failed to fetch provider projects")
			return err
		}
	}

	// Convert to ProjectWithLinkedRepo
	projects := make([]ProjectWithLinkedRepo, len(allProjects))
	for i, p := range allProjects {
		projects[i] = ProjectWithLinkedRepo{
			ID:           p.ID,
			Name:         p.Name,
			ServiceID:    p.ServiceID,
			ServiceName:  p.ServiceName,
			LinkedRepo:   p.LinkedRepo,
			Environments: p.Environments,
			ConnectionID: p.ConnectionID,
			TeamID:       p.TeamID,
			TeamName:     p.TeamName,
		}
	}

	// Filter by team if specified
	if teamFlag != "" {
		var filtered []ProjectWithLinkedRepo
		teamLower := strings.ToLower(teamFlag)
		for _, p := range projects {
			if (p.TeamID != nil && strings.ToLower(*p.TeamID) == teamLower) ||
				(p.TeamName != nil && strings.ToLower(*p.TeamName) == teamLower) ||
				(teamLower == "personal" && p.TeamID == nil) {
				filtered = append(filtered, p)
			}
		}

		if len(filtered) == 0 {
			ui.Error(fmt.Sprintf("No projects found for team: %s", teamFlag))
			teams := make(map[string]bool)
			for _, p := range projects {
				if p.TeamName != nil {
					teams[*p.TeamName] = true
				} else if p.TeamID != nil {
					teams[*p.TeamID] = true
				} else {
					teams["personal"] = true
				}
			}
			ui.Message(ui.Dim("Available teams:"))
			for t := range teams {
				ui.Message(ui.Dim(fmt.Sprintf("  - %s", t)))
			}
			return fmt.Errorf("team not found")
		}

		projects = filtered
		ui.Message(ui.Dim(fmt.Sprintf("Filtered to %d projects in team: %s", len(projects), teamFlag)))
	}

	if len(projects) == 0 {
		ui.Error(fmt.Sprintf("No projects found in your %s account(s).", providerDisplayName))
		return fmt.Errorf("no projects")
	}

	// Select project
	var selectedProject ProjectWithLinkedRepo

	if projectFlag != "" {
		// Use specified project
		var found bool
		projectLower := strings.ToLower(projectFlag)
		for _, p := range projects {
			if p.ID == projectFlag ||
				strings.ToLower(p.Name) == projectLower ||
				(p.ServiceName != nil && strings.ToLower(*p.ServiceName) == projectLower) {
				selectedProject = p
				found = true
				break
			}
		}
		if !found {
			ui.Error(fmt.Sprintf("Project not found: %s", projectFlag))
			ui.Message(ui.Dim("Available projects:"))
			for _, p := range projects {
				ui.Message(ui.Dim(fmt.Sprintf("  - %s", getProjectDisplayName(p))))
			}
			return fmt.Errorf("project not found")
		}

		if !projectMatchesRepo(selectedProject, repo) {
			ui.Warn("Project does not match current repository")
			yellow := color.New(color.FgYellow)
			yellow.Printf("Current repo:      %s\n", repo)
			yellow.Printf("Selected project:  %s\n", getProjectDisplayName(selectedProject))
		}
	} else {
		// Auto-detect or prompt
		match := findMatchingProject(projects, repo)

		if match != nil && (match.MatchType == "linked_repo" || match.MatchType == "exact_name") {
			selectedProject = match.Project
			matchReason := "exact name match"
			if match.MatchType == "linked_repo" {
				matchReason = fmt.Sprintf("linked to %s", repo)
			}
			teamInfo := ""
			if selectedProject.TeamName != nil {
				teamInfo = ui.Dim(fmt.Sprintf(" (%s)", *selectedProject.TeamName))
			}
			ui.Success(fmt.Sprintf("Auto-selected project: %s%s (%s)", getProjectDisplayName(selectedProject), teamInfo, matchReason))
		} else if match != nil && match.MatchType == "partial_name" {
			displayName := getProjectDisplayName(match.Project)
			ui.Info(fmt.Sprintf("Detected project: %s (partial match)", displayName))

			useDetected, _ := ui.Confirm(fmt.Sprintf("Use %s?", displayName), true)
			if useDetected {
				selectedProject = match.Project
			} else {
				selected, err := promptProjectSelection(projects, repo, providerDisplayName, len(connections) > 1)
				if err != nil {
					return err
				}
				selectedProject = selected
			}
		} else if len(projects) == 1 {
			selectedProject = projects[0]
			if !projectMatchesRepo(selectedProject, repo) {
				ui.Warn("Project does not match current repository")
				yellow := color.New(color.FgYellow)
				yellow.Printf("Current repo:      %s\n", repo)
				yellow.Printf("Only project:      %s\n", getProjectDisplayName(selectedProject))

				if ui.IsInteractive() {
					continueAnyway, _ := ui.Confirm("Continue anyway?", false)
					if !continueAnyway {
						return nil
					}
				}
			}
		} else {
			ui.Warn(fmt.Sprintf("No matching project found for %s", repo))
			ui.Message(ui.Dim("Select a project manually:"))

			selected, err := promptProjectSelection(projects, repo, providerDisplayName, len(connections) > 1)
			if err != nil {
				return err
			}
			selectedProject = selected
		}
	}

	// Determine environment and direction
	keywayEnv := envFlag
	providerEnv := providerEnvFlag
	var direction string
	if pushFlag {
		direction = "push"
	} else if pullFlag {
		direction = "pull"
	}

	needsEnvPrompt := keywayEnv == ""
	needsDirectionPrompt := direction == ""

	if needsEnvPrompt && ui.IsInteractive() {
		// Get available environments
		vaultEnvs, err := client.GetVaultEnvironments(ctx, repo)
		if err != nil || len(vaultEnvs) == 0 {
			vaultEnvs = []string{"production", "staging", "development"}
		}

		selected, err := ui.Select("Keyway environment:", vaultEnvs)
		if err != nil {
			return err
		}
		keywayEnv = selected

		// Auto-map provider environment if not specified
		if providerEnv == "" {
			if len(selectedProject.Environments) > 0 {
				mapped := mapToProviderEnvironment(provider, keywayEnv)
				// Check if mapped env exists
				found := false
				for _, e := range selectedProject.Environments {
					if strings.EqualFold(e, mapped) {
						providerEnv = mapped
						found = true
						break
					}
				}
				if !found && len(selectedProject.Environments) > 1 {
					// Multiple envs, ask user
					selected, err := ui.Select(fmt.Sprintf("%s environment:", providerDisplayName), selectedProject.Environments)
					if err != nil {
						return err
					}
					providerEnv = selected
				} else if !found {
					providerEnv = selectedProject.Environments[0]
					ui.Message(ui.Dim(fmt.Sprintf("Using %s environment: %s", providerDisplayName, providerEnv)))
				}
			} else {
				providerEnv = mapToProviderEnvironment(provider, keywayEnv)
			}
		}
	}

	// Default values
	if keywayEnv == "" {
		keywayEnv = "production"
	}
	if providerEnv == "" {
		providerEnv = mapToProviderEnvironment(provider, keywayEnv)
	}

	// Get diff and prompt for direction
	var diff *api.SyncDiff
	if needsDirectionPrompt && ui.IsInteractive() {
		err = ui.Spin("Comparing secrets...", func() error {
			var err error
			diff, err = client.GetSyncDiff(ctx, repo, api.SyncOptions{
				ConnectionID:        selectedProject.ConnectionID,
				ProjectID:           selectedProject.ID,
				ServiceID:           selectedProject.ServiceID,
				KeywayEnvironment:   keywayEnv,
				ProviderEnvironment: providerEnv,
			})
			return err
		})
		if err != nil {
			ui.Error("Failed to compare secrets")
			return err
		}

		displayDiffSummary(diff, providerDisplayName)

		totalDiff := len(diff.OnlyInKeyway) + len(diff.OnlyInProvider) + len(diff.Different)
		if totalDiff == 0 {
			return nil
		}

		// Smart default direction
		defaultDirection := "push"
		if diff.KeywayCount == 0 && diff.ProviderCount > 0 {
			defaultDirection = "pull"
		}

		options := []string{
			fmt.Sprintf("Keyway → %s", providerDisplayName),
			fmt.Sprintf("%s → Keyway", providerDisplayName),
		}
		if defaultDirection == "pull" {
			options = []string{options[1], options[0]}
		}

		selected, err := ui.Select("Sync direction:", options)
		if err != nil {
			return err
		}

		if strings.Contains(selected, "→ "+providerDisplayName) {
			direction = "push"
		} else {
			direction = "pull"
		}
	}

	if direction == "" {
		direction = "push"
	}

	// Check first sync status
	status, err := client.GetSyncStatus(ctx, repo, selectedProject.ConnectionID, selectedProject.ID, keywayEnv)
	if err == nil && status.IsFirstSync && direction == "push" && status.VaultIsEmpty && status.ProviderHasSecrets {
		ui.Warn(fmt.Sprintf("Your Keyway vault is empty for \"%s\", but %s has %d secrets.",
			keywayEnv, providerDisplayName, status.ProviderSecretCount))
		ui.Message(ui.Dim("(Use --env to sync a different environment)"))

		if ui.IsInteractive() {
			importFirst, _ := ui.Confirm(fmt.Sprintf("Import secrets from %s first?", providerDisplayName), true)
			if importFirst {
				direction = "pull"
				allowDelete = false
			}
		}
	}

	// Execute sync
	return executeSyncOperation(client, ctx, repo, selectedProject, keywayEnv, providerEnv, direction, allowDelete, skipConfirm, provider)
}

func promptProjectSelection(projects []ProjectWithLinkedRepo, repoFullName, providerDisplayName string, hasMultipleAccounts bool) (ProjectWithLinkedRepo, error) {
	repoName := strings.ToLower(strings.Split(repoFullName, "/")[1])

	options := make([]string, len(projects))
	for i, p := range projects {
		displayName := getProjectDisplayName(p)
		label := displayName

		var badges []string

		// Add team info if multiple accounts
		if hasMultipleAccounts {
			if p.TeamName != nil {
				badges = append(badges, color.CyanString("[%s]", *p.TeamName))
			} else if p.TeamID != nil {
				shortID := *p.TeamID
				if len(shortID) > 12 {
					shortID = shortID[:12] + "..."
				}
				badges = append(badges, color.CyanString("[team:%s]", shortID))
			} else {
				badges = append(badges, color.CyanString("[personal]"))
			}
		}

		// Add match badges
		if p.LinkedRepo != nil && strings.ToLower(*p.LinkedRepo) == strings.ToLower(repoFullName) {
			badges = append(badges, color.GreenString("← linked"))
		} else if strings.ToLower(p.Name) == repoName {
			badges = append(badges, color.GreenString("← same name"))
		} else if p.LinkedRepo != nil {
			badges = append(badges, color.HiBlackString("→ %s", *p.LinkedRepo))
		}

		if len(badges) > 0 {
			label = fmt.Sprintf("%s %s", displayName, strings.Join(badges, " "))
		}

		options[i] = label
	}

	selected, err := ui.Select("Select a project:", options)
	if err != nil {
		return ProjectWithLinkedRepo{}, err
	}

	// Find the selected project by matching the display name at the start
	for _, p := range projects {
		displayName := getProjectDisplayName(p)
		if strings.HasPrefix(selected, displayName) {
			return p, nil
		}
	}

	return ProjectWithLinkedRepo{}, fmt.Errorf("project not found")
}

func displayDiffSummary(diff *api.SyncDiff, providerName string) {
	totalDiff := len(diff.OnlyInKeyway) + len(diff.OnlyInProvider) + len(diff.Different)

	if totalDiff == 0 && len(diff.Same) > 0 {
		ui.Success(fmt.Sprintf("Already in sync (%d secrets)", len(diff.Same)))
		return
	}

	ui.Step("Comparison Summary")
	ui.Message(ui.Dim(fmt.Sprintf("Keyway: %d secrets | %s: %d secrets", diff.KeywayCount, providerName, diff.ProviderCount)))

	cyan := color.New(color.FgCyan)
	magenta := color.New(color.FgMagenta)
	yellow := color.New(color.FgYellow)

	if len(diff.OnlyInKeyway) > 0 {
		cyan.Printf("→ %d only in Keyway\n", len(diff.OnlyInKeyway))
		for i, key := range diff.OnlyInKeyway {
			if i >= 3 {
				ui.Message(ui.Dim(fmt.Sprintf("  ... and %d more", len(diff.OnlyInKeyway)-3)))
				break
			}
			ui.Message(ui.Dim(fmt.Sprintf("  %s", key)))
		}
	}

	if len(diff.OnlyInProvider) > 0 {
		magenta.Printf("← %d only in %s\n", len(diff.OnlyInProvider), providerName)
		for i, key := range diff.OnlyInProvider {
			if i >= 3 {
				ui.Message(ui.Dim(fmt.Sprintf("  ... and %d more", len(diff.OnlyInProvider)-3)))
				break
			}
			ui.Message(ui.Dim(fmt.Sprintf("  %s", key)))
		}
	}

	if len(diff.Different) > 0 {
		yellow.Printf("≠ %d with different values\n", len(diff.Different))
		for i, key := range diff.Different {
			if i >= 3 {
				ui.Message(ui.Dim(fmt.Sprintf("  ... and %d more", len(diff.Different)-3)))
				break
			}
			ui.Message(ui.Dim(fmt.Sprintf("  %s", key)))
		}
	}

	if len(diff.Same) > 0 {
		ui.Message(ui.Dim(fmt.Sprintf("= %d identical", len(diff.Same))))
	}
}

func executeSyncOperation(client *api.Client, ctx context.Context, repo string, project ProjectWithLinkedRepo, keywayEnv, providerEnv, direction string, allowDelete, skipConfirm bool, provider string) error {
	providerName := strings.Title(provider)

	// Get preview
	var preview *api.SyncPreview
	err := ui.Spin("Generating preview...", func() error {
		var err error
		preview, err = client.GetSyncPreview(ctx, repo, api.SyncOptions{
			ConnectionID:        project.ConnectionID,
			ProjectID:           project.ID,
			ServiceID:           project.ServiceID,
			KeywayEnvironment:   keywayEnv,
			ProviderEnvironment: providerEnv,
			Direction:           direction,
			AllowDelete:         allowDelete,
		})
		return err
	})
	if err != nil {
		ui.Error("Failed to generate preview")
		return err
	}

	totalChanges := len(preview.ToCreate) + len(preview.ToUpdate) + len(preview.ToDelete)

	if totalChanges == 0 {
		ui.Success("Already in sync. No changes needed.")
		return nil
	}

	// Show preview
	ui.Step("Sync Preview")

	green := color.New(color.FgGreen)
	yellow := color.New(color.FgYellow)
	red := color.New(color.FgRed)

	if len(preview.ToCreate) > 0 {
		green.Printf("+ %d to create\n", len(preview.ToCreate))
		for i, key := range preview.ToCreate {
			if i >= 5 {
				ui.Message(ui.Dim(fmt.Sprintf("  ... and %d more", len(preview.ToCreate)-5)))
				break
			}
			ui.Message(ui.Dim(fmt.Sprintf("  %s", key)))
		}
	}

	if len(preview.ToUpdate) > 0 {
		yellow.Printf("~ %d to update\n", len(preview.ToUpdate))
		for i, key := range preview.ToUpdate {
			if i >= 5 {
				ui.Message(ui.Dim(fmt.Sprintf("  ... and %d more", len(preview.ToUpdate)-5)))
				break
			}
			ui.Message(ui.Dim(fmt.Sprintf("  %s", key)))
		}
	}

	if len(preview.ToDelete) > 0 {
		red.Printf("- %d to delete\n", len(preview.ToDelete))
		for i, key := range preview.ToDelete {
			if i >= 5 {
				ui.Message(ui.Dim(fmt.Sprintf("  ... and %d more", len(preview.ToDelete)-5)))
				break
			}
			ui.Message(ui.Dim(fmt.Sprintf("  %s", key)))
		}
	}

	if len(preview.ToSkip) > 0 {
		ui.Message(ui.Dim(fmt.Sprintf("○ %d unchanged", len(preview.ToSkip))))
	}

	// Confirm
	if !skipConfirm && ui.IsInteractive() {
		target := providerName
		if direction == "pull" {
			target = "Keyway"
		}

		confirm, _ := ui.Confirm(fmt.Sprintf("Apply %d changes to %s?", totalChanges, target), true)
		if !confirm {
			return nil
		}
	}

	// Execute
	var result *api.SyncResult
	err = ui.Spin("Syncing...", func() error {
		var err error
		result, err = client.ExecuteSync(ctx, repo, api.SyncOptions{
			ConnectionID:        project.ConnectionID,
			ProjectID:           project.ID,
			ServiceID:           project.ServiceID,
			KeywayEnvironment:   keywayEnv,
			ProviderEnvironment: providerEnv,
			Direction:           direction,
			AllowDelete:         allowDelete,
		})
		return err
	})

	if err != nil {
		analytics.Track(analytics.EventError, map[string]interface{}{
			"command": "sync",
			"error":   err.Error(),
		})
		ui.Error("Sync failed")
		return err
	}

	if result.Success {
		// Track sync event
		analytics.Track(analytics.EventSync, map[string]interface{}{
			"provider":  provider,
			"direction": direction,
			"created":   result.Stats.Created,
			"updated":   result.Stats.Updated,
			"deleted":   result.Stats.Deleted,
		})

		ui.Success("Sync complete!")
		ui.Message(ui.Dim(fmt.Sprintf("Created: %d", result.Stats.Created)))
		ui.Message(ui.Dim(fmt.Sprintf("Updated: %d", result.Stats.Updated)))
		if result.Stats.Deleted > 0 {
			ui.Message(ui.Dim(fmt.Sprintf("Deleted: %d", result.Stats.Deleted)))
		}
	} else {
		ui.Error(result.Error)
		return fmt.Errorf("%s", result.Error)
	}

	return nil
}
