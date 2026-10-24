package cmd

import (
	"context"
	"errors"
	"fmt"

	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
)

// vaultState is an environment's secrets as a command reads them before writing to it.
type vaultState struct {
	secrets map[string]string
	exact   bool // the server sent exact values, which also means it understands push modes
	empty   bool // the environment has no secrets yet (the server answered 404)
}

// vaultReadError reports .env text from an older server that cannot be read without guessing.
type vaultReadError struct{ err error }

func (e *vaultReadError) Error() string {
	return fmt.Sprintf("cannot read the vault's secrets safely (%v)", e.err)
}

func (e *vaultReadError) Unwrap() error { return e.err }

// readVault reads an environment's secrets: exact values from current servers, the parsed
// .env text from older ones.
func readVault(client api.APIClient, repo, envName string) (*vaultState, error) {
	resp, err := client.PullSecrets(context.Background(), repo, envName)
	if err != nil {
		var apiErr *api.APIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == 404 {
			return &vaultState{secrets: map[string]string{}, empty: true}, nil
		}
		return nil, err
	}
	secrets, exact, err := secretsOf(resp)
	if err != nil {
		return nil, err
	}
	return &vaultState{secrets: secrets, exact: exact}, nil
}

// secretsOf returns the secrets of a pull response and whether they are exact.
func secretsOf(resp *api.PullSecretsResponse) (map[string]string, bool, error) {
	if resp.Secrets != nil {
		return resp.Secrets, true, nil
	}
	secrets, err := env.Parse(resp.Content)
	if err != nil {
		return nil, false, &vaultReadError{err}
	}
	return secrets, false, nil
}

// showVaultReadError explains an older server's unreadable .env text.
func showVaultReadError(deps *Dependencies, err error) {
	deps.UI.Error(err.Error())
	deps.UI.Message(deps.UI.Dim("This Keyway server predates exact values. Update it, or use the dashboard for this environment."))
}
