package cmd

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/config"
	"github.com/keywaysh/cli/internal/env"
	"github.com/keywaysh/cli/internal/ui"
)

// vaultState is an environment's secrets as a command reads them before writing to it.
type vaultState struct {
	secrets map[string]string
	content string // the .env text the server sent
	current bool   // the server sends exact values, so it also understands push modes
	empty   bool   // the environment has no secrets yet (the server answered 404)
}

// vaultReadError reports .env text from an older server that cannot be read exactly.
type vaultReadError struct{ err error }

func (e *vaultReadError) Error() string {
	return fmt.Sprintf("cannot read the vault's secrets safely (%v)", e.err)
}

func (e *vaultReadError) Unwrap() error { return e.err }

// readVault reads an environment's secrets: exact values from current servers, the server's
// .env text read exactly from older ones.
func readVault(client api.APIClient, repo, envName string) (*vaultState, error) {
	resp, err := client.PullSecrets(context.Background(), repo, envName)
	if err != nil {
		var apiErr *api.APIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == 404 {
			return &vaultState{secrets: map[string]string{}, empty: true}, nil
		}
		return nil, err
	}
	secrets, current, err := secretsOf(resp)
	if err != nil {
		return nil, err
	}
	return &vaultState{secrets: secrets, content: resp.Content, current: current}, nil
}

// secretsOf returns the secrets of a pull response, and whether the server is current: it sent
// them as they are. An older server's .env text is read exactly too.
func secretsOf(resp *api.PullSecretsResponse) (map[string]string, bool, error) {
	if resp.Secrets != nil {
		return resp.Secrets, true, nil
	}
	secrets, err := env.ParseServer(resp.Content)
	if err != nil {
		return nil, false, &vaultReadError{err}
	}
	return secrets, false, nil
}

// asFile returns what a .env file holding the server's text reads as (see env.Parse), or
// nil when such a file cannot be read.
func asFile(content string) map[string]string {
	read, err := env.Parse(content)
	if err != nil {
		return nil
	}
	return read
}

// fetchVault reads an environment under a spinner, signing in again when the token expired,
// and shows why when it fails. It returns the client to use from then on.
func fetchVault(deps *Dependencies, client api.APIClient, repo, envName, title string) (api.APIClient, *vaultState, error) {
	var vault *vaultState
	client, explained, err := spinWithRelogin(deps, client, title, func(c api.APIClient) error {
		var readErr error
		vault, readErr = readVault(c, repo, envName)
		return readErr
	})
	if err != nil {
		var readErr *vaultReadError
		switch {
		case explained:
		case errors.As(err, &readErr):
			showVaultReadError(deps, err)
		default:
			deps.UI.Error(err.Error())
		}
		return client, nil, err
	}
	return client, vault, nil
}

// unnameable returns the vault's keys a .env file cannot name (created before the server
// refused them: " PADDED", "#HASHED", "K\nL"): a file never holds them, so --prune must not
// trash them.
func unnameable(vault *vaultState) []string {
	fileView := asFile(vault.content)
	var keys []string
	for key, value := range vault.secrets {
		if fileView != nil {
			if _, ok := fileView[key]; !ok {
				keys = append(keys, key)
			}
		} else if _, ok := env.ReadBack(key, value); !ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

// showVaultReadError explains an older server's unreadable .env text.
func showVaultReadError(deps *Dependencies, err error) {
	deps.UI.Error(err.Error())
	deps.UI.Message(deps.UI.Dim("This Keyway server predates exact values. Update it, or use the dashboard for this environment."))
}

// payloadFor returns what to push for secrets, and how: merged into the environment, or with
// prune replacing it. A server without exact values may also predate modes and always
// replace, so without prune it gets the whole environment back (the vault's secrets,
// overridden by these), still asked to merge: one that knows modes keeps a secret created
// since the pull, and one that does not reports the trashed ones to checkMerged.
func payloadFor(vault *vaultState, secrets map[string]string, prune bool) (map[string]string, api.PushMode) {
	if prune {
		return secrets, api.PushReplace
	}
	if vault.current || vault.empty {
		return secrets, api.PushMerge
	}
	payload := make(map[string]string, len(vault.secrets)+len(secrets))
	for key, value := range vault.secrets {
		payload[key] = value
	}
	for key, value := range secrets {
		payload[key] = value
	}
	return payload, api.PushMerge
}

// checkMerged reports, as an error, a merge the server did not do. A server that predates
// push modes replaces instead and moves the secrets missing from the push to the trash; that
// can happen when the server is rolled back between the pull and the push.
func checkMerged(deps *Dependencies, mode api.PushMode, resp *api.PushSecretsResponse, repo string) error {
	if mode != api.PushMerge || resp == nil || resp.Stats == nil || resp.Stats.Deleted == 0 {
		return nil
	}
	trashURL := fmt.Sprintf("%s/vaults/%s", config.GetDashboardURL(), repo)
	deps.UI.Error(fmt.Sprintf(
		"The server replaced the environment instead of merging: %d secret(s) moved to the trash.",
		resp.Stats.Deleted,
	))
	deps.UI.Message(fmt.Sprintf("Restore them from the trash: %s", deps.UI.Link(trashURL)))
	return fmt.Errorf("server did not merge: %d secret(s) moved to the trash", resp.Stats.Deleted)
}

// keepUnaltered returns the secrets to push from local, a file pull wrote and maybe edited.
// A value that is only what such a file makes of the vault's value ('x' read as x) gets the
// vault's value back (kept); a key that only comes from how the file reads another value is
// left out (dropped).
func keepUnaltered(local map[string]string, vault *vaultState) (result map[string]string, kept, dropped []string) {
	fileView := asFile(vault.content)
	result = make(map[string]string, len(local))
	for key, value := range local {
		stored, inVault := vault.secrets[key]
		var read string
		var inFile bool
		if fileView != nil {
			read, inFile = fileView[key]
		} else if inVault {
			read, inFile = env.ReadBack(key, stored)
		}
		// The file reads this key as value, and that is not the vault's value itself.
		altered := inFile && read == value && (!inVault || read != stored)
		switch {
		case !altered:
			result[key] = value
		case inVault:
			result[key] = stored
			kept = append(kept, key)
		default:
			dropped = append(dropped, key)
		}
	}
	sort.Strings(kept)
	sort.Strings(dropped)
	return result, kept, dropped
}

// keyList joins keys for a message, each one safe to print in a terminal.
func keyList(keys []string) string {
	shown := make([]string, len(keys))
	for i, key := range keys {
		shown[i] = ui.SafeKey(key)
	}
	return strings.Join(shown, ", ")
}
