package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/spf13/cobra"
)

// SecretPattern defines a pattern for detecting secrets
type SecretPattern struct {
	Name        string
	Regex       *regexp.Regexp
	Description string
}

// Finding represents a detected secret
type Finding struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Type    string `json:"type"`
	Match   string `json:"match,omitempty"`
	Preview string `json:"preview"`
}

// ScanResult represents the complete scan output
type ScanResult struct {
	FilesScanned int       `json:"filesScanned"`
	Findings     []Finding `json:"findings"`
}

// Default patterns to detect secrets
var secretPatterns = []SecretPattern{
	// AWS
	{
		Name:        "AWS Access Key",
		Regex:       regexp.MustCompile(`\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b`),
		Description: "AWS Access Key ID",
	},
	{
		Name:        "AWS Secret Key",
		Regex:       regexp.MustCompile(`(?i)aws_secret_access_key\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?`),
		Description: "AWS Secret Access Key",
	},
	// GitHub
	{
		Name:        "GitHub PAT",
		Regex:       regexp.MustCompile(`ghp_[0-9a-zA-Z]{36}`),
		Description: "GitHub Personal Access Token",
	},
	{
		Name:        "GitHub PAT (fine-grained)",
		Regex:       regexp.MustCompile(`github_pat_[0-9a-zA-Z_]{82}`),
		Description: "GitHub Fine-Grained Personal Access Token",
	},
	{
		Name:        "GitHub OAuth",
		Regex:       regexp.MustCompile(`gho_[0-9a-zA-Z]{36}`),
		Description: "GitHub OAuth Token",
	},
	{
		Name:        "GitHub App Token",
		Regex:       regexp.MustCompile(`ghu_[0-9a-zA-Z]{36}`),
		Description: "GitHub App User Token",
	},
	{
		Name:        "GitHub Refresh Token",
		Regex:       regexp.MustCompile(`ghr_[0-9a-zA-Z]{36}`),
		Description: "GitHub Refresh Token",
	},
	// GitLab
	{
		Name:        "GitLab Token",
		Regex:       regexp.MustCompile(`glpat-[0-9a-zA-Z_-]{20,}`),
		Description: "GitLab Personal Access Token",
	},
	// Stripe
	{
		Name:        "Stripe Secret Key",
		Regex:       regexp.MustCompile(`sk_live_[0-9a-zA-Z]{24,}`),
		Description: "Stripe Live Secret Key",
	},
	{
		Name:        "Stripe Publishable Key",
		Regex:       regexp.MustCompile(`pk_live_[0-9a-zA-Z]{24,}`),
		Description: "Stripe Live Publishable Key",
	},
	{
		Name:        "Stripe Restricted Key",
		Regex:       regexp.MustCompile(`rk_live_[0-9a-zA-Z]{24,}`),
		Description: "Stripe Live Restricted Key",
	},
	// Private Keys
	{
		Name:        "Private Key",
		Regex:       regexp.MustCompile(`-----BEGIN\s+(RSA|EC|OPENSSH|DSA|PGP|ENCRYPTED)?\s*PRIVATE KEY-----`),
		Description: "Private Key Header",
	},
	// Slack
	{
		Name:        "Slack Webhook",
		Regex:       regexp.MustCompile(`https://hooks\.slack\.com/services/T[a-zA-Z0-9_]{8,}/B[a-zA-Z0-9_]{8,}/[a-zA-Z0-9_]{24}`),
		Description: "Slack Webhook URL",
	},
	{
		Name:        "Slack Token",
		Regex:       regexp.MustCompile(`xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*`),
		Description: "Slack API Token",
	},
	// Twilio
	{
		Name:        "Twilio API Key",
		Regex:       regexp.MustCompile(`SK[0-9a-fA-F]{32}`),
		Description: "Twilio API Key",
	},
	// SendGrid
	{
		Name:        "SendGrid API Key",
		Regex:       regexp.MustCompile(`SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}`),
		Description: "SendGrid API Key",
	},
	// npm
	{
		Name:        "npm Token",
		Regex:       regexp.MustCompile(`npm_[a-zA-Z0-9]{36}`),
		Description: "npm Access Token",
	},
	// Heroku
	{
		Name:        "Heroku API Key",
		Regex:       regexp.MustCompile(`(?i)heroku[a-z_-]*[=:\s]+['"]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]?`),
		Description: "Heroku API Key",
	},
	// Google
	{
		Name:        "Google API Key",
		Regex:       regexp.MustCompile(`AIza[0-9A-Za-z_-]{35}`),
		Description: "Google API Key",
	},
	// Discord
	{
		Name:        "Discord Token",
		Regex:       regexp.MustCompile(`[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}`),
		Description: "Discord Bot Token",
	},
	{
		Name:        "Discord Webhook",
		Regex:       regexp.MustCompile(`https://discord(?:app)?\.com/api/webhooks/[0-9]{17,20}/[A-Za-z0-9_-]{60,68}`),
		Description: "Discord Webhook URL",
	},
	// Generic patterns (more prone to false positives, keep at end)
	{
		Name:        "Generic API Key",
		Regex:       regexp.MustCompile(`(?i)['"]?api[_-]?key['"]?\s*[=:]\s*['"]([a-zA-Z0-9_-]{20,})['"]`),
		Description: "Generic API Key assignment",
	},
	{
		Name:        "Generic Secret",
		Regex:       regexp.MustCompile(`(?i)['"]?(?:secret|password|passwd|pwd)['"]?\s*[=:]\s*['"]([^'"]{8,})['"]`),
		Description: "Generic secret assignment",
	},
}

// Default directories to exclude
var defaultExcludes = []string{
	"node_modules",
	".git",
	"vendor",
	"dist",
	"build",
	".next",
	"__pycache__",
	".venv",
	"venv",
	".idea",
	".vscode",
	"coverage",
	".nyc_output",
}

// Binary file extensions to skip
var binaryExtensions = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".ico": true,
	".pdf": true, ".zip": true, ".tar": true, ".gz": true, ".rar": true,
	".exe": true, ".dll": true, ".so": true, ".dylib": true,
	".woff": true, ".woff2": true, ".ttf": true, ".eot": true,
	".mp3": true, ".mp4": true, ".wav": true, ".avi": true,
	".bin": true, ".dat": true, ".db": true, ".sqlite": true,
	".jar": true, ".class": true, ".pyc": true,
	".lock": true,
}

var scanCmd = &cobra.Command{
	Use:   "scan [path]",
	Short: "Scan codebase for leaked secrets",
	Long: `Scan files in the current directory (or specified path) for potential
secret leaks such as API keys, tokens, and passwords.

Uses regex patterns from gitleaks and trufflehog to detect common secrets.

Examples:
  keyway scan                    # Scan current directory
  keyway scan ./src              # Scan specific directory
  keyway scan --json             # Output as JSON (for CI)
  keyway scan -e test -e mocks   # Exclude additional directories`,
	Args: cobra.MaximumNArgs(1),
	RunE: runScan,
}

func init() {
	scanCmd.Flags().StringSliceP("exclude", "e", nil, "Additional directories/patterns to exclude")
	scanCmd.Flags().Bool("json", false, "Output as JSON")
	scanCmd.Flags().Bool("show-all", false, "Show all matches including potential false positives")
}

func runScan(cmd *cobra.Command, args []string) error {
	excludePatterns, _ := cmd.Flags().GetStringSlice("exclude")
	jsonOutput, _ := cmd.Flags().GetBool("json")

	// Determine scan path
	scanPath := "."
	if len(args) > 0 {
		scanPath = args[0]
	}

	// Resolve to absolute path
	absPath, err := filepath.Abs(scanPath)
	if err != nil {
		if !jsonOutput {
			ui.Error(fmt.Sprintf("Invalid path: %s", scanPath))
		}
		return err
	}

	// Check path exists
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		if !jsonOutput {
			ui.Error(fmt.Sprintf("Path does not exist: %s", scanPath))
		}
		return err
	}

	// Combine default and user excludes
	allExcludes := append(defaultExcludes, excludePatterns...)

	if !jsonOutput {
		ui.Intro("scan")
		ui.Step(fmt.Sprintf("Scanning %s", ui.File(absPath)))
	}

	// Perform scan
	var filesScanned int
	var findings []Finding

	if !jsonOutput {
		err = ui.Spin("Scanning files...", func() error {
			var scanErr error
			filesScanned, findings, scanErr = scanDirectory(absPath, allExcludes)
			return scanErr
		})
	} else {
		filesScanned, findings, err = scanDirectory(absPath, allExcludes)
	}

	if err != nil {
		if !jsonOutput {
			ui.Error(fmt.Sprintf("Scan failed: %v", err))
		}
		return err
	}

	// Track analytics
	analytics.Track(analytics.EventScan, map[string]interface{}{
		"filesScanned":  filesScanned,
		"findingsCount": len(findings),
	})

	// Output results
	if jsonOutput {
		result := ScanResult{
			FilesScanned: filesScanned,
			Findings:     findings,
		}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(result)
	}

	// Interactive output
	ui.Message(ui.Dim(fmt.Sprintf("%d files scanned", filesScanned)))
	fmt.Println()

	if len(findings) == 0 {
		ui.Success("No secrets detected")
		return nil
	}

	ui.Warn(fmt.Sprintf("Found %d potential secret(s):", len(findings)))
	fmt.Println()

	// Group by file
	byFile := make(map[string][]Finding)
	for _, f := range findings {
		byFile[f.File] = append(byFile[f.File], f)
	}

	for file, fileFindings := range byFile {
		fmt.Printf("  %s\n", ui.File(file))
		for _, f := range fileFindings {
			fmt.Printf("  │ Line %d: %s\n", f.Line, ui.Dim(f.Type))
			fmt.Printf("  │ %s\n", f.Preview)
		}
		fmt.Println()
	}

	return nil
}

func scanDirectory(root string, excludes []string) (int, []Finding, error) {
	var filesScanned int
	var findings []Finding

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files we can't access
		}

		// Get relative path for cleaner output
		relPath, _ := filepath.Rel(root, path)
		if relPath == "" {
			relPath = path
		}

		// Skip excluded directories
		if info.IsDir() {
			for _, exclude := range excludes {
				if info.Name() == exclude || strings.HasPrefix(relPath, exclude) {
					return filepath.SkipDir
				}
			}
			return nil
		}

		// Skip binary files
		ext := strings.ToLower(filepath.Ext(path))
		if binaryExtensions[ext] {
			return nil
		}

		// Skip large files (> 1MB)
		if info.Size() > 1024*1024 {
			return nil
		}

		// Scan file
		fileFindings, err := scanFile(path, relPath)
		if err != nil {
			return nil // Skip files we can't read
		}

		filesScanned++
		findings = append(findings, fileFindings...)

		return nil
	})

	return filesScanned, findings, err
}

func scanFile(path, relPath string) ([]Finding, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var findings []Finding
	scanner := bufio.NewScanner(file)
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		// Skip empty lines and comments
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Check each pattern
		for _, pattern := range secretPatterns {
			matches := pattern.Regex.FindAllString(line, -1)
			for _, match := range matches {
				// Skip common false positives
				if isFalsePositive(match, line, relPath) {
					continue
				}

				findings = append(findings, Finding{
					File:    relPath,
					Line:    lineNum,
					Type:    pattern.Name,
					Preview: maskSecret(match),
				})
			}
		}
	}

	return findings, scanner.Err()
}

// maskSecret masks the middle of a secret, showing only first 4 and last 3 chars
func maskSecret(secret string) string {
	if len(secret) <= 10 {
		return strings.Repeat("*", len(secret))
	}

	// Show first 4 and last 3 characters
	masked := secret[:4] + strings.Repeat("*", len(secret)-7) + secret[len(secret)-3:]
	return masked
}

// isFalsePositive checks for common false positive patterns
func isFalsePositive(match, line, filePath string) bool {
	lowerLine := strings.ToLower(line)
	lowerMatch := strings.ToLower(match)
	lowerPath := strings.ToLower(filePath)

	// Skip test/example files
	if strings.Contains(lowerPath, "test") ||
		strings.Contains(lowerPath, "spec") ||
		strings.Contains(lowerPath, "example") ||
		strings.Contains(lowerPath, "mock") ||
		strings.Contains(lowerPath, "fixture") ||
		strings.Contains(lowerPath, ".example") ||
		strings.Contains(lowerPath, ".sample") {
		return true
	}

	// Skip placeholder values
	placeholders := []string{
		"xxx", "your", "example", "placeholder", "changeme",
		"insert", "replace", "todo", "fixme", "dummy",
		"test", "fake", "mock", "sample", "demo",
		"<your", "${", "{{", "ENV[", "process.env",
	}
	for _, p := range placeholders {
		if strings.Contains(lowerMatch, p) || strings.Contains(lowerLine, p) {
			return true
		}
	}

	// Skip if it looks like a variable reference
	if strings.Contains(line, "${") || strings.Contains(line, "$(") ||
		strings.Contains(line, "process.env") || strings.Contains(line, "os.getenv") ||
		strings.Contains(line, "ENV[") {
		return true
	}

	// Skip documentation patterns
	if strings.Contains(lowerLine, "example:") || strings.Contains(lowerLine, "e.g.") ||
		strings.Contains(lowerLine, "for example") {
		return true
	}

	return false
}
