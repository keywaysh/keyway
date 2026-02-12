package env

import (
	"testing"
)

func TestCalculatePushDiff_AllNew(t *testing.T) {
	local := map[string]string{"A": "1", "B": "2"}
	vault := map[string]string{}

	diff := CalculatePushDiff(local, vault)

	if len(diff.Added) != 2 {
		t.Errorf("expected 2 added, got %d", len(diff.Added))
	}
	if len(diff.Changed) != 0 {
		t.Errorf("expected 0 changed, got %d", len(diff.Changed))
	}
	if len(diff.Removed) != 0 {
		t.Errorf("expected 0 removed, got %d", len(diff.Removed))
	}
}

func TestCalculatePushDiff_AllRemoved(t *testing.T) {
	local := map[string]string{}
	vault := map[string]string{"A": "1", "B": "2"}

	diff := CalculatePushDiff(local, vault)

	if len(diff.Added) != 0 {
		t.Errorf("expected 0 added, got %d", len(diff.Added))
	}
	if len(diff.Removed) != 2 {
		t.Errorf("expected 2 removed, got %d", len(diff.Removed))
	}
}

func TestCalculatePushDiff_Changed(t *testing.T) {
	local := map[string]string{"A": "new_value"}
	vault := map[string]string{"A": "old_value"}

	diff := CalculatePushDiff(local, vault)

	if len(diff.Changed) != 1 {
		t.Errorf("expected 1 changed, got %d", len(diff.Changed))
	}
	if diff.Changed[0] != "A" {
		t.Errorf("expected A to be changed, got %v", diff.Changed)
	}
}

func TestCalculatePushDiff_Mixed(t *testing.T) {
	local := map[string]string{"A": "1", "B": "new", "C": "3"}
	vault := map[string]string{"B": "old", "D": "4"}

	diff := CalculatePushDiff(local, vault)

	// A and C are new (local only)
	if len(diff.Added) != 2 {
		t.Errorf("expected 2 added, got %d: %v", len(diff.Added), diff.Added)
	}
	// B is changed
	if len(diff.Changed) != 1 {
		t.Errorf("expected 1 changed, got %d", len(diff.Changed))
	}
	// D is removed (vault only)
	if len(diff.Removed) != 1 {
		t.Errorf("expected 1 removed, got %d", len(diff.Removed))
	}
}

func TestCalculatePushDiff_NoChanges(t *testing.T) {
	secrets := map[string]string{"A": "1", "B": "2"}

	diff := CalculatePushDiff(secrets, secrets)

	if diff.HasChanges() {
		t.Error("expected no changes when local == vault")
	}
}

func TestCalculatePushDiff_Sorted(t *testing.T) {
	local := map[string]string{"Z": "1", "A": "2", "M": "3"}
	vault := map[string]string{}

	diff := CalculatePushDiff(local, vault)

	// Should be sorted alphabetically
	if diff.Added[0] != "A" || diff.Added[1] != "M" || diff.Added[2] != "Z" {
		t.Errorf("expected sorted order [A, M, Z], got %v", diff.Added)
	}
}

func TestPushDiff_HasChanges(t *testing.T) {
	tests := []struct {
		name string
		diff PushDiff
		want bool
	}{
		{"empty", PushDiff{}, false},
		{"added only", PushDiff{Added: []string{"A"}}, true},
		{"changed only", PushDiff{Changed: []string{"B"}}, true},
		{"removed only", PushDiff{Removed: []string{"C"}}, true},
		{"all types", PushDiff{Added: []string{"A"}, Changed: []string{"B"}, Removed: []string{"C"}}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.diff.HasChanges(); got != tt.want {
				t.Errorf("HasChanges() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCalculatePullDiff_AllNew(t *testing.T) {
	local := map[string]string{}
	vault := map[string]string{"A": "1", "B": "2"}

	diff := CalculatePullDiff(local, vault)

	if len(diff.Added) != 2 {
		t.Errorf("expected 2 added (from vault), got %d", len(diff.Added))
	}
	if len(diff.LocalOnly) != 0 {
		t.Errorf("expected 0 local-only, got %d", len(diff.LocalOnly))
	}
}

func TestCalculatePullDiff_LocalOnly(t *testing.T) {
	local := map[string]string{"LOCAL": "secret"}
	vault := map[string]string{"A": "1"}

	diff := CalculatePullDiff(local, vault)

	if len(diff.LocalOnly) != 1 {
		t.Errorf("expected 1 local-only, got %d", len(diff.LocalOnly))
	}
	if diff.LocalOnly[0] != "LOCAL" {
		t.Errorf("expected LOCAL to be local-only, got %v", diff.LocalOnly)
	}
}

func TestCalculatePullDiff_Changed(t *testing.T) {
	local := map[string]string{"A": "old"}
	vault := map[string]string{"A": "new"}

	diff := CalculatePullDiff(local, vault)

	if len(diff.Changed) != 1 {
		t.Errorf("expected 1 changed, got %d", len(diff.Changed))
	}
}

func TestCalculatePullDiff_Unchanged(t *testing.T) {
	secrets := map[string]string{"A": "1", "B": "2"}

	diff := CalculatePullDiff(secrets, secrets)

	if len(diff.Unchanged) != 2 {
		t.Errorf("expected 2 unchanged, got %d", len(diff.Unchanged))
	}
	if diff.HasChanges() {
		t.Error("expected no changes when local == vault")
	}
}

func TestCalculatePullDiff_Mixed(t *testing.T) {
	local := map[string]string{"A": "old", "LOCAL": "secret"}
	vault := map[string]string{"A": "new", "B": "2"}

	diff := CalculatePullDiff(local, vault)

	// B is new from vault
	if len(diff.Added) != 1 || diff.Added[0] != "B" {
		t.Errorf("expected [B] added, got %v", diff.Added)
	}
	// A is changed
	if len(diff.Changed) != 1 || diff.Changed[0] != "A" {
		t.Errorf("expected [A] changed, got %v", diff.Changed)
	}
	// LOCAL is local-only
	if len(diff.LocalOnly) != 1 || diff.LocalOnly[0] != "LOCAL" {
		t.Errorf("expected [LOCAL] local-only, got %v", diff.LocalOnly)
	}
}

func TestCalculatePullDiff_Sorted(t *testing.T) {
	local := map[string]string{}
	vault := map[string]string{"Z": "1", "A": "2", "M": "3"}

	diff := CalculatePullDiff(local, vault)

	if diff.Added[0] != "A" || diff.Added[1] != "M" || diff.Added[2] != "Z" {
		t.Errorf("expected sorted order [A, M, Z], got %v", diff.Added)
	}
}

func TestPullDiff_HasChanges(t *testing.T) {
	tests := []struct {
		name string
		diff PullDiff
		want bool
	}{
		{"empty", PullDiff{}, false},
		{"unchanged only", PullDiff{Unchanged: []string{"A"}}, false},
		{"added", PullDiff{Added: []string{"A"}}, true},
		{"changed", PullDiff{Changed: []string{"B"}}, true},
		{"local-only", PullDiff{LocalOnly: []string{"C"}}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.diff.HasChanges(); got != tt.want {
				t.Errorf("HasChanges() = %v, want %v", got, tt.want)
			}
		})
	}
}
