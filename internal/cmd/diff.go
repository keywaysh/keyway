package cmd

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/fatih/color"
	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/spf13/cobra"
)

var yellow = color.New(color.FgYellow)

var diffCmd = &cobra.Command{
	Use:   "diff [env1] [env2]",
	Short: "Compare secrets between two environments",
	Long: `Compare secrets between two environments to find differences.

When run without arguments in an interactive terminal, prompts for environment selection.

Examples:
  keyway diff                           # Interactive selection
  keyway diff production staging
  keyway diff development production --show-values
  keyway diff prod dev --keys-only`,
	Args: cobra.RangeArgs(0, 2),
	RunE: runDiff,
}

func init() {
	diffCmd.Flags().Bool("show-values", false, "Show actual value differences (sensitive!)")
	diffCmd.Flags().Bool("keys-only", false, "Only show key names, no status details")
	diffCmd.Flags().Bool("json", false, "Output as JSON")
}

// DiffResult represents the comparison between two environments
type DiffResult struct {
	Env1       string       `json:"env1"`
	Env2       string       `json:"env2"`
	OnlyInEnv1 []string     `json:"onlyInEnv1"`
	OnlyInEnv2 []string     `json:"onlyInEnv2"`
	Different  []DiffEntry  `json:"different"`
	Same       []string     `json:"same"`
	Stats      DiffStats    `json:"stats"`
}

type DiffEntry struct {
	Key      string `json:"key"`
	Value1   string `json:"value1,omitempty"`
	Value2   string `json:"value2,omitempty"`
	Preview1 string `json:"preview1,omitempty"`
	Preview2 string `json:"preview2,omitempty"`
}

type DiffStats struct {
	TotalEnv1  int `json:"totalEnv1"`
	TotalEnv2  int `json:"totalEnv2"`
	OnlyInEnv1 int `json:"onlyInEnv1"`
	OnlyInEnv2 int `json:"onlyInEnv2"`
	Different  int `json:"different"`
	Same       int `json:"same"`
}

func runDiff(cmd *cobra.Command, args []string) error {
	ui.Intro("diff")

	repo, err := git.DetectRepo()
	if err != nil {
		ui.Error("Not in a git repository with GitHub remote")
		return err
	}
	ui.Step(fmt.Sprintf("Repository: %s", ui.Value(repo)))

	token, err := EnsureLogin()
	if err != nil {
		return err
	}

	client := api.NewClient(token)
	ctx := context.Background()

	var env1, env2 string

	// If arguments not provided, prompt interactively
	if len(args) < 2 {
		if !ui.IsInteractive() {
			ui.Error("Two environment arguments required in non-interactive mode")
			return fmt.Errorf("missing arguments")
		}

		// Fetch available environments
		var environments []string
		err = ui.Spin("Fetching environments...", func() error {
			var fetchErr error
			environments, fetchErr = client.GetVaultEnvironments(ctx, repo)
			return fetchErr
		})
		if err != nil {
			ui.Error(fmt.Sprintf("Failed to fetch environments: %v", err))
			return err
		}

		if len(environments) < 2 {
			ui.Error("At least 2 environments are needed to compare")
			ui.Message(ui.Dim("Push secrets to more environments first with: keyway push -e <env>"))
			return fmt.Errorf("not enough environments")
		}

		// First environment selection
		if len(args) == 0 {
			env1, err = ui.Select("Select first environment:", environments)
			if err != nil {
				return err
			}
		} else {
			env1 = normalizeEnvName(args[0])
		}

		// Filter out selected env1 for second selection
		remaining := make([]string, 0, len(environments)-1)
		for _, e := range environments {
			if e != env1 {
				remaining = append(remaining, e)
			}
		}

		if len(remaining) == 0 {
			ui.Error("No other environments to compare with")
			return fmt.Errorf("no environments")
		}

		env2, err = ui.Select("Select second environment:", remaining)
		if err != nil {
			return err
		}
	} else {
		env1 = normalizeEnvName(args[0])
		env2 = normalizeEnvName(args[1])
	}

	ui.Message(ui.Dim(fmt.Sprintf("Comparing %s vs %s", ui.Bold(env1), ui.Bold(env2))))

	if env1 == env2 {
		ui.Error("Cannot compare an environment with itself")
		return fmt.Errorf("same environment")
	}

	showValues, _ := cmd.Flags().GetBool("show-values")
	keysOnly, _ := cmd.Flags().GetBool("keys-only")
	jsonOutput, _ := cmd.Flags().GetBool("json")

	// Pull secrets from both environments
	var secrets1, secrets2 map[string]string
	var pullErr1, pullErr2 error

	err = ui.Spin(fmt.Sprintf("Fetching %s and %s...", env1, env2), func() error {
		resp1, err := client.PullSecrets(ctx, repo, env1)
		if err != nil {
			pullErr1 = err
		} else {
			secrets1 = parseEnvContent(resp1.Content)
		}

		resp2, err := client.PullSecrets(ctx, repo, env2)
		if err != nil {
			pullErr2 = err
		} else {
			secrets2 = parseEnvContent(resp2.Content)
		}

		return nil
	})

	if err != nil {
		return err
	}

	// Handle pull errors
	if pullErr1 != nil && pullErr2 != nil {
		ui.Error(fmt.Sprintf("Failed to fetch both environments: %s, %s", env1, env2))
		return fmt.Errorf("failed to fetch environments")
	}
	if pullErr1 != nil {
		ui.Warn(fmt.Sprintf("Environment '%s' is empty or doesn't exist", env1))
		secrets1 = make(map[string]string)
	}
	if pullErr2 != nil {
		ui.Warn(fmt.Sprintf("Environment '%s' is empty or doesn't exist", env2))
		secrets2 = make(map[string]string)
	}

	// Compare secrets
	result := compareSecrets(env1, env2, secrets1, secrets2, showValues)

	// Track diff event
	analytics.Track(analytics.EventDiff, map[string]interface{}{
		"env1":              env1,
		"env2":              env2,
		"differences_count": result.Stats.Different + result.Stats.OnlyInEnv1 + result.Stats.OnlyInEnv2,
		"same_count":        result.Stats.Same,
		"total_env1":        result.Stats.TotalEnv1,
		"total_env2":        result.Stats.TotalEnv2,
	})

	if jsonOutput {
		return printDiffJSON(result)
	}

	// Display results
	printDiffResults(result, env1, env2, showValues, keysOnly)

	ui.Outro("")
	return nil
}

func normalizeEnvName(env string) string {
	env = strings.ToLower(strings.TrimSpace(env))
	switch env {
	case "prod":
		return "production"
	case "dev":
		return "development"
	case "stg":
		return "staging"
	default:
		return env
	}
}

// parseEnvContent is defined in push.go and reused here

func compareSecrets(env1, env2 string, secrets1, secrets2 map[string]string, includeValues bool) *DiffResult {
	result := &DiffResult{
		Env1:       env1,
		Env2:       env2,
		OnlyInEnv1: []string{},
		OnlyInEnv2: []string{},
		Different:  []DiffEntry{},
		Same:       []string{},
	}

	// Get all keys
	allKeys := make(map[string]bool)
	for k := range secrets1 {
		allKeys[k] = true
	}
	for k := range secrets2 {
		allKeys[k] = true
	}

	// Sort keys for consistent output
	sortedKeys := make([]string, 0, len(allKeys))
	for k := range allKeys {
		sortedKeys = append(sortedKeys, k)
	}
	sort.Strings(sortedKeys)

	// Compare
	for _, key := range sortedKeys {
		val1, in1 := secrets1[key]
		val2, in2 := secrets2[key]

		if in1 && !in2 {
			result.OnlyInEnv1 = append(result.OnlyInEnv1, key)
		} else if !in1 && in2 {
			result.OnlyInEnv2 = append(result.OnlyInEnv2, key)
		} else if val1 != val2 {
			entry := DiffEntry{
				Key:      key,
				Preview1: previewValue(val1),
				Preview2: previewValue(val2),
			}
			if includeValues {
				entry.Value1 = val1
				entry.Value2 = val2
			}
			result.Different = append(result.Different, entry)
		} else {
			result.Same = append(result.Same, key)
		}
	}

	// Stats
	result.Stats = DiffStats{
		TotalEnv1:  len(secrets1),
		TotalEnv2:  len(secrets2),
		OnlyInEnv1: len(result.OnlyInEnv1),
		OnlyInEnv2: len(result.OnlyInEnv2),
		Different:  len(result.Different),
		Same:       len(result.Same),
	}

	return result
}

// previewValue returns a safe preview of a secret value
// Shows last 2 chars + length to help identify changes without exposing sensitive data
// Last chars are more distinctive than first chars (which are often common prefixes like sk_, gh_, etc.)
func previewValue(value string) string {
	length := len(value)
	if length == 0 {
		return "(empty)"
	}
	if length <= 2 {
		return fmt.Sprintf("**%s (%d chars)", value, length)
	}
	return fmt.Sprintf("**%s (%d chars)", value[length-2:], length)
}

func maskValue(value string) string {
	if len(value) <= 4 {
		return "****"
	}
	return value[:2] + strings.Repeat("*", len(value)-4) + value[len(value)-2:]
}

func printDiffResults(result *DiffResult, env1, env2 string, showValues, keysOnly bool) {
	// Summary
	if result.Stats.OnlyInEnv1 == 0 && result.Stats.OnlyInEnv2 == 0 && result.Stats.Different == 0 {
		ui.Success("Environments are identical!")
		ui.Message(ui.Dim(fmt.Sprintf("%d secrets in both environments", result.Stats.Same)))
		return
	}

	// Only in env1
	if len(result.OnlyInEnv1) > 0 {
		fmt.Println()
		ui.Message(fmt.Sprintf("Only in %s (%d):", ui.Bold(env1), len(result.OnlyInEnv1)))
		for _, key := range result.OnlyInEnv1 {
			if keysOnly {
				fmt.Printf("  %s\n", key)
			} else {
				fmt.Printf("  %s %s\n", ui.Value("-"), key)
			}
		}
	}

	// Only in env2
	if len(result.OnlyInEnv2) > 0 {
		fmt.Println()
		ui.Message(fmt.Sprintf("Only in %s (%d):", ui.Bold(env2), len(result.OnlyInEnv2)))
		for _, key := range result.OnlyInEnv2 {
			if keysOnly {
				fmt.Printf("  %s\n", key)
			} else {
				fmt.Printf("  %s %s\n", ui.Value("+"), key)
			}
		}
	}

	// Different values
	if len(result.Different) > 0 {
		fmt.Println()
		ui.Message(fmt.Sprintf("Different values (%d):", len(result.Different)))
		for _, entry := range result.Different {
			if keysOnly {
				fmt.Printf("  %s\n", entry.Key)
			} else if showValues {
				fmt.Printf("  %s %s\n", yellow.Sprint("~"), entry.Key)
				fmt.Printf("    %s: %s\n", env1, maskValue(entry.Value1))
				fmt.Printf("    %s: %s\n", env2, maskValue(entry.Value2))
			} else {
				fmt.Printf("  %s %s %s\n", yellow.Sprint("~"), entry.Key, ui.Dim(fmt.Sprintf("%s → %s", entry.Preview1, entry.Preview2)))
			}
		}
	}

	// Summary stats
	fmt.Println()
	ui.Step("Summary:")
	ui.Message(ui.Dim(fmt.Sprintf("  %s: %d secrets", env1, result.Stats.TotalEnv1)))
	ui.Message(ui.Dim(fmt.Sprintf("  %s: %d secrets", env2, result.Stats.TotalEnv2)))

	if result.Stats.Same > 0 {
		ui.Message(ui.Dim(fmt.Sprintf("  Identical: %d", result.Stats.Same)))
	}
	if result.Stats.Different > 0 {
		ui.Message(fmt.Sprintf("  Different: %d", result.Stats.Different))
	}
	if result.Stats.OnlyInEnv1 > 0 {
		ui.Message(fmt.Sprintf("  Only in %s: %d", env1, result.Stats.OnlyInEnv1))
	}
	if result.Stats.OnlyInEnv2 > 0 {
		ui.Message(fmt.Sprintf("  Only in %s: %d", env2, result.Stats.OnlyInEnv2))
	}
}

func printDiffJSON(result *DiffResult) error {
	// Simple JSON output without external dependency
	fmt.Println("{")
	fmt.Printf("  \"env1\": %q,\n", result.Env1)
	fmt.Printf("  \"env2\": %q,\n", result.Env2)

	// OnlyInEnv1
	fmt.Print("  \"onlyInEnv1\": [")
	for i, k := range result.OnlyInEnv1 {
		if i > 0 {
			fmt.Print(", ")
		}
		fmt.Printf("%q", k)
	}
	fmt.Println("],")

	// OnlyInEnv2
	fmt.Print("  \"onlyInEnv2\": [")
	for i, k := range result.OnlyInEnv2 {
		if i > 0 {
			fmt.Print(", ")
		}
		fmt.Printf("%q", k)
	}
	fmt.Println("],")

	// Different
	fmt.Print("  \"different\": [")
	for i, d := range result.Different {
		if i > 0 {
			fmt.Print(", ")
		}
		fmt.Printf("{\"key\": %q, \"preview1\": %q, \"preview2\": %q}", d.Key, d.Preview1, d.Preview2)
	}
	fmt.Println("],")

	// Same
	fmt.Print("  \"same\": [")
	for i, k := range result.Same {
		if i > 0 {
			fmt.Print(", ")
		}
		fmt.Printf("%q", k)
	}
	fmt.Println("],")

	// Stats
	fmt.Println("  \"stats\": {")
	fmt.Printf("    \"totalEnv1\": %d,\n", result.Stats.TotalEnv1)
	fmt.Printf("    \"totalEnv2\": %d,\n", result.Stats.TotalEnv2)
	fmt.Printf("    \"onlyInEnv1\": %d,\n", result.Stats.OnlyInEnv1)
	fmt.Printf("    \"onlyInEnv2\": %d,\n", result.Stats.OnlyInEnv2)
	fmt.Printf("    \"different\": %d,\n", result.Stats.Different)
	fmt.Printf("    \"same\": %d\n", result.Stats.Same)
	fmt.Println("  }")
	fmt.Println("}")

	return nil
}
