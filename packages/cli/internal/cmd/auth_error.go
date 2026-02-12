package cmd

import (
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/auth"
)

// handleAuthError checks if the error is a 401 and handles it appropriately.
// In interactive mode, it clears the stored auth and prompts for re-login.
// In non-interactive mode, it shows a clear error message.
// Returns the new token if re-login was successful, empty string and original error otherwise.
func handleAuthError(err error, deps *Dependencies) (string, error) {
	apiErr, ok := err.(*api.APIError)
	if !ok || apiErr.StatusCode != 401 {
		return "", err
	}

	// Clear the expired/invalid token
	store := auth.NewStore()
	_ = store.ClearAuth()

	if deps.UI.IsInteractive() {
		deps.UI.Warn("Session expired or invalid")
		relogin, _ := deps.UI.Confirm("Open browser to sign in again?", true)
		if relogin {
			token, loginErr := RunDeviceLogin()
			if loginErr != nil {
				return "", loginErr
			}
			return token, nil
		}
		deps.UI.Message(deps.UI.Dim("Run: keyway login"))
		return "", err
	}

	// Non-interactive mode
	deps.UI.Error("Session expired or invalid")
	deps.UI.Message(deps.UI.Dim("Run: keyway logout && keyway login"))
	return "", err
}

// isAuthError checks if the error is an authentication error (401)
func isAuthError(err error) bool {
	apiErr, ok := err.(*api.APIError)
	return ok && apiErr.StatusCode == 401
}
