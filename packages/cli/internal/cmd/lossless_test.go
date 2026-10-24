package cmd

import (
	"reflect"
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
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
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
	if !state.exact || state.empty || !reflect.DeepEqual(state.secrets, exact) {
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
	if state.exact || !reflect.DeepEqual(state.secrets, want) {
		t.Errorf("got %+v, want %q read from the content", state, want)
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
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully", Mode: "merge"}

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
	// An older server ignores modes and replaces: send every secret, read without loss.
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
	if apiMock.PushedMode != api.PushReplace {
		t.Errorf("mode %q, want replace", apiMock.PushedMode)
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
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully", Mode: "merge"}

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
	apiMock.PushResponse = &api.PushSecretsResponse{Message: "Secrets pushed successfully", Mode: "replace"}

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
