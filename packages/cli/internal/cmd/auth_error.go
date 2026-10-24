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

// relogin asks for a new token after a 401. Tests replace it: handleAuthError clears the
// stored credentials.
var relogin = handleAuthError

// spinWithRelogin runs call under a spinner. When the token has expired, it asks to sign in
// again and retries once with a client for the new token, left in *client. explained reports
// an error the re-login already showed to the user.
func spinWithRelogin(deps *Dependencies, client *api.APIClient, title string, call func(api.APIClient) error) (explained bool, err error) {
	err = deps.UI.Spin(title, func() error { return call(*client) })
	if err == nil || !isAuthError(err) {
		return false, err
	}
	token, err := relogin(err, deps)
	if err != nil {
		return true, err
	}
	*client = deps.APIFactory.NewClient(token)
	return false, deps.UI.Spin(title, func() error { return call(*client) })
}
