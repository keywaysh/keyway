package env

import "sort"

// PushDiff represents the difference between local and vault secrets for a push operation.
type PushDiff struct {
	Added   []string // in local, not in vault (will be created)
	Changed []string // in both, different values (will be updated)
	Removed []string // in vault, not in local (will be deleted)
}

// HasChanges returns true if there are any differences.
func (d *PushDiff) HasChanges() bool {
	return len(d.Added) > 0 || len(d.Changed) > 0 || len(d.Removed) > 0
}

// CalculatePushDiff calculates the differences between local and vault secrets for pushing.
func CalculatePushDiff(local, vault map[string]string) *PushDiff {
	diff := &PushDiff{}

	// Check local secrets against vault
	for key, localVal := range local {
		if vaultVal, exists := vault[key]; exists {
			if localVal != vaultVal {
				diff.Changed = append(diff.Changed, key)
			}
		} else {
			diff.Added = append(diff.Added, key)
		}
	}

	// Find vault-only secrets (will be removed)
	for key := range vault {
		if _, exists := local[key]; !exists {
			diff.Removed = append(diff.Removed, key)
		}
	}

	// Sort for deterministic output
	sort.Strings(diff.Added)
	sort.Strings(diff.Changed)
	sort.Strings(diff.Removed)

	return diff
}

// PullDiff represents the difference between local and vault secrets for a pull operation.
type PullDiff struct {
	Added     []string // in vault, not in local
	Changed   []string // in both, different values
	LocalOnly []string // in local, not in vault
	Unchanged []string // in both, same values
}

// HasChanges returns true if there are any differences.
func (d *PullDiff) HasChanges() bool {
	return len(d.Added) > 0 || len(d.Changed) > 0 || len(d.LocalOnly) > 0
}

// CalculatePullDiff calculates the differences between local and vault secrets for pulling.
func CalculatePullDiff(local, vault map[string]string) *PullDiff {
	diff := &PullDiff{}

	// Check vault secrets against local
	for key, vaultVal := range vault {
		if localVal, exists := local[key]; exists {
			if localVal != vaultVal {
				diff.Changed = append(diff.Changed, key)
			} else {
				diff.Unchanged = append(diff.Unchanged, key)
			}
		} else {
			diff.Added = append(diff.Added, key)
		}
	}

	// Find local-only secrets
	for key := range local {
		if _, exists := vault[key]; !exists {
			diff.LocalOnly = append(diff.LocalOnly, key)
		}
	}

	// Sort for deterministic output
	sort.Strings(diff.Added)
	sort.Strings(diff.Changed)
	sort.Strings(diff.LocalOnly)
	sort.Strings(diff.Unchanged)

	return diff
}
