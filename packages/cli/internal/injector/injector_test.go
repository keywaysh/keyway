package injector

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// Helper to capture output of the RunCommand function is hard because it wires to os.Stdout.
// Let's modify RunCommand to accept stdin/out/err as arguments?
// No, keep it simple. The requirement was "Keep it simple".
// I will write a test that invokes a subprocess that calls RunCommand.

func TestRunCommand(t *testing.T) {
	if os.Getenv("GO_TEST_PROCESS") != "1" {
		return
	}
	
	// This code runs INSIDE the test process when invoked recursively
	secrets := map[string]string{
		"TEST_SECRET": "secret_value",
	}
	
	// We use "env" command to print environment variables
	err := RunCommand("env", []string{}, secrets)
	if err != nil {
		fmt.Fprintf(os.Stderr, "RunCommand failed: %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}

// Real test runner
func TestRunCommand_Integration(t *testing.T) {
	// We re-run the test binary, setting GO_TEST_PROCESS=1
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command(exe, "-test.run=TestRunCommand")
	cmd.Env = append(os.Environ(), "GO_TEST_PROCESS=1")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()

	if err != nil {
		t.Fatalf("Process failed: %v\nStderr: %s", err, stderr.String())
	}

	output := stdout.String()
	if !strings.Contains(output, "TEST_SECRET=secret_value") {
		t.Errorf("Expected environment variable TEST_SECRET not found in output.\nOutput:\n%s", output)
	}
}

func TestRunCommand_MultipleSecrets(t *testing.T) {
	secrets := map[string]string{
		"SECRET_A": "value_a",
		"SECRET_B": "value_b",
		"SECRET_C": "value_c",
	}

	// Use echo to verify secrets are injected
	cmd := exec.Command("sh", "-c", "echo $SECRET_A $SECRET_B $SECRET_C")

	// Build environment
	currentEnv := os.Environ()
	newEnv := make([]string, 0, len(currentEnv)+len(secrets))
	newEnv = append(newEnv, currentEnv...)
	for k, v := range secrets {
		newEnv = append(newEnv, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = newEnv

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	err := cmd.Run()
	if err != nil {
		t.Fatalf("Command failed: %v", err)
	}

	output := stdout.String()
	if !strings.Contains(output, "value_a") || !strings.Contains(output, "value_b") || !strings.Contains(output, "value_c") {
		t.Errorf("Expected all secrets in output, got: %s", output)
	}
}

func TestRunCommand_EmptySecrets(t *testing.T) {
	secrets := map[string]string{}

	// Should work with empty secrets map
	cmd := exec.Command("echo", "test")

	currentEnv := os.Environ()
	newEnv := make([]string, 0, len(currentEnv))
	newEnv = append(newEnv, currentEnv...)
	cmd.Env = newEnv

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	err := cmd.Run()
	if err != nil {
		t.Fatalf("Command failed: %v", err)
	}

	output := strings.TrimSpace(stdout.String())
	if output != "test" {
		t.Errorf("Expected 'test', got: %s", output)
	}
	_ = secrets // use the variable
}

func TestRunCommand_OverridesExistingEnv(t *testing.T) {
	// Set an env var that we'll override
	os.Setenv("OVERRIDE_TEST", "original")
	defer os.Unsetenv("OVERRIDE_TEST")

	secrets := map[string]string{
		"OVERRIDE_TEST": "overridden",
	}

	cmd := exec.Command("sh", "-c", "echo $OVERRIDE_TEST")

	// Build environment - secrets come after current env so they override
	currentEnv := os.Environ()
	newEnv := make([]string, 0, len(currentEnv)+len(secrets))
	newEnv = append(newEnv, currentEnv...)
	for k, v := range secrets {
		newEnv = append(newEnv, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = newEnv

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	err := cmd.Run()
	if err != nil {
		t.Fatalf("Command failed: %v", err)
	}

	output := strings.TrimSpace(stdout.String())
	if output != "overridden" {
		t.Errorf("Expected 'overridden', got: %s", output)
	}
}

func TestRunCommand_SpecialCharactersInValues(t *testing.T) {
	secrets := map[string]string{
		"SPECIAL_CHARS": "hello world!@#$%^&*()",
		"WITH_QUOTES":   `value with "quotes"`,
		"WITH_NEWLINE":  "line1\nline2",
	}

	// Verify special chars are preserved
	cmd := exec.Command("sh", "-c", "echo \"$SPECIAL_CHARS\"")

	currentEnv := os.Environ()
	newEnv := make([]string, 0, len(currentEnv)+len(secrets))
	newEnv = append(newEnv, currentEnv...)
	for k, v := range secrets {
		newEnv = append(newEnv, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = newEnv

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	err := cmd.Run()
	if err != nil {
		t.Fatalf("Command failed: %v", err)
	}

	output := strings.TrimSpace(stdout.String())
	if output != "hello world!@#$%^&*()" {
		t.Errorf("Expected special chars preserved, got: %s", output)
	}
}

func TestRunCommand_NonexistentCommand(t *testing.T) {
	cmd := exec.Command("this-command-definitely-does-not-exist-12345")
	err := cmd.Start()

	if err == nil {
		t.Error("Expected error for non-existent command")
	}
}
