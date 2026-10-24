package cmd

import (
	"context"
	"errors"
	"fmt"
	"slices"
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
	current bool // the server sends exact values, so it also understands push modes
	empty   bool // the environment has no secrets yet (the server answered 404)

	fileView map[string]string // see file
	fileRead bool
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
	return &vaultState{secrets: secrets, current: current}, nil
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

// asFile returns what a .env file holding content reads as (see env.Parse), or nil when such
// a file cannot be read.
func asFile(content string) map[string]string {
	read, err := env.Parse(content)
	if err != nil {
		return nil
	}
	return read
}

// file returns what the file pull writes for the vault reads as (see asFile), computed once.
func (v *vaultState) file() map[string]string {
	if !v.fileRead {
		v.fileView, v.fileRead = asFile(env.Format(v.secrets)), true
	}
	return v.fileView
}

// lineBreakers returns the keys of secrets whose line in a .env file lets the lines of their
// value read as lines of their own: a key holding a line break, or a multi-line value whose
// key the file reads as no key (a comment, "") or as the start of a value ("A=B"). Such keys
// were stored before the server refused them. Against them, an edit anywhere in the file can
// change how other values read, so push refuses the file.
func lineBreakers(secrets map[string]string) []string {
	var keys []string
	for key, value := range secrets {
		name := strings.TrimSpace(key)
		readsAsNoKey := name == "" || strings.HasPrefix(name, "#") || strings.Contains(key, "=")
		if strings.Contains(key, "\n") || strings.Contains(value, "\n") && readsAsNoKey {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

// lineNames counts, for each key a .env file reads, the vault's secrets whose own line reads
// as that key: 2 for PADDED when the vault holds "PADDED" and " PADDED".
func lineNames(vault *vaultState) map[string]int {
	names := map[string]int{}
	for key, value := range vault.secrets {
		read, err := env.Parse(env.FormatLine(key, value))
		if err != nil {
			continue
		}
		for fileKey := range read {
			names[fileKey]++
		}
	}
	return names
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
		case explained: // spinWithRelogin showed why already
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
	fileView := vault.file()
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

// unaltered is what push sends for a local file, and the keys it does not send as read.
type unaltered struct {
	secrets map[string]string
	kept    []string // sent with the vault's value: the file cannot hold it exactly
	dropped []string // not created: the file only reads it out of how other secrets are written
	unknown []string // not in the vault, which does not read as a file: nothing tells if it is new
}

// keepUnaltered returns the secrets to push from local, a file pull wrote and maybe edited.
// A value that is only what such a file makes of the vault's value ('x' read as x), or whose
// line may be another secret's, gets the vault's value back (kept); a key that only comes
// from how the file writes other secrets (" PADDED" as PADDED) is left out (dropped).
func keepUnaltered(local map[string]string, vault *vaultState) unaltered {
	fileView := vault.file()
	names := lineNames(vault)
	u := unaltered{secrets: make(map[string]string, len(local))}
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
		case inVault && (altered || names[key] > 1 && value != stored):
			u.secrets[key] = stored
			u.kept = append(u.kept, key)
		case !inVault && (altered || names[key] > 0):
			u.dropped = append(u.dropped, key)
		case !inVault && fileView == nil:
			u.unknown = append(u.unknown, key)
		default:
			u.secrets[key] = value
		}
	}
	sort.Strings(u.kept)
	sort.Strings(u.dropped)
	sort.Strings(u.unknown)
	return u
}

// without returns keys minus those in drop, in order.
func without(keys, drop []string) []string {
	var out []string
	for _, key := range keys {
		if !slices.Contains(drop, key) {
			out = append(out, key)
		}
	}
	return out
}

// keyList joins keys for a message, each one safe to print in a terminal.
func keyList(keys []string) string {
	shown := make([]string, len(keys))
	for i, key := range keys {
		shown[i] = ui.SafeKey(key)
	}
	return strings.Join(shown, ", ")
}
