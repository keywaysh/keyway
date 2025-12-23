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
