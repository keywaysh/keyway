package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/spf13/cobra"
)

var readmeCmd = &cobra.Command{
	Use:   "readme",
	Short: "README badge management",
	Long:  `Manage Keyway badge in your README file.`,
}

var addBadgeCmd = &cobra.Command{
	Use:   "add-badge",
	Short: "Add Keyway badge to README",
	Long:  `Add the Keyway secrets badge to your README.md file.`,
	RunE:  runAddBadge,
}

func init() {
	readmeCmd.AddCommand(addBadgeCmd)
}

// GenerateBadge creates the markdown badge for a repository
func GenerateBadge(repo string) string {
	return fmt.Sprintf("[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=%s)](https://www.keyway.sh/vaults/%s)", repo, repo)
}

// FindReadmePath looks for README.md in the given directory
func FindReadmePath(dir string) string {
	candidates := []string{"README.md", "readme.md", "Readme.md", "README.markdown", "readme.markdown"}
	for _, candidate := range candidates {
		path := filepath.Join(dir, candidate)
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return ""
}

// Regex patterns
var (
	// Matches markdown badge: [![alt](img-url)](link-url)
	badgePrefixRegex = regexp.MustCompile(`\[!\[[^\]]*\]\([^)]*\)\]\(`)
	// Matches H1 heading: # Title
	h1Pattern = regexp.MustCompile(`^#\s+`)
	// Matches code fence
	codeFencePattern = regexp.MustCompile("^```")
)

// findLastBadgeEnd finds the end position of the last badge on a line
func findLastBadgeEnd(line string) int {
	lastEnd := -1
	matches := badgePrefixRegex.FindAllStringIndex(line, -1)

	for _, match := range matches {
		prefixEnd := match[1] - 1 // Position of the opening (
		remainder := line[prefixEnd:]

		// Find matching closing parenthesis
		depth := 0
		for i, ch := range remainder {
			if ch == '(' {
				depth++
			} else if ch == ')' {
				depth--
				if depth == 0 {
					lastEnd = prefixEnd + i + 1
					break
				}
			}
		}
	}
	return lastEnd
}

// InsertBadgeIntoReadme inserts the badge into README content
func InsertBadgeIntoReadme(content, badge string) string {
	// Check if badge already exists
	if strings.Contains(content, "keyway.sh/badge.svg") {
		return content
	}

	lines := strings.Split(content, "\n")

	inCodeBlock := false
	inHTMLComment := false
	lastBadgeLine := -1
	lastBadgeEndIndex := -1
	firstH1Line := -1

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Track code blocks
		if codeFencePattern.MatchString(trimmed) {
			inCodeBlock = !inCodeBlock
			continue
		}
		if inCodeBlock {
			continue
		}

		// Track HTML comments
		if strings.Contains(trimmed, "<!--") {
			inHTMLComment = true
		}
		if strings.Contains(trimmed, "-->") {
			inHTMLComment = false
			continue
		}
		if inHTMLComment {
			continue
		}

		// Check for existing badges
		if badgePrefixRegex.MatchString(line) {
			lastBadgeLine = i
			lastBadgeEndIndex = findLastBadgeEnd(line)
		}

		// Find first H1
		if firstH1Line == -1 && h1Pattern.MatchString(line) {
			firstH1Line = i
		}
	}

	// Strategy 1: Insert after last badge on same line
	if lastBadgeLine >= 0 && lastBadgeEndIndex > 0 {
		line := lines[lastBadgeLine]
		lines[lastBadgeLine] = line[:lastBadgeEndIndex] + " " + badge + line[lastBadgeEndIndex:]
		return strings.Join(lines, "\n")
	}

	// Strategy 2: Insert after H1 heading
	if firstH1Line >= 0 {
		// Copy before lines to avoid modifying original slice
		before := make([]string, firstH1Line+1)
		copy(before, lines[:firstH1Line+1])

		after := lines[firstH1Line+1:]

		// Skip empty lines after H1
		for len(after) > 0 && strings.TrimSpace(after[0]) == "" {
			after = after[1:]
		}

		// Build result by concatenating slices properly
		var result []string
		result = append(result, before...)
		result = append(result, "", badge, "")
		if len(after) > 0 {
			result = append(result, after...)
		}
		return strings.Join(result, "\n")
	}

	// Strategy 3: Prepend to file
	return badge + "\n\n" + content
}

// AddBadgeToReadme adds the Keyway badge to the README file
// Returns true if badge was added, false if already present or error
func AddBadgeToReadme(silent bool) (bool, error) {
	repo, err := git.DetectRepo()
	if err != nil {
		return false, fmt.Errorf("not in a git repository")
	}

	cwd, err := os.Getwd()
	if err != nil {
		return false, err
	}

	readmePath := FindReadmePath(cwd)
	if readmePath == "" {
		// No README found
		if !silent && ui.IsInteractive() {
			create, _ := ui.Confirm("No README found. Create README.md?", false)
			if create {
				// Get repo name for title
				parts := strings.Split(repo, "/")
				repoName := parts[len(parts)-1]

				readmePath = filepath.Join(cwd, "README.md")
				initialContent := fmt.Sprintf("# %s\n\n", repoName)
				if err := os.WriteFile(readmePath, []byte(initialContent), 0644); err != nil {
					return false, fmt.Errorf("failed to create README: %w", err)
				}
			} else {
				if !silent {
					ui.Warn("Skipping badge insertion (no README)")
				}
				return false, nil
			}
		} else {
			return false, nil
		}
	}

	// Read current content
	contentBytes, err := os.ReadFile(readmePath)
	if err != nil {
		return false, fmt.Errorf("failed to read README: %w", err)
	}
	content := string(contentBytes)

	// Generate and insert badge
	badge := GenerateBadge(repo)
	updated := InsertBadgeIntoReadme(content, badge)

	// Check if anything changed
	if updated == content {
		if !silent {
			ui.Info("Keyway badge already present in README")
		}
		return false, nil
	}

	// Write updated content
	if err := os.WriteFile(readmePath, []byte(updated), 0644); err != nil {
		return false, fmt.Errorf("failed to write README: %w", err)
	}

	if !silent {
		ui.Success(fmt.Sprintf("Keyway badge added to %s", filepath.Base(readmePath)))
	}
	return true, nil
}

func runAddBadge(cmd *cobra.Command, args []string) error {
	ui.Intro("readme add-badge")

	repo, _ := git.DetectRepo()

	added, err := AddBadgeToReadme(false)
	if err != nil {
		ui.Error(err.Error())
		return err
	}

	// Track badge event
	analytics.Track(analytics.EventReadmeBadge, map[string]interface{}{
		"repo":        repo,
		"badge_added": added,
		"source":      "add-badge",
	})

	if added {
		ui.Outro("Badge added! Commit and push to see it on GitHub.")
	} else {
		ui.Outro("")
	}
	return nil
}
