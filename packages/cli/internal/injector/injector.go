package injector

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
)

// signals is defined in signals_unix.go and signals_windows.go

// RunCommand executes a command with the provided secrets injected into the environment.
// It handles signal forwarding and exit code propagation.
func RunCommand(command string, args []string, secrets map[string]string) error {
	// Prepare the command
	cmd := exec.Command(command, args...)

	// Connect standard input/output
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Build the environment
	// Start with current environment
	currentEnv := os.Environ()
	newEnv := make([]string, 0, len(currentEnv)+len(secrets))
	newEnv = append(newEnv, currentEnv...)

	// Append secrets
	for k, v := range secrets {
		newEnv = append(newEnv, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = newEnv

	// Handle signals
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, signals...)

	// Start the command
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	// Forward signals to the child process
	go func() {
		for sig := range sigs {
			if cmd.Process != nil {
				_ = cmd.Process.Signal(sig)
			}
		}
	}()

	// Wait for the command to finish
	err := cmd.Wait()

	// Handle exit code
	if exitError, ok := err.(*exec.ExitError); ok {
		// The process exited with a non-zero status
		if status, ok := exitError.Sys().(syscall.WaitStatus); ok {
			os.Exit(status.ExitStatus())
		}
		os.Exit(1)
	}

	return err
}
