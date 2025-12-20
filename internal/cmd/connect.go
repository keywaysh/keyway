package cmd

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/pkg/browser"
	"github.com/spf13/cobra"
)

// Providers that use direct token auth instead of OAuth
var tokenAuthProviders = []string{"railway"}

var connectCmd = &cobra.Command{
	Use:   "connect <provider>",
	Short: "Connect to a provider (vercel, railway)",
	Long:  `Connect your Keyway account to a provider like Vercel or Railway for syncing secrets.`,
	Args:  cobra.ExactArgs(1),
	RunE:  runConnect,
}

var connectionsCmd = &cobra.Command{
	Use:   "connections",
	Short: "List provider connections",
	Long:  `List all your provider connections.`,
	RunE:  runConnections,
}

var disconnectCmd = &cobra.Command{
	Use:   "disconnect <provider>",
	Short: "Disconnect from a provider",
	Long:  `Remove a provider connection.`,
	Args:  cobra.ExactArgs(1),
	RunE:  runDisconnect,
}

func isTokenAuthProvider(provider string) bool {
	for _, p := range tokenAuthProviders {
		if strings.EqualFold(p, provider) {
			return true
		}
	}
	return false
}

func getTokenCreationURL(provider string) string {
	switch strings.ToLower(provider) {
	case "railway":
		return "https://railway.com/account/tokens"
	default:
		return ""
	}
}

func runConnect(cmd *cobra.Command, args []string) error {
	provider := strings.ToLower(args[0])

	token, err := EnsureLogin()
	if err != nil {
		return err
	}

	client := api.NewClient(token)
	ctx := context.Background()

	// Validate provider exists
	providers, err := client.GetProviders(ctx)
	if err != nil {
		ui.Error("Failed to fetch providers")
		return err
	}

	var providerInfo *api.Provider
	for _, p := range providers {
		if strings.EqualFold(p.Name, provider) {
			providerInfo = &p
			break
		}
	}

	if providerInfo == nil {
		available := make([]string, len(providers))
		for i, p := range providers {
			available[i] = p.Name
		}
		ui.Error(fmt.Sprintf("Unknown provider: %s", provider))
		ui.Message(ui.Dim(fmt.Sprintf("Available providers: %s", strings.Join(available, ", "))))
		return fmt.Errorf("unknown provider")
	}

	if !providerInfo.Configured {
		ui.Error(fmt.Sprintf("Provider %s is not configured on the server", providerInfo.DisplayName))
		ui.Message(ui.Dim("Contact your administrator to enable this integration."))
		return fmt.Errorf("provider not configured")
	}

	// Check existing connections
	connections, err := client.GetConnections(ctx)
	if err != nil {
		ui.Error("Failed to fetch connections")
		return err
	}

	var existingConnections []api.Connection
	for _, c := range connections {
		if strings.EqualFold(c.Provider, provider) {
			existingConnections = append(existingConnections, c)
		}
	}

	if len(existingConnections) > 0 && ui.IsInteractive() {
		ui.Message(ui.Dim(fmt.Sprintf("You have %d %s connection(s):", len(existingConnections), providerInfo.DisplayName)))
		for _, conn := range existingConnections {
			teamInfo := "(Personal)"
			if conn.ProviderTeamID != nil {
				teamInfo = fmt.Sprintf("(Team: %s)", *conn.ProviderTeamID)
			}
			ui.Message(ui.Dim(fmt.Sprintf("  - %s", teamInfo)))
		}

		action, err := ui.Select("What would you like to do?", []string{"Add another account/team", "Cancel"})
		if err != nil || action == "Cancel" {
			ui.Message(ui.Dim("Keeping existing connections."))
			return nil
		}
	}

	ui.Step(fmt.Sprintf("Connecting to %s...", providerInfo.DisplayName))

	var connected bool

	if isTokenAuthProvider(provider) {
		connected, err = connectWithTokenFlow(client, ctx, provider, providerInfo.DisplayName)
	} else {
		connected, err = connectWithOAuthFlow(client, ctx, provider, providerInfo.DisplayName)
	}

	if err != nil {
		analytics.Track(analytics.EventError, map[string]interface{}{
			"command": "connect",
			"error":   err.Error(),
		})
		return err
	}

	// Track connect event
	analytics.Track(analytics.EventConnect, map[string]interface{}{
		"provider": provider,
		"success":  connected,
	})

	if !connected {
		return fmt.Errorf("connection failed")
	}

	return nil
}

func connectWithTokenFlow(client *api.Client, ctx context.Context, provider, displayName string) (bool, error) {
	tokenURL := getTokenCreationURL(provider)

	if provider == "railway" {
		ui.Warn("Tip: Select the workspace containing your projects.")
		ui.Message(ui.Dim("Do NOT use \"No workspace\" - it won't have access to your projects."))
	}

	_ = browser.OpenURL(tokenURL)

	token, err := ui.Password(fmt.Sprintf("%s API Token:", displayName))
	if err != nil || token == "" {
		ui.Message(ui.Dim("Cancelled."))
		return false, nil
	}

	var resp *api.ConnectTokenResponse
	err = ui.Spin("Validating token...", func() error {
		var err error
		resp, err = client.ConnectWithToken(ctx, provider, token)
		return err
	})

	if err != nil {
		ui.Error(err.Error())
		return false, nil
	}

	if resp.Success {
		ui.Success(fmt.Sprintf("Connected to %s!", displayName))
		ui.Message(ui.Dim(fmt.Sprintf("Account: %s", resp.User.Username)))
		if resp.User.TeamName != nil {
			ui.Message(ui.Dim(fmt.Sprintf("Team: %s", *resp.User.TeamName)))
		}
		return true, nil
	}

	ui.Error("Connection failed.")
	return false, nil
}

func connectWithOAuthFlow(client *api.Client, ctx context.Context, provider, displayName string) (bool, error) {
	authURL := client.GetProviderAuthURL(provider)
	startTime := time.Now()

	_ = browser.OpenURL(authURL)

	var connected bool
	err := ui.Spin("Waiting for authorization...", func() error {
		maxAttempts := 60 // 5 minutes max
		for i := 0; i < maxAttempts; i++ {
			time.Sleep(5 * time.Second)

			connections, err := client.GetConnections(ctx)
			if err != nil {
				continue
			}

			for _, c := range connections {
				if strings.EqualFold(c.Provider, provider) {
					// Check if this is a new connection (created after we started)
					createdAt, err := time.Parse(time.RFC3339, c.CreatedAt)
					if err == nil && createdAt.After(startTime) {
						connected = true
						return nil
					}
				}
			}
		}
		return fmt.Errorf("authorization timeout")
	})

	if err != nil {
		ui.Error("Authorization timeout.")
		ui.Message(ui.Dim("Run `keyway connections` to check if the connection was established."))
		return false, nil
	}

	if connected {
		ui.Success(fmt.Sprintf("Connected to %s!", displayName))
		return true, nil
	}

	return false, nil
}

func runConnections(cmd *cobra.Command, args []string) error {
	token, err := EnsureLogin()
	if err != nil {
		return err
	}

	client := api.NewClient(token)
	ctx := context.Background()

	connections, err := client.GetConnections(ctx)
	if err != nil {
		ui.Error("Failed to fetch connections")
		return err
	}

	if len(connections) == 0 {
		ui.Info("No provider connections found.")
		ui.Message(ui.Dim("Connect to a provider with: keyway connect <provider>"))
		ui.Message(ui.Dim("Available providers: vercel, railway"))
		return nil
	}

	ui.Intro("connections")

	for _, conn := range connections {
		providerName := strings.Title(conn.Provider)
		teamInfo := ""
		if conn.ProviderTeamID != nil {
			teamInfo = ui.Dim(fmt.Sprintf(" (Team: %s)", *conn.ProviderTeamID))
		}

		// Parse and format date
		createdAt, _ := time.Parse(time.RFC3339, conn.CreatedAt)
		dateStr := createdAt.Format("2006-01-02")

		ui.Success(fmt.Sprintf("%s%s", ui.Bold(providerName), teamInfo))
		ui.Message(ui.Dim(fmt.Sprintf("  Connected: %s", dateStr)))
		ui.Message(ui.Dim(fmt.Sprintf("  ID: %s", conn.ID)))
	}

	fmt.Println()
	return nil
}

func runDisconnect(cmd *cobra.Command, args []string) error {
	provider := strings.ToLower(args[0])

	token, err := EnsureLogin()
	if err != nil {
		return err
	}

	client := api.NewClient(token)
	ctx := context.Background()

	connections, err := client.GetConnections(ctx)
	if err != nil {
		ui.Error("Failed to fetch connections")
		return err
	}

	var connection *api.Connection
	for _, c := range connections {
		if strings.EqualFold(c.Provider, provider) {
			connection = &c
			break
		}
	}

	if connection == nil {
		ui.Info(fmt.Sprintf("No connection found for provider: %s", provider))
		return nil
	}

	providerName := strings.Title(provider)

	if ui.IsInteractive() {
		confirm, _ := ui.Confirm(fmt.Sprintf("Disconnect from %s?", providerName), false)
		if !confirm {
			ui.Message(ui.Dim("Cancelled."))
			return nil
		}
	}

	err = client.DeleteConnection(ctx, connection.ID)
	if err != nil {
		analytics.Track(analytics.EventError, map[string]interface{}{
			"command": "disconnect",
			"error":   err.Error(),
		})
		ui.Error("Failed to disconnect")
		return err
	}

	// Track disconnect event
	analytics.Track(analytics.EventDisconnect, map[string]interface{}{
		"provider": provider,
	})

	ui.Success(fmt.Sprintf("Disconnected from %s", providerName))
	return nil
}

// RunConnectCommand runs the connect command (for use by sync command)
func RunConnectCommand(provider string) error {
	return runConnect(connectCmd, []string{provider})
}
