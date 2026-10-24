package cmd

import (
	"context"
	"maps"
	"math/rand"
	"slices"
	"strings"
	"testing"
	"unicode"

	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
)

// fakeServer imitates the pull and push routes of the three kinds of servers the CLI meets.
type fakeServer struct {
	*MockAPIClient
	vault    map[string]string
	current  bool              // pull sends exact values (and push understands modes)
	modes    bool              // push understands modes; servers before them always replace
	rng      *rand.Rand        // shuffles the order of pulled lines
	teammate map[string]string // created by someone else just before the next push
	pushes   int
}

// serverAccepts mirrors isUsableNewKey in the backend.
func serverAccepts(key string) bool {
	isJSSpace := func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' }
	if key == "" || strings.TrimFunc(key, isJSSpace) != key || strings.HasPrefix(key, "#") {
		return false
	}
	for _, r := range key {
		if r == '=' || unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return false
		}
	}
	return true
}

func (s *fakeServer) PullSecrets(_ context.Context, _, _ string) (*api.PullSecretsResponse, error) {
	if len(s.vault) == 0 {
		return nil, &api.APIError{StatusCode: 404, Detail: "No secrets found"}
	}
	keys := sortedKeys(s.vault)
	s.rng.Shuffle(len(keys), func(a, b int) { keys[a], keys[b] = keys[b], keys[a] })
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		lines = append(lines, env.FormatLine(key, s.vault[key]))
	}
	resp := &api.PullSecretsResponse{Content: strings.Join(lines, "\n")}
	if s.current {
		resp.Secrets = maps.Clone(s.vault)
	}
	return resp, nil
}

func (s *fakeServer) PushSecrets(_ context.Context, _, _ string, secrets map[string]string, mode api.PushMode) (*api.PushSecretsResponse, error) {
	s.pushes++
	maps.Copy(s.vault, s.teammate)
	s.teammate = nil
	if !s.modes {
		mode = api.PushReplace
	}
	for key := range secrets {
		if _, exists := s.vault[key]; !exists && !serverAccepts(key) {
			return nil, &api.APIError{StatusCode: 400, Detail: "Cannot create 1 secret(s)"}
		}
	}
	resp := &api.PushSecretsResponse{Message: genericPushMessage, Stats: &struct {
		Created int `json:"created"`
		Updated int `json:"updated"`
		Deleted int `json:"deleted"`
	}{}}
	if mode == api.PushReplace {
		for key := range s.vault {
			if _, pushed := secrets[key]; !pushed {
				delete(s.vault, key)
				resp.Stats.Deleted++
			}
		}
	}
	for key, value := range secrets {
		s.vault[key] = value
	}
	return resp, nil
}

type serverKind struct {
	name           string
	current, modes bool
}

var serverKinds = []serverKind{
	{"current", true, true},
	{"exact values missing (4dc6cc4)", false, true},
	{"modes missing (b39bb76)", false, false},
}

var plainKeys = []string{"A", "B", "K", "C_1", "lower", "_X", "Q", "x y", "PADDED"}

// legacyKeysFor returns keys stored before the server refused them: no .env line holds them
// as they are. A server without exact values writes a key holding "=" as a shorter one plus
// a value (B= and =x as B and ==x), which nothing tells apart: only current servers get them.
func legacyKeysFor(kind serverKind) []string {
	if kind.current {
		return []string{" PADDED", "PADDED ", "#H", "A=B", "B=", "K\nL", `K="`, "K='"}
	}
	return []string{" PADDED", "PADDED ", "#H", "K\nL"}
}

// randomVault draws secrets, a few with legacy keys, with values made of the pieces that
// trouble a .env file.
func randomVault(rng *rand.Rand, legacyKeys []string) map[string]string {
	pieces := []string{"a", "Z9", " ", "\n", `"`, "'", `\`, "=", "#", "\t", "\r", "\r\n", "é", "x=y", `\"`, "\n\n", "\nK=\"", "\nB=1", "\n#c", "\nA=", "'\n", "\n'", " #"}
	vault := map[string]string{}
	for n := 1 + rng.Intn(5); n > 0; n-- {
		key := plainKeys[rng.Intn(len(plainKeys))]
		if len(legacyKeys) > 0 && rng.Intn(5) == 0 {
			key = legacyKeys[rng.Intn(len(legacyKeys))]
		}
		var b strings.Builder
		for p := rng.Intn(6); p > 0; p-- {
			b.WriteString(pieces[rng.Intn(len(pieces))])
		}
		vault[key] = b.String()
	}
	return vault
}

// isPlain reports whether every key of vault is one a .env line holds as it is.
func isPlain(vault map[string]string) bool {
	for key := range vault {
		if !slices.Contains(plainKeys, key) {
			return false
		}
	}
	return true
}

// changedOnly reports whether after differs from before in key alone, and only to one of
// the values allowed.
func changedOnly(before, after map[string]string, key string, allowed ...string) bool {
	for k, v := range before {
		if k != key && after[k] != v {
			return false
		}
	}
	for k := range after {
		if _, ok := before[k]; !ok && k != key {
			return false
		}
	}
	got, ok := after[key]
	stored, was := before[key]
	return ok == was && (!ok || got == stored) || ok && slices.Contains(allowed, got)
}

func newFakeRun(vault map[string]string, kind serverKind, rng *rand.Rand) (*Dependencies, *MockFileSystem, *fakeServer) {
	deps, _, _, _, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	server := &fakeServer{MockAPIClient: apiMock, vault: maps.Clone(vault), current: kind.current, modes: kind.modes, rng: rng}
	deps.APIFactory = &MockAPIFactory{Client: server}
	return deps, fsMock, server
}

// pullFile runs keyway pull and keeps the written file as the local one.
func pullFile(deps *Dependencies, fsMock *MockFileSystem) error {
	err := runPullWithDeps(pullOpts(), deps)
	if written, ok := fsMock.Written[".env"]; ok {
		fsMock.Files[".env"] = written
	}
	return err
}

// The PR's promise: pull, then push the file untouched (or saved with CRLF), changes nothing,
// with or without --prune, on every kind of server. A refusal is allowed; a change is not.
func TestProperty_PullThenPushChangesNothing(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	var plain, plainPushed int
	for i := 0; i < 6000; i++ {
		kind := serverKinds[rng.Intn(len(serverKinds))]
		vault := randomVault(rng, legacyKeysFor(kind))
		prune, crlf := rng.Intn(2) == 0, rng.Intn(4) == 0
		if isPlain(vault) && !crlf {
			plain++
		}
		deps, fsMock, server := newFakeRun(vault, kind, rng)
		if err := pullFile(deps, fsMock); err != nil {
			continue
		}
		if crlf {
			fsMock.Files[".env"] = []byte(strings.ReplaceAll(string(fsMock.Files[".env"]), "\n", "\r\n"))
		}
		if err := runPushWithDeps(pushOpts(prune), deps); err != nil {
			continue
		}
		if isPlain(vault) && !crlf {
			plainPushed++
		}
		if !maps.Equal(server.vault, vault) {
			t.Fatalf("%s, prune=%v crlf=%v: vault %q became %q\nfile %q", kind.name, prune, crlf, vault, server.vault, fsMock.Files[".env"])
		}
	}
	// Refusing is allowed, not refusing everything: files of vaults without legacy keys push
	// back (CRLF ones are refused more often: the server's own text no longer settles which
	// way a line reads)
	if plainPushed < plain*99/100 {
		t.Errorf("only %d of %d pulled files of vaults without legacy keys pushed back", plainPushed, plain)
	}
}

// keyway set changes its key and nothing else, on every kind of server.
func TestProperty_SetChangesOnlyItsKey(t *testing.T) {
	rng := rand.New(rand.NewSource(2))
	for i := 0; i < 6000; i++ {
		kind := serverKinds[rng.Intn(len(serverKinds))]
		vault := randomVault(rng, legacyKeysFor(kind))
		deps, _, server := newFakeRun(vault, kind, rng)
		if err := runSetWithDeps(setOpts("NEW_KEY", "v 1\n2"), deps); err != nil {
			if server.pushes > 0 {
				t.Fatalf("%s: set failed after pushing: %v", kind.name, err)
			}
			continue
		}
		want := maps.Clone(vault)
		want["NEW_KEY"] = "v 1\n2"
		if !maps.Equal(server.vault, want) {
			t.Fatalf("%s: vault %q became %q", kind.name, vault, server.vault)
		}
	}
}

var editedValues = []string{"plain", "two words", "line1\nline2", `say "hi"`, `ends \`, "", "'q", "\nB=1", `a\"`, "x\r", "'x'", "Z9"}

// pull, append a line, push: only the appended key changes.
func TestProperty_PullAppendPushCreatesOnlyTheNewKey(t *testing.T) {
	rng := rand.New(rand.NewSource(3))
	values := editedValues
	for i := 0; i < 6000; i++ {
		kind := serverKinds[rng.Intn(len(serverKinds))]
		vault := randomVault(rng, legacyKeysFor(kind))
		delete(vault, "NEW")
		deps, fsMock, server := newFakeRun(vault, kind, rng)
		if err := pullFile(deps, fsMock); err != nil {
			continue
		}
		value := values[rng.Intn(len(values))]
		fsMock.Files[".env"] = append(fsMock.Files[".env"], env.FormatLine("NEW", value)+"\n"...)
		if err := runPushWithDeps(pushOpts(rng.Intn(2) == 0), deps); err != nil {
			continue
		}
		// NEW holds what the file reads ('x' as x); vaults with legacy keys may also skip it
		read, _ := env.ReadBack("NEW", value)
		if !changedOnly(vault, server.vault, "NEW", read) || isPlain(vault) && server.vault["NEW"] != read {
			t.Fatalf("%s: vault %q + NEW=%q became %q\nfile %q", kind.name, vault, value, server.vault, fsMock.Files[".env"])
		}
	}
}

// pull, then override one key with a line at the end, push: only that key changes, to the
// value the file reads, unless that is only what the file makes of the stored value.
func TestProperty_PullEditPushChangesOnlyThatKey(t *testing.T) {
	rng := rand.New(rand.NewSource(5))
	for i := 0; i < 6000; i++ {
		kind := serverKinds[rng.Intn(len(serverKinds))]
		vault := randomVault(rng, legacyKeysFor(kind))
		// A legacy key's line names another key (" PADDED" reads as PADDED): only plain ones
		var keys []string
		for _, key := range sortedKeys(vault) {
			if slices.Contains(plainKeys, key) {
				keys = append(keys, key)
			}
		}
		if len(keys) == 0 {
			continue
		}
		key := keys[rng.Intn(len(keys))]
		deps, fsMock, server := newFakeRun(vault, kind, rng)
		if err := pullFile(deps, fsMock); err != nil {
			continue
		}
		value := editedValues[rng.Intn(len(editedValues))]
		fsMock.Files[".env"] = append(fsMock.Files[".env"], env.FormatLine(key, value)+"\n"...)
		fileView := asFile(env.FormatLine(key, vault[key]))
		if err := runPushWithDeps(pushOpts(rng.Intn(2) == 0), deps); err != nil {
			continue
		}
		read, _ := env.ReadBack(key, value)
		mustChange := isPlain(vault) && read != vault[key] && fileView[key] != read
		if !changedOnly(vault, server.vault, key, read) || mustChange && server.vault[key] != read {
			t.Fatalf("%s: vault %q, %q=%q became %q\nfile %q", kind.name, vault, key, value, server.vault, fsMock.Files[".env"])
		}
	}
}

// pull, then rewrite one secret's line in place with a new value, push: only that key changes,
// to the value the file reads, unless that is only what the file makes of the stored value.
func TestProperty_PullRewriteALinePushChangesOnlyThatKey(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	for i := 0; i < 6000; i++ {
		kind := serverKinds[rng.Intn(len(serverKinds))]
		vault := randomVault(rng, legacyKeysFor(kind))
		var keys []string
		for _, key := range sortedKeys(vault) {
			if slices.Contains(plainKeys, key) {
				keys = append(keys, key)
			}
		}
		if len(keys) == 0 {
			continue
		}
		key := keys[rng.Intn(len(keys))]
		deps, fsMock, server := newFakeRun(vault, kind, rng)
		if err := pullFile(deps, fsMock); err != nil {
			continue
		}
		content, line := "\n"+string(fsMock.Files[".env"]), "\n"+env.FormatLine(key, vault[key])+"\n"
		if strings.Count(content, line) != 1 {
			continue
		}
		value := editedValues[rng.Intn(len(editedValues))]
		fsMock.Files[".env"] = []byte(strings.Replace(content, line, "\n"+env.FormatLine(key, value)+"\n", 1)[1:])
		fileView := asFile(env.FormatLine(key, vault[key]))
		if err := runPushWithDeps(pushOpts(rng.Intn(2) == 0), deps); err != nil {
			continue
		}
		read, _ := env.ReadBack(key, value)
		mustChange := isPlain(vault) && read != vault[key] && fileView[key] != read
		if !changedOnly(vault, server.vault, key, read) || mustChange && server.vault[key] != read {
			t.Fatalf("%s: vault %q, %q=%q became %q\nfile %q", kind.name, vault, key, value, server.vault, fsMock.Files[".env"])
		}
	}
}

// A local file with its own keys, pull (which merges the vault into it), push: the vault
// gains the local keys, and nothing else changes.
func TestProperty_PullIntoALocalFileThenPushAddsOnlyItsKeys(t *testing.T) {
	rng := rand.New(rand.NewSource(6))
	for i := 0; i < 6000; i++ {
		kind := serverKinds[rng.Intn(len(serverKinds))]
		vault, local := randomVault(rng, legacyKeysFor(kind)), randomVault(rng, nil)
		for key := range local {
			if _, ok := vault[key]; ok || !serverAccepts(key) {
				delete(local, key)
			}
		}
		lines := make([]string, 0, len(local))
		for _, key := range sortedKeys(local) {
			lines = append(lines, env.FormatLine(key, local[key]))
		}
		localText := strings.Join(lines, "\n") + "\n"
		localRead, err := env.Parse(localText)
		if err != nil || len(localRead) == 0 {
			continue
		}
		deps, fsMock, server := newFakeRun(vault, kind, rng)
		fsMock.Files[".env"] = []byte(localText)
		if err := pullFile(deps, fsMock); err != nil {
			continue
		}
		if err := runPushWithDeps(pushOpts(false), deps); err != nil {
			continue
		}
		for key, value := range vault {
			if server.vault[key] != value {
				t.Fatalf("%s: vault %q, local %q: %q became %q", kind.name, vault, localText, key, server.vault)
			}
		}
		for key, value := range server.vault {
			if _, inVault := vault[key]; !inVault && value != localRead[key] {
				t.Fatalf("%s: vault %q, local %q: created %q=%q", kind.name, vault, localText, key, value)
			}
		}
		if isPlain(vault) && len(server.vault) != len(vault)+len(localRead) {
			t.Fatalf("%s: vault %q, local %q: became %q", kind.name, vault, localText, server.vault)
		}
	}
}

// A secret a teammate creates between the CLI's read and its write survives, whatever the
// server: a server with modes merges, one without is caught by checkMerged.
func TestSetAndPush_KeepASecretCreatedMeanwhile(t *testing.T) {
	for _, kind := range serverKinds {
		for _, command := range []string{"set", "push"} {
			rng := rand.New(rand.NewSource(4))
			deps, fsMock, server := newFakeRun(map[string]string{"A": "1"}, kind, rng)
			server.teammate = map[string]string{"TEAMMATE": "theirs"}
			fsMock.Files[".env"] = []byte("A=2\n")

			var err error
			if command == "set" {
				err = runSetWithDeps(setOpts("NEW_KEY", "value-1"), deps)
			} else {
				err = runPushWithDeps(pushOpts(false), deps)
			}

			if _, kept := server.vault["TEAMMATE"]; !kept && err == nil {
				t.Errorf("%s, %s: TEAMMATE trashed and no error (vault %q)", kind.name, command, server.vault)
			}
			if kind.modes && server.vault["TEAMMATE"] != "theirs" {
				t.Errorf("%s, %s: a server with modes must keep TEAMMATE (vault %q)", kind.name, command, server.vault)
			}
		}
	}
}
