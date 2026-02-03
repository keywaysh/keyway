package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var testBadge = GenerateBadge("acme/backend")

func TestGenerateBadge_CorrectFormat(t *testing.T) {
	result := GenerateBadge("acme/my-project")
	if !strings.Contains(result, "/badge.svg?repo=acme/my-project") {
		t.Error("badge should contain correct badge URL")
	}
	if !strings.Contains(result, "/vaults/acme/my-project") {
		t.Error("badge should contain correct vault URL")
	}
}

func TestGenerateBadge_MarkdownFormat(t *testing.T) {
	result := GenerateBadge("acme/backend")
	if !strings.HasPrefix(result, "[![Keyway Secrets](") {
		t.Error("badge should start with markdown image link syntax")
	}
	if !strings.HasSuffix(result, ")") {
		t.Error("badge should end with closing parenthesis")
	}
}

func TestInsertBadge_UnchangedWhenPresent(t *testing.T) {
	content := "# Title\n\n" + testBadge + "\n\nSome content"
	result := InsertBadgeIntoReadme(content, testBadge)
	if result != content {
		t.Error("should not modify content when badge already present")
	}
}

func TestInsertBadge_AfterFirstTitle(t *testing.T) {
	content := "# Title\n\nSome content"
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := "# Title\n\n" + testBadge + "\n\nSome content"
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

func TestInsertBadge_AtTopWhenNoTitle(t *testing.T) {
	content := "Intro\n\nMore text"
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := testBadge + "\n\n" + content
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

func TestInsertBadge_AtTopWhenOnlyH2(t *testing.T) {
	content := "## Secondary Title\n\nContent here"
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := testBadge + "\n\n" + content
	if result != expected {
		t.Errorf("expected badge at top when only h2, got:\n%s", result)
	}
}

func TestInsertBadge_MultipleTitles(t *testing.T) {
	content := "# Main Title\n\n## Section\n\nContent"
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := "# Main Title\n\n" + testBadge + "\n\n## Section\n\nContent"
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

func TestInsertBadge_EmptyContent(t *testing.T) {
	content := ""
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := testBadge + "\n\n"
	if result != expected {
		t.Errorf("expected:\n%q\n\ngot:\n%q", expected, result)
	}
}

func TestInsertBadge_OnlyTitle(t *testing.T) {
	content := "# Just a Title"
	result := InsertBadgeIntoReadme(content, testBadge)
	// Should add badge after title
	if !strings.Contains(result, "# Just a Title") {
		t.Error("should preserve title")
	}
	if !strings.Contains(result, testBadge) {
		t.Error("should contain badge")
	}
}

func TestInsertBadge_WindowsLineEndings(t *testing.T) {
	content := "# Title\r\n\r\nSome content"
	result := InsertBadgeIntoReadme(content, testBadge)
	if !strings.Contains(result, testBadge) {
		t.Error("should insert badge with CRLF line endings")
	}
	if !strings.Contains(result, "# Title") {
		t.Error("should preserve title")
	}
	if !strings.Contains(result, "Some content") {
		t.Error("should preserve content")
	}
}

func TestInsertBadge_ExistingBadgeDifferentRepo(t *testing.T) {
	existingBadge := GenerateBadge("other/repo")
	content := "# Title\n\n" + existingBadge + "\n\nContent"
	result := InsertBadgeIntoReadme(content, testBadge)
	// Should not add another badge (keyway.sh/badge.svg already present)
	if result != content {
		t.Error("should not add another keyway badge when one exists")
	}
}

func TestInsertBadge_MultipleBlankLines(t *testing.T) {
	content := "# Title\n\n\n\nSome content"
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := "# Title\n\n" + testBadge + "\n\nSome content"
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

func TestInsertBadge_NoH2H3Headers(t *testing.T) {
	content := "## Getting Started\n\n### Install\n\nContent"
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := testBadge + "\n\n" + content
	if result != expected {
		t.Errorf("should insert at top when no H1, got:\n%s", result)
	}
}

func TestInsertBadge_IgnoreCodeBlock(t *testing.T) {
	content := "# Project\n\n```bash\nnpm run dev\n# this is a comment\nyarn dev\n```"
	result := InsertBadgeIntoReadme(content, testBadge)
	// Badge should be after h1 title, not affected by # in code block
	if !strings.Contains(result, "# Project\n\n"+testBadge) {
		t.Errorf("badge should be after H1, not affected by code block, got:\n%s", result)
	}
}

func TestInsertBadge_UC1_AfterExistingBadges(t *testing.T) {
	existingBadge := "[![npm](https://img.shields.io/npm/v/pkg.svg)](https://npmjs.com/pkg)"
	content := "# My Project\n\n" + existingBadge + "\n\n## Features"
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := "# My Project\n\n" + existingBadge + " " + testBadge + "\n\n## Features"
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

func TestInsertBadge_UC2_InlineInText(t *testing.T) {
	existingBadge := "[![test](https://test.com/badge.svg)](https://test.com)"
	content := "# Project\n\nCheck out " + existingBadge + " for more info."
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := "# Project\n\nCheck out " + existingBadge + " " + testBadge + " for more info."
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

func TestInsertBadge_UC5_IgnoreH1InCodeBlock(t *testing.T) {
	content := `Here's an example:
` + "```bash" + `
# This is a shell comment, not a title
echo "hello"
` + "```" + `

# Real Title

Content here.`
	result := InsertBadgeIntoReadme(content, testBadge)
	// Badge should be inserted after "# Real Title"
	if !strings.Contains(result, "# Real Title\n\n"+testBadge) {
		t.Errorf("badge should be after Real Title, got:\n%s", result)
	}
	// The shell comment should still be there
	if !strings.Contains(result, "# This is a shell comment") {
		t.Error("shell comment in code block should be preserved")
	}
	// Only one badge inserted
	count := strings.Count(result, testBadge)
	if count != 1 {
		t.Errorf("expected 1 badge, got %d", count)
	}
}

func TestInsertBadge_UC6_IgnoreH1InHTMLComment(t *testing.T) {
	content := `<!--
# Draft Title (commented out)
TODO: finalize title
-->

# Actual Title

Content.`
	result := InsertBadgeIntoReadme(content, testBadge)
	if !strings.Contains(result, "# Actual Title\n\n"+testBadge) {
		t.Errorf("badge should be after Actual Title, got:\n%s", result)
	}
}

func TestInsertBadge_UC7_URLsWithParentheses(t *testing.T) {
	wikiLink := "[![Wiki](https://badge.svg)](https://en.wikipedia.org/wiki/Foo_(disambiguation))"
	content := "# Project\n\n" + wikiLink + "\n\n## About"
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := "# Project\n\n" + wikiLink + " " + testBadge + "\n\n## About"
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

func TestInsertBadge_UC12_MultiLineBadges(t *testing.T) {
	badge1 := "[![badge1](url1)](link1)"
	badge2 := "[![badge2](url2)](link2)"
	badge3 := "[![badge3](url3)](link3)"
	content := "# Project\n\n" + badge1 + "\n" + badge2 + "\n" + badge3 + "\n\n## Features"
	result := InsertBadgeIntoReadme(content, testBadge)
	// Should insert after badge3 (the last badge)
	expected := "# Project\n\n" + badge1 + "\n" + badge2 + "\n" + badge3 + " " + testBadge + "\n\n## Features"
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

func TestInsertBadge_UC4_TenseTitle(t *testing.T) {
	content := `# My Project
Some description immediately after.

## Features`
	result := InsertBadgeIntoReadme(content, testBadge)
	expected := "# My Project\n\n" + testBadge + "\n\nSome description immediately after.\n\n## Features"
	if result != expected {
		t.Errorf("expected:\n%s\n\ngot:\n%s", expected, result)
	}
}

// File system tests

func TestFindReadmePath_NoReadme(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "readme-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	path := FindReadmePath(tmpDir)
	if path != "" {
		t.Errorf("expected empty path, got %q", path)
	}
}

func TestFindReadmePath_Standard(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "readme-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	readmePath := filepath.Join(tmpDir, "README.md")
	os.WriteFile(readmePath, []byte("# Test"), 0644)

	path := FindReadmePath(tmpDir)
	if path != readmePath {
		t.Errorf("expected %q, got %q", readmePath, path)
	}
}

func TestFindReadmePath_Lowercase(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "readme-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	readmePath := filepath.Join(tmpDir, "readme.md")
	os.WriteFile(readmePath, []byte("# Test"), 0644)

	path := FindReadmePath(tmpDir)
	// On case-insensitive filesystems (macOS), readme.md might resolve to README.md
	if path == "" {
		t.Error("expected to find readme.md")
	}
	if !strings.Contains(strings.ToLower(path), "readme.md") {
		t.Errorf("expected readme path, got %q", path)
	}
}

func TestFindReadmePath_PrefersUppercase(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "readme-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create both
	upperPath := filepath.Join(tmpDir, "README.md")
	lowerPath := filepath.Join(tmpDir, "readme.md")
	os.WriteFile(upperPath, []byte("# Upper"), 0644)
	os.WriteFile(lowerPath, []byte("# Lower"), 0644)

	path := FindReadmePath(tmpDir)
	if path != upperPath {
		t.Errorf("should prefer README.md, got %q", path)
	}
}

func TestFindLastBadgeEnd_NoBadges(t *testing.T) {
	result := findLastBadgeEnd("This is just plain text")
	if result != -1 {
		t.Errorf("expected -1 for no badges, got %d", result)
	}
}

func TestFindLastBadgeEnd_SingleBadge(t *testing.T) {
	line := "[![badge](https://img.svg)](https://link.com) some text"
	result := findLastBadgeEnd(line)
	if result == -1 {
		t.Error("should find badge end")
	}
	if result > len(line) {
		t.Errorf("result %d is past end of line %d", result, len(line))
	}
}

func TestFindLastBadgeEnd_MultipleBadges(t *testing.T) {
	line := "[![badge1](url1)](link1) [![badge2](url2)](link2)"
	result := findLastBadgeEnd(line)
	if result == -1 {
		t.Error("should find last badge end")
	}
	// Should point to end of second badge
	if result <= strings.Index(line, "badge2") {
		t.Error("should find end of last badge, not first")
	}
}

func TestFindLastBadgeEnd_NestedParentheses(t *testing.T) {
	// Badge with URL containing parentheses (like Wikipedia)
	line := "[![badge](https://img.svg)](https://en.wikipedia.org/wiki/Foo_(bar))"
	result := findLastBadgeEnd(line)
	if result != len(line) {
		t.Errorf("expected end of line %d, got %d", len(line), result)
	}
}

func TestFindReadmePath_MarkdownExtension(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "readme-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test .markdown extension
	readmePath := filepath.Join(tmpDir, "README.markdown")
	os.WriteFile(readmePath, []byte("# Test"), 0644)

	path := FindReadmePath(tmpDir)
	if path != readmePath {
		t.Errorf("expected %q, got %q", readmePath, path)
	}
}

func TestInsertBadge_OnlyWhitespace(t *testing.T) {
	content := "   \n\n   \n"
	result := InsertBadgeIntoReadme(content, testBadge)
	if !strings.Contains(result, testBadge) {
		t.Error("should insert badge even in whitespace-only content")
	}
}

func TestInsertBadge_H1WithSpecialChars(t *testing.T) {
	content := "# My Project (v2.0) - *Beta*\n\nContent here"
	result := InsertBadgeIntoReadme(content, testBadge)
	if !strings.Contains(result, "# My Project (v2.0) - *Beta*") {
		t.Error("should preserve H1 with special characters")
	}
	if !strings.Contains(result, testBadge) {
		t.Error("should contain badge")
	}
}
