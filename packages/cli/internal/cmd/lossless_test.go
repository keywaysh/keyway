package cmd

import (
	"errors"
	"maps"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/env"
)

// Exact values a current server returns, and the .env text it sends next to them.
func currentServer(secrets map[string]string) *api.PullSecretsResponse {
	lines := make([]string, 0, len(secrets))
	for _, key := range sortedKeys(secrets) {
		lines = append(lines, env.FormatLine(key, secrets[key]))
	}
	return &api.PullSecretsResponse{Content: strings.Join(lines, "\n"), Secrets: secrets}
}

func sortedKeys(m map[string]string) []string {
	return slices.Sorted(maps.Keys(m))
}

func joined(calls []string) string { return strings.Join(calls, "\n") }

// --- readVault ---

func TestReadVault_UsesExactValuesWhenTheServerSendsThem(t *testing.T) {
	_, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	exact := map[string]string{"QUOTED": "'x'", "TRAIL": `ends with \`}
	apiMock.PullResponse = currentServer(exact)

	state, err := readVault(apiMock, "owner/repo", "development")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !state.current || state.empty || !reflect.DeepEqual(state.secrets, exact) {
		t.Errorf("got %+v, want the exact values", state)
	}
}

func TestReadVault_ParsesContentFromAnOlderServer(t *testing.T) {
	_, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "MULTI=\"line1\nline2\"\nGREETING=\"say \\\"hi\\\"\""}

	state, err := readVault(apiMock, "owner/repo", "development")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := map[string]string{"MULTI": "line1\nline2", "GREETING": `say "hi"`}
	if state.current || !reflect.DeepEqual(state.secrets, want) {
		t.Errorf("got %+v, want %q read from the content", state, want)
	}
}

func TestReadVault_ReadsAnOlderServersTextExactly(t *testing.T) {
	// A file would read 'x' as x and drop the \r; the server's own text keeps them.
	_, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "W='x'\nCR=a\r\nA=1"}

	state, err := readVault(apiMock, "owner/repo", "development")

	want := map[string]string{"W": "'x'", "CR": "a\r", "A": "1"}
	if err != nil || !reflect.DeepEqual(state.secrets, want) {
		t.Errorf("got %q (%v), want %q", state.secrets, err, want)
	}
}

func TestReadVault_EmptyEnvironment(t *testing.T) {
	_, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullError = &api.APIError{StatusCode: 404, Detail: "No secrets found"}

	state, err := readVault(apiMock, "owner/repo", "development")

	if err != nil || !state.empty || len(state.secrets) != 0 {
		t.Errorf("got %+v, %v; want an empty environment", state, err)
	}
}

func TestReadVault_RefusesContentItCannotReadSafely(t *testing.T) {
	_, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "A=\"never closed\nB=2"}

	_, err := readVault(apiMock, "owner/repo", "development")

	if err == nil || !strings.Contains(err.Error(), "line 1") {
		t.Errorf("expected an error naming line 1, got %v", err)
	}
}

// --- set ---

func setOpts(key, value string) SetOptions {
	return SetOptions{Key: key, Value: value, EnvName: "development", EnvFlagSet: true, Yes: true}
}

func TestRunSetWithDeps_SendsOnlyTheKeyInMergeMode(t *testing.T) {
	deps, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{"MULTI": "line1\nline2", "OTHER": "x"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runSetWithDeps(setOpts("NEW_KEY", "value-1"), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !reflect.DeepEqual(apiMock.PushedSecrets, map[string]string{"NEW_KEY": "value-1"}) {
		t.Errorf("pushed %q, want only NEW_KEY", apiMock.PushedSecrets)
	}
	if apiMock.PushedMode != api.PushMerge {
		t.Errorf("mode %q, want merge", apiMock.PushedMode)
	}
}

func TestRunSetWithDeps_EmptyEnvironmentSendsOnlyTheKey(t *testing.T) {
	deps, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullError = &api.APIError{StatusCode: 404}
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runSetWithDeps(setOpts("NEW_KEY", "value-1"), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !reflect.DeepEqual(apiMock.PushedSecrets, map[string]string{"NEW_KEY": "value-1"}) || apiMock.PushedMode != api.PushMerge {
		t.Errorf("pushed %q (%s), want only NEW_KEY in merge", apiMock.PushedSecrets, apiMock.PushedMode)
	}
}

func TestRunSetWithDeps_OlderServerGetsEveryValueReadExactly(t *testing.T) {
	// An older server may ignore modes and replace: send every secret, read without loss, and
	// still ask for a merge so that checkMerged can tell.
	deps, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "MULTI=\"line1\nline2\"\nGREETING=\"say \\\"hi\\\"\""}
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runSetWithDeps(setOpts("NEW_KEY", "value-1"), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := map[string]string{"MULTI": "line1\nline2", "GREETING": `say "hi"`, "NEW_KEY": "value-1"}
	if !reflect.DeepEqual(apiMock.PushedSecrets, want) {
		t.Errorf("pushed %q, want %q", apiMock.PushedSecrets, want)
	}
	if apiMock.PushedMode != api.PushMerge {
		t.Errorf("mode %q, want merge", apiMock.PushedMode)
	}
}

func TestRunSetWithDeps_OlderServerContentItCannotReadPushesNothing(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "A=\"never closed\nB=2"}

	err := runSetWithDeps(setOpts("NEW_KEY", "value-1"), deps)

	if err == nil {
		t.Fatal("expected an error")
	}
	if apiMock.PushCalls != 0 {
		t.Errorf("expected no push, got %d", apiMock.PushCalls)
	}
	if !strings.Contains(joined(uiMock.ErrorCalls)+joined(uiMock.MessageCalls), "dashboard") {
		t.Errorf("expected the error to point to the dashboard, got %q then %q", uiMock.ErrorCalls, uiMock.MessageCalls)
	}
}

func TestRunSetWithDeps_ShowsWhatTheServerSays(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{"A": "1"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed. Kept the stored values of A."}

	if err := runSetWithDeps(setOpts("A", "2"), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(joined(uiMock.MessageCalls)+joined(uiMock.InfoCalls), "Kept the stored values of A") {
		t.Errorf("expected the server message, got messages %q and infos %q", uiMock.MessageCalls, uiMock.InfoCalls)
	}
}

func TestRunSetWithDeps_HidesTheGenericServerMessage(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{"A": "1"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runSetWithDeps(setOpts("B", "2"), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if strings.Contains(joined(uiMock.MessageCalls)+joined(uiMock.InfoCalls), "Secrets pushed successfully") {
		t.Errorf("did not expect the generic message, got %q", uiMock.MessageCalls)
	}
}

func TestRunSetWithDeps_LocalFileKeepsMultiLineValues(t *testing.T) {
	deps, _, _, _, fsMock, _, _ := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("MULTI=\"line1\nline2\"\n")
	opts := setOpts("NEW_KEY", "two words")
	opts.LocalOnly = true

	if err := runSetWithDeps(opts, deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, err := env.Parse(string(fsMock.Written[".env"]))
	if err != nil {
		t.Fatalf("written file does not parse: %v", err)
	}
	want := map[string]string{"MULTI": "line1\nline2", "NEW_KEY": "two words"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("file reads back %q, want %q", got, want)
	}
}

// --- push ---

func pushOpts(prune bool) PushOptions {
	return PushOptions{EnvName: "development", File: ".env", Yes: true, EnvFlagSet: true, Prune: prune}
}

func TestRunPushWithDeps_SendsOnlyTheLocalFileInMergeMode(t *testing.T) {
	deps, _, _, _, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("A=1\nMULTI=\"line1\nline2\"\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"A": "0", "VAULT_ONLY": "line1\nline2"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(false), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := map[string]string{"A": "1", "MULTI": "line1\nline2"}
	if !reflect.DeepEqual(apiMock.PushedSecrets, want) {
		t.Errorf("pushed %q, want only the local file %q", apiMock.PushedSecrets, want)
	}
	if apiMock.PushedMode != api.PushMerge {
		t.Errorf("mode %q, want merge", apiMock.PushedMode)
	}
}

func TestRunPushWithDeps_PruneReplaces(t *testing.T) {
	deps, _, _, _, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("A=1\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"A": "0", "VAULT_ONLY": "x"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(true), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !reflect.DeepEqual(apiMock.PushedSecrets, map[string]string{"A": "1"}) || apiMock.PushedMode != api.PushReplace {
		t.Errorf("pushed %q (%s), want A in replace", apiMock.PushedSecrets, apiMock.PushedMode)
	}
}

func TestRunPushWithDeps_OlderServerStillGetsVaultOnlySecretsBack(t *testing.T) {
	deps, _, _, _, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("A=1\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "A=0\nVAULT_ONLY=\"line1\nline2\""}
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(false), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := map[string]string{"A": "1", "VAULT_ONLY": "line1\nline2"}
	if !reflect.DeepEqual(apiMock.PushedSecrets, want) {
		t.Errorf("pushed %q, want %q", apiMock.PushedSecrets, want)
	}
}

func TestRunPushWithDeps_RefusesALocalFileItCannotReadSafely(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("A=1\nPEM=\"first line\nsecond line\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"A": "0"})

	err := runPushWithDeps(pushOpts(false), deps)

	if err == nil {
		t.Fatal("expected an error")
	}
	if apiMock.PushCalls != 0 {
		t.Errorf("expected no push, got %d", apiMock.PushCalls)
	}
	if !strings.Contains(joined(uiMock.ErrorCalls), "line 2") {
		t.Errorf("expected the error to name line 2, got %q", uiMock.ErrorCalls)
	}
}

func TestRunPushWithDeps_KeepsValuesTheEnvFileCannotHold(t *testing.T) {
	// pull wrote W='x' for the value 'x'; that line reads back as x. Pushing it back must not
	// replace the stored value.
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	vault := map[string]string{"W": "'x'", "A": "0"}
	fsMock.Files[".env"] = []byte(currentServer(vault).Content + "\nA=1\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(vault)
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(true), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if apiMock.PushedSecrets["W"] != "'x'" || apiMock.PushedSecrets["A"] != "1" {
		t.Errorf("pushed %q, want W unchanged and A=1", apiMock.PushedSecrets)
	}
	if !strings.Contains(joined(uiMock.WarnCalls)+joined(uiMock.InfoCalls), "W") {
		t.Errorf("expected a notice naming W, got warns %q infos %q", uiMock.WarnCalls, uiMock.InfoCalls)
	}
}

// --- pull ---

func pullOpts() PullOptions {
	return PullOptions{EnvName: "development", File: ".env", Yes: true, EnvFlagSet: true}
}

func TestRunPullWithDeps_KeepsMultiLineLocalOnlyValues(t *testing.T) {
	deps, _, _, _, fsMock, _, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("LOCAL=\"line1\nline2\"\n")
	apiMock.PullResponse = currentServer(map[string]string{"A": "two words"})

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, err := env.Parse(string(fsMock.Written[".env"]))
	if err != nil {
		t.Fatalf("written file does not parse: %v", err)
	}
	want := map[string]string{"A": "two words", "LOCAL": "line1\nline2"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("file reads back %q, want %q", got, want)
	}
}

func TestRunPullWithDeps_RefusesToMergeIntoAFileItCannotRead(t *testing.T) {
	deps, _, _, _, fsMock, _, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("LOCAL=\"never closed\nX=1\n")
	apiMock.PullResponse = currentServer(map[string]string{"A": "1"})

	err := runPullWithDeps(pullOpts(), deps)

	if err == nil {
		t.Fatal("expected an error")
	}
	if _, written := fsMock.Written[".env"]; written {
		t.Error("expected the file to be left alone")
	}
}

func TestRunPullWithDeps_WarnsAboutValuesTheFileCannotHold(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{"W": "'x'", "A": "1"})

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(joined(uiMock.WarnCalls), "cannot hold the exact value of W.") {
		t.Errorf("expected a warning naming W only, got %q", uiMock.WarnCalls)
	}
}

func TestRunPullWithDeps_CountsVariablesNotLines(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{"MULTI": "line1\nline2\nline3", "A": "1"})

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(joined(uiMock.MessageCalls), "Variables: 2") {
		t.Errorf("expected 2 variables, got %q", uiMock.MessageCalls)
	}
}

// --- run ---

func TestRunRunWithDeps_InjectsExactValues(t *testing.T) {
	deps, _, _, _, cmdRunner, apiMock := NewTestDepsWithRunner()
	exact := map[string]string{"MULTI": "line1\nline2", "QUOTED": `say "hi"`, "WRAPPED": "'x'"}
	apiMock.PullResponse = currentServer(exact)

	opts := RunOptions{EnvName: "development", EnvFlagSet: true, Command: "env"}
	if err := runRunWithDeps(opts, deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !reflect.DeepEqual(cmdRunner.LastSecrets, exact) {
		t.Errorf("injected %q, want %q", cmdRunner.LastSecrets, exact)
	}
}

func TestRunRunWithDeps_OlderServerContentItCannotReadRunsNothing(t *testing.T) {
	deps, _, _, _, cmdRunner, apiMock := NewTestDepsWithRunner()
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "A=\"never closed\nB=2"}

	opts := RunOptions{EnvName: "development", EnvFlagSet: true, Command: "env"}
	if err := runRunWithDeps(opts, deps); err == nil {
		t.Fatal("expected an error")
	}
	if cmdRunner.LastCommand != "" {
		t.Errorf("expected no command to run, got %q", cmdRunner.LastCommand)
	}
}

// --- diff ---

func TestRunDiffWithDeps_ComparesExactValues(t *testing.T) {
	// 'x' and x read the same from .env text; the exact values differ.
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponses = map[string]*api.PullSecretsResponse{
		"development": currentServer(map[string]string{"W": "'x'"}),
		"production":  currentServer(map[string]string{"W": "x"}),
	}

	result, err := diffResultWithDeps(DiffOptions{Env1: "development", Env2: "production"}, deps)

	if err != nil {
		t.Fatalf("unexpected error: %v (errors %q)", err, uiMock.ErrorCalls)
	}
	if len(result.Different) != 1 || result.Different[0].Key != "W" {
		t.Errorf("expected W to differ, got %+v", result)
	}
}

func TestRunPullWithDeps_EndsTheFileWithANewline(t *testing.T) {
	// Users append lines with echo >> .env: the last pulled line must not absorb them. Merge
	// and --force write the file differently; check both.
	for _, force := range []bool{false, true} {
		deps, _, _, _, fsMock, _, apiMock := NewTestDepsWithEnv()
		fsMock.Files[".env"] = []byte("A=0")
		apiMock.PullResponse = currentServer(map[string]string{"WRAPPED": "'x'", "A": "1"})
		opts := pullOpts()
		opts.Force = force

		if err := runPullWithDeps(opts, deps); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		written := string(fsMock.Written[".env"])
		if !strings.HasSuffix(written, "\n") {
			t.Fatalf("force=%v: file does not end with a newline: %q", force, written)
		}
		got, err := env.Parse(written + "CERT=\"line one\nline two\"\n")
		if err != nil || got["CERT"] != "line one\nline two" || got["A"] != "1" {
			t.Errorf("force=%v: appended line read as %q (%v)", force, got, err)
		}
	}
}

func TestRunSetWithDeps_OlderServerGetsValuesAFileWouldAlterUnchanged(t *testing.T) {
	deps, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "W='x'\nCR=a\r\nA=1"}
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runSetWithDeps(setOpts("NEW_KEY", "value-1"), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := map[string]string{"W": "'x'", "CR": "a\r", "A": "1", "NEW_KEY": "value-1"}
	if !reflect.DeepEqual(apiMock.PushedSecrets, want) {
		t.Errorf("pushed %q, want %q", apiMock.PushedSecrets, want)
	}
}

// A server rolled back between the pull and the push replaces instead of merging.
func TestRunSetWithDeps_ReportsAMergeTheServerDidNotDo(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{"A": "1", "B": "2", "C": "3"})
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets pushed successfully",
		Stats: &struct {
			Created int `json:"created"`
			Updated int `json:"updated"`
			Deleted int `json:"deleted"`
		}{Created: 1, Deleted: 3},
	}

	err := runSetWithDeps(setOpts("NEW_KEY", "value-1"), deps)

	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(joined(uiMock.ErrorCalls), "3 secret(s) moved to the trash") {
		t.Errorf("expected the trashed count, got %q", uiMock.ErrorCalls)
	}
	if !strings.Contains(joined(uiMock.MessageCalls), "/vaults/owner/repo") {
		t.Errorf("expected a link to the vault, got %q", uiMock.MessageCalls)
	}
	if len(uiMock.SuccessCalls) != 0 {
		t.Errorf("did not expect a success message, got %q", uiMock.SuccessCalls)
	}
}

func TestRunPushWithDeps_ReportsAMergeTheServerDidNotDo(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("A=1\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"A": "0", "B": "2"})
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets pushed successfully",
		Stats: &struct {
			Created int `json:"created"`
			Updated int `json:"updated"`
			Deleted int `json:"deleted"`
		}{Updated: 1, Deleted: 1},
	}

	if err := runPushWithDeps(pushOpts(false), deps); err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(joined(uiMock.ErrorCalls), "1 secret(s) moved to the trash") {
		t.Errorf("expected the trashed count, got %q", uiMock.ErrorCalls)
	}
}

func TestRunPushWithDeps_PruneMayTrash(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("A=1\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"A": "0", "B": "2"})
	apiMock.PushResponse = &api.PushSecretsResponse{
		Message: "Secrets pushed successfully",
		Stats: &struct {
			Created int `json:"created"`
			Updated int `json:"updated"`
			Deleted int `json:"deleted"`
		}{Updated: 1, Deleted: 1},
	}

	if err := runPushWithDeps(pushOpts(true), deps); err != nil {
		t.Fatalf("unexpected error: %v (%q)", err, uiMock.ErrorCalls)
	}
}

// The audit's case: a stored key holding a newline makes the pulled file read A wrongly and
// invent Q. Pushing that file back changes nothing: push refuses it.
func TestRunPushWithDeps_RefusesWhatTheFileMisreads(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	vault := map[string]string{"A": "p\"\nQ='\nz", "K\nL": "w'"}
	pulled := &api.PullSecretsResponse{
		Content: env.FormatLine("A", vault["A"]) + "\n" + env.FormatLine("K\nL", vault["K\nL"]),
		Secrets: vault,
	}
	fsMock.Files[".env"] = []byte(pulled.Content + "\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = pulled

	err := runPushWithDeps(pushOpts(false), deps)

	if err == nil || apiMock.PushCalls != 0 {
		t.Fatalf("err %v, %d push(es), want a refusal", err, apiMock.PushCalls)
	}
	if !strings.Contains(joined(uiMock.ErrorCalls), `"K\nL"`) {
		t.Errorf("expected the key to be named, got %q", uiMock.ErrorCalls)
	}
}

func TestRunPullWithDeps_ShowsNoChangeAfterAPull(t *testing.T) {
	// The file holds W='x', which reads as x: that is what pull writes, not a change.
	deps, _, _, uiMock, fsMock, _, apiMock := NewTestDepsWithEnv()
	pulled := currentServer(map[string]string{"W": "'x'", "A": "1"})
	fsMock.Files[".env"] = []byte(pulled.Content + "\n")
	apiMock.PullResponse = pulled

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(uiMock.DiffChangedCalls) != 0 || len(uiMock.DiffAddedCalls) != 0 {
		t.Errorf("expected no change, got changed %q added %q", uiMock.DiffChangedCalls, uiMock.DiffAddedCalls)
	}
}

func TestRunPullWithDeps_SaysPushWouldRefuseAnUnreadableFile(t *testing.T) {
	// "A='abc" then "B=xyz'" also reads as one two-line value
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{"A": "'abc", "B": "xyz'"})

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(joined(uiMock.WarnCalls), "keyway push would refuse it") {
		t.Errorf("expected the warning to mention push, got %q", uiMock.WarnCalls)
	}
}

func TestRunPullWithDeps_NamesKeysSafely(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{"W\x1b[2J": "'x'"})

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	warns := joined(uiMock.WarnCalls)
	if strings.Contains(warns, "\x1b") || !strings.Contains(warns, `"W\x1b[2J"`) {
		t.Errorf("expected the key escaped, got %q", warns)
	}
}

func TestRunPullWithDeps_KeepsLocalOnlyLinesAndAppendedOnes(t *testing.T) {
	deps, _, _, _, fsMock, _, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("LOCAL=only here")
	apiMock.PullResponse = currentServer(map[string]string{"A": "1"})

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, err := env.Parse(string(fsMock.Written[".env"]) + "NEW=appended\n")
	want := map[string]string{"A": "1", "LOCAL": "only here", "NEW": "appended"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("file with an appended line reads %q (%v), want %q", got, err, want)
	}
}

func TestRunDiffWithDeps_ExplainsAnOlderServersUnreadableText(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponses = map[string]*api.PullSecretsResponse{
		"development": {Content: "A=\"never closed\nB=2"},
		"production":  currentServer(map[string]string{"A": "1"}),
	}

	if _, err := diffResultWithDeps(DiffOptions{Env1: "development", Env2: "production"}, deps); err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(joined(uiMock.ErrorCalls), "cannot read the vault's secrets safely") {
		t.Errorf("expected the error to be shown, got %q", uiMock.ErrorCalls)
	}
}

func TestRunRunWithDeps_SkipsWhatCannotBeAnEnvironmentVariable(t *testing.T) {
	deps, _, _, uiMock, cmdRunner, apiMock := NewTestDepsWithRunner()
	apiMock.PullResponse = currentServer(map[string]string{"A=B": "x", "NUL": "a\x00b", "OK": "1"})

	opts := RunOptions{EnvName: "development", EnvFlagSet: true, Command: "env"}
	if err := runRunWithDeps(opts, deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !reflect.DeepEqual(cmdRunner.LastSecrets, map[string]string{"OK": "1"}) {
		t.Errorf("injected %q, want only OK", cmdRunner.LastSecrets)
	}
	if !strings.Contains(joined(uiMock.WarnCalls), "A=B, NUL") {
		t.Errorf("expected the skipped keys to be named, got %q", uiMock.WarnCalls)
	}
}

func TestSpinWithRelogin_RetriesWithTheNewToken(t *testing.T) {
	deps, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullErrorFirst = &api.APIError{StatusCode: 401}
	apiMock.PullResponse = currentServer(map[string]string{"A": "1"})
	deps.Relogin = func(error, *Dependencies) (string, error) { return "new-token", nil }

	var vault *vaultState
	_, explained, err := spinWithRelogin(deps, deps.APIFactory.NewClient("old-token"), "Fetching...", func(c api.APIClient) error {
		var readErr error
		vault, readErr = readVault(c, "owner/repo", "development")
		return readErr
	})

	if err != nil || explained || vault.secrets["A"] != "1" {
		t.Fatalf("got %v (explained %v), %+v", err, explained, vault)
	}
	factory := deps.APIFactory.(*MockAPIFactory)
	if !reflect.DeepEqual(factory.Tokens, []string{"old-token", "new-token"}) {
		t.Errorf("clients created with %q, want old-token then new-token", factory.Tokens)
	}
}

func TestSpinWithRelogin_ReportsAFailedReloginAsExplained(t *testing.T) {
	deps, _, _, _, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullErrorFirst = &api.APIError{StatusCode: 401}
	cancelled := errors.New("login cancelled")
	deps.Relogin = func(error, *Dependencies) (string, error) { return "", cancelled }

	_, explained, err := spinWithRelogin(deps, deps.APIFactory.NewClient("old-token"), "Fetching...", func(c api.APIClient) error {
		_, readErr := readVault(c, "owner/repo", "development")
		return readErr
	})

	if !explained || !errors.Is(err, cancelled) {
		t.Errorf("got %v (explained %v), want the re-login error, explained", err, explained)
	}
}

// Keys created before the server refused them cannot be written to a .env file: a file never
// holds them, so --prune must not take that as asking to remove them.
func TestRunPushWithDeps_PruneKeepsKeysAFileCannotName(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	vault := map[string]string{" PADDED": "1", "#HASHED": "2", "A": "0"}
	pulled := currentServer(vault)
	fsMock.Files[".env"] = []byte(pulled.Content + "\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = pulled
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(true), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, key := range []string{" PADDED", "#HASHED"} {
		if apiMock.PushedSecrets[key] != vault[key] {
			t.Errorf("%q: pushed %q, want its stored value kept", key, apiMock.PushedSecrets[key])
		}
	}
	if !strings.Contains(joined(uiMock.WarnCalls), "a .env file cannot name it") {
		t.Errorf("expected the kept keys to be named, got %q", uiMock.WarnCalls)
	}
}

func TestRunPullWithDeps_SaysWhichKeysTheFileCannotName(t *testing.T) {
	deps, _, _, uiMock, _, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = currentServer(map[string]string{" PADDED": "1", "A": "1"})

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	warns := joined(uiMock.WarnCalls)
	if !strings.Contains(warns, `cannot name " PADDED"`) || strings.Contains(warns, "exact value") {
		t.Errorf("expected the key, not its value, to be named, got %q", warns)
	}
}

func TestRunPushWithDeps_EscapesVaultOnlyKeys(t *testing.T) {
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("A=1\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"A": "0", "B\u202eC": "x"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(false), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if warns := joined(uiMock.WarnCalls); strings.Contains(warns, "\u202e") || !strings.Contains(warns, `"B\u202eC"`) {
		t.Errorf("expected the key escaped, got %q", warns)
	}
}

func TestRunPushWithDeps_KeepsTheValuesOfKeysAFileReadsAsOne(t *testing.T) {
	// " PADDED=b" and "PADDED=a" both read as PADDED: an edited value may be meant for either.
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("PADDED=edited\nA=2\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"PADDED": "a", " PADDED": "b", "A": "1"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(false), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if want := map[string]string{"PADDED": "a", "A": "2"}; !reflect.DeepEqual(apiMock.PushedSecrets, want) {
		t.Errorf("pushed %q, want %q", apiMock.PushedSecrets, want)
	}
	if !strings.Contains(joined(uiMock.WarnCalls), "Kept the vault value of PADDED") {
		t.Errorf("no warning about PADDED: %q", uiMock.WarnCalls)
	}
}

func TestRunPushWithDeps_RefusesNewKeysWhenTheVaultDoesNotReadAsAFile(t *testing.T) {
	// "A='abc" then "B=xyz'" also reads as one two-line value: a file holding the vault cannot
	// be read, so nothing tells a new key from one read out of the vault's values.
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("NEW=1\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"A": "'abc", "B": "xyz'"})

	err := runPushWithDeps(pushOpts(false), deps)

	if err == nil {
		t.Fatal("expected an error")
	}
	if apiMock.PushCalls != 0 {
		t.Errorf("expected no push, got %d", apiMock.PushCalls)
	}
	if !strings.Contains(joined(uiMock.MessageCalls), "keyway set") {
		t.Errorf("no pointer to keyway set: %q", uiMock.MessageCalls)
	}
}

func TestRunPushWithDeps_DoesNotSuggestPruneForKeysNoFileCanName(t *testing.T) {
	// --prune keeps " PADDED" anyway: no file can name it.
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("A=2\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"A": "1", " PADDED": "x"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(false), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if all := joined(uiMock.WarnCalls) + joined(uiMock.MessageCalls); strings.Contains(all, "--prune") {
		t.Errorf("suggests --prune for a key no file can name: %q", all)
	}
}

func TestRunPushWithDeps_PruneKeepsAnUnchangedKeyAFileReadsAsOne(t *testing.T) {
	stored := map[string]string{"PADDED": "a", " PADDED": "b", "A": "1"}
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte(currentServer(stored).Content + "\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(stored)
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(true), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !reflect.DeepEqual(apiMock.PushedSecrets, stored) {
		t.Errorf("pushed %q, want %q", apiMock.PushedSecrets, stored)
	}
	if strings.Contains(joined(uiMock.WarnCalls), "Kept the vault value") {
		t.Errorf("warns about a value nobody changed: %q", uiMock.WarnCalls)
	}
}

func TestRunPullWithDeps_WritesSecretsInKeyOrder(t *testing.T) {
	// The file does not depend on the order the server lists them in, so push reads it the
	// same way whatever order the server lists them in then.
	deps, _, _, _, fsMock, _, apiMock := NewTestDepsWithEnv()
	apiMock.PullResponse = &api.PullSecretsResponse{Content: "B=2\nA=1", Secrets: map[string]string{"A": "1", "B": "2"}}

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got := string(fsMock.Written[".env"]); got != "A=1\nB=2\n" {
		t.Errorf("wrote %q", got)
	}
}

func TestRunPushWithDeps_NeverCreatesAKeyOnlyAnotherSecretsLineNames(t *testing.T) {
	// "PADDED=" is the line of " PADDED", which no file can name: an edit of it (or an editor
	// rewriting it) is not a new secret.
	deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("PADDED=edited\nA=2\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{" PADDED": "x", "A": "1"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(false), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if want := map[string]string{"A": "2"}; !reflect.DeepEqual(apiMock.PushedSecrets, want) {
		t.Errorf("pushed %q, want %q", apiMock.PushedSecrets, want)
	}
	if !strings.Contains(joined(uiMock.WarnCalls), "Did not create PADDED") {
		t.Errorf("no warning about PADDED: %q", uiMock.WarnCalls)
	}
}

func TestRunPullWithDeps_RefusesAMergeWhoseLocalLinesChangeTheVaultsValues(t *testing.T) {
	// "A='" reads as ' on its own; the local line "NOTE=fine'" after it would close it, and
	// the line "K" of the key "K\nL" leaves only that reading.
	deps, _, _, uiMock, fsMock, _, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("NOTE=fine'\n")
	apiMock.PullResponse = currentServer(map[string]string{"A": "'", "K\nL": "1"})

	err := runPullWithDeps(pullOpts(), deps)

	if err == nil {
		t.Fatal("expected an error")
	}
	if _, written := fsMock.Written[".env"]; written {
		t.Error("the file was written")
	}
	if !strings.Contains(joined(uiMock.MessageCalls), "--force") {
		t.Errorf("no way out offered: %q", uiMock.MessageCalls)
	}
}

func TestRunPushWithDeps_RefusesWhenAKeyLetsItsValueReadAsLines(t *testing.T) {
	// Stored before the server refused such keys: in a file, the lines of these values read as
	// lines of their own, so an edit elsewhere can change how other values read.
	for name, stored := range map[string]map[string]string{
		"line break in a key":           {"K\nL": "1", "A": "x"},
		"comment key, multi-line value": {"#H": "a\nB=1", "A": "x"},
		"key with =, multi-line value":  {"A=B": "a\nC=1", "A": "x"},
		"empty key, multi-line value":   {"": "a\nC=1", "A": "x"},
	} {
		deps, _, _, uiMock, fsMock, envMock, apiMock := NewTestDepsWithEnv()
		fsMock.Files[".env"] = []byte("A=y\n")
		envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
		apiMock.PullResponse = currentServer(stored)

		err := runPushWithDeps(pushOpts(false), deps)

		if err == nil || apiMock.PushCalls != 0 {
			t.Errorf("%s: err %v, %d push(es), want a refusal", name, err, apiMock.PushCalls)
		}
		if !strings.Contains(joined(uiMock.MessageCalls), "dashboard") {
			t.Errorf("%s: no way out offered: %q", name, uiMock.MessageCalls)
		}
	}
}

func TestRunPushWithDeps_AcceptsLegacyKeysThatKeepLinesApart(t *testing.T) {
	// One line each: "#H=a" is a comment, " PADDED" reads as PADDED, "A=B=1" as A.
	deps, _, _, _, fsMock, envMock, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("C=2\n")
	envMock.Candidates = []EnvCandidate{{File: ".env", Env: "development"}}
	apiMock.PullResponse = currentServer(map[string]string{"#H": "a", " PADDED": "two words", "A=B": "1", "C": "1"})
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully"}

	if err := runPushWithDeps(pushOpts(false), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := map[string]string{"C": "2"}; !reflect.DeepEqual(apiMock.PushedSecrets, want) {
		t.Errorf("pushed %q, want %q", apiMock.PushedSecrets, want)
	}
}

func TestRunPullWithDeps_MergeKeepsLocalValuesExactly(t *testing.T) {
	// LOCAL="'x'" holds 'x'; written back as LOCAL='x', it would read as x.
	deps, _, _, _, fsMock, _, apiMock := NewTestDepsWithEnv()
	fsMock.Files[".env"] = []byte("LOCAL=\"'x'\"\n")
	apiMock.PullResponse = currentServer(map[string]string{"A": "1"})

	if err := runPullWithDeps(pullOpts(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, err := env.Parse(string(fsMock.Written[".env"]))
	if err != nil || got["LOCAL"] != "'x'" || got["A"] != "1" {
		t.Errorf("file reads back %q (%v)", got, err)
	}
}
