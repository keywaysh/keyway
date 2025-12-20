package ui

import (
	"fmt"
	"os"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/huh/spinner"
	"github.com/fatih/color"
)

var (
	cyan   = color.New(color.FgCyan)
	green  = color.New(color.FgGreen)
	yellow = color.New(color.FgYellow)
	red    = color.New(color.FgRed)
	dim    = color.New(color.Faint)
	bold   = color.New(color.Bold)
)

// Intro displays the command intro banner
func Intro(command string) {
	fmt.Printf("\n %s \n\n", color.New(color.BgCyan, color.FgBlack).Sprintf(" keyway %s ", command))
}

// Outro displays the command outro message
func Outro(message string) {
	fmt.Printf("\n%s\n\n", message)
}

// Success displays a success message
func Success(message string) {
	green.Printf("✓ %s\n", message)
}

// Error displays an error message
func Error(message string) {
	red.Printf("✗ %s\n", message)
}

// Warn displays a warning message
func Warn(message string) {
	yellow.Printf("⚠ %s\n", message)
}

// Info displays an info message
func Info(message string) {
	cyan.Printf("ℹ %s\n", message)
}

// Step displays a step in a process
func Step(message string) {
	fmt.Printf("│ %s\n", message)
}

// Message displays a plain message
func Message(message string) {
	fmt.Printf("│ %s\n", message)
}

// Value formats a value for display
func Value(v interface{}) string {
	return cyan.Sprint(v)
}

// File formats a file path for display
func File(path string) string {
	return cyan.Sprint(path)
}

// Link formats a URL for display
func Link(url string) string {
	return cyan.Sprint(url)
}

// Command formats a command for display
func Command(cmd string) string {
	return cyan.Sprint(cmd)
}

// Dim formats text as dimmed
func Dim(text string) string {
	return dim.Sprint(text)
}

// Bold formats text as bold
func Bold(text string) string {
	return bold.Sprint(text)
}

// Confirm prompts for yes/no confirmation
func Confirm(message string, defaultValue bool) (bool, error) {
	var result bool
	err := huh.NewConfirm().
		Title(message).
		Value(&result).
		Affirmative("Yes").
		Negative("No").
		Run()
	if err != nil {
		return defaultValue, err
	}
	return result, nil
}

// Select prompts for selection from options
func Select(message string, options []string) (string, error) {
	var result string
	opts := make([]huh.Option[string], len(options))
	for i, opt := range options {
		opts[i] = huh.NewOption(opt, opt)
	}

	err := huh.NewSelect[string]().
		Title(message).
		Options(opts...).
		Value(&result).
		Run()
	return result, err
}

// SelectWithValues prompts for selection with custom values
func SelectWithValues(message string, options []struct{ Label, Value string }) (string, error) {
	var result string
	opts := make([]huh.Option[string], len(options))
	for i, opt := range options {
		opts[i] = huh.NewOption(opt.Label, opt.Value)
	}

	err := huh.NewSelect[string]().
		Title(message).
		Options(opts...).
		Value(&result).
		Run()
	return result, err
}

// Text prompts for text input
func Text(message string, placeholder string) (string, error) {
	var result string
	err := huh.NewInput().
		Title(message).
		Placeholder(placeholder).
		Value(&result).
		Run()
	return result, err
}

// Password prompts for password input (masked)
func Password(message string) (string, error) {
	var result string
	err := huh.NewInput().
		Title(message).
		EchoMode(huh.EchoModePassword).
		Value(&result).
		Run()
	return result, err
}

// Spin shows a spinner while executing a function
func Spin(message string, fn func() error) error {
	var err error
	spinErr := spinner.New().
		Title(message).
		Action(func() {
			err = fn()
		}).
		Run()
	if spinErr != nil {
		return spinErr
	}
	return err
}

// SpinWithResult shows a spinner and allows returning a result
func SpinWithResult[T any](message string, fn func() (T, error)) (T, error) {
	var result T
	var err error
	spinErr := spinner.New().
		Title(message).
		Action(func() {
			result, err = fn()
		}).
		Run()
	if spinErr != nil {
		return result, spinErr
	}
	return result, err
}

// IsInteractive returns true if running in an interactive terminal
func IsInteractive() bool {
	// Check CI environment
	if ci := os.Getenv("CI"); ci == "true" || ci == "1" {
		return false
	}
	// Check if stdin is a terminal
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
