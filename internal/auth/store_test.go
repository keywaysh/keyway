package auth

import (
	"os"
	"path/filepath"
	"testing"
)

// Helper to create a test store with temp directories
func newTestStore(t *testing.T) (*Store, func()) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "keyway-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	store := &Store{
		configPath: filepath.Join(tmpDir, "config.json"),
		keyPath:    filepath.Join(tmpDir, ".key"),
	}

	cleanup := func() {
		os.RemoveAll(tmpDir)
	}

	return store, cleanup
}

func TestNewStore(t *testing.T) {
	store := NewStore()
	if store == nil {
		t.Fatal("NewStore returned nil")
	}
	if store.configPath == "" {
		t.Error("configPath is empty")
	}
	if store.keyPath == "" {
		t.Error("keyPath is empty")
	}
}

func TestStore_SaveAndGetAuth(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Save auth
	err := store.SaveAuth("test-token-123", "testuser", "")
	if err != nil {
		t.Fatalf("SaveAuth failed: %v", err)
	}

	// Get auth back
	retrieved, err := store.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth failed: %v", err)
	}

	if retrieved == nil {
		t.Fatal("retrieved auth is nil")
	}
	if retrieved.KeywayToken != "test-token-123" {
		t.Errorf("expected token 'test-token-123', got '%s'", retrieved.KeywayToken)
	}
	if retrieved.GitHubLogin != "testuser" {
		t.Errorf("expected login 'testuser', got '%s'", retrieved.GitHubLogin)
	}
}

func TestStore_GetAuth_NotLoggedIn(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	auth, err := store.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth should not error for missing auth: %v", err)
	}
	if auth != nil {
		t.Error("expected nil auth for non-existent config")
	}
}

func TestStore_ClearAuth(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Save auth first
	err := store.SaveAuth("token-to-clear", "user", "")
	if err != nil {
		t.Fatalf("SaveAuth failed: %v", err)
	}

	// Clear auth
	err = store.ClearAuth()
	if err != nil {
		t.Fatalf("ClearAuth failed: %v", err)
	}

	// Verify it's cleared
	retrieved, err := store.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth failed after clear: %v", err)
	}
	if retrieved != nil {
		t.Error("expected nil auth after clear")
	}
}

func TestStore_ClearAuth_NoExistingAuth(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Clear auth when none exists should not error
	err := store.ClearAuth()
	if err != nil {
		t.Errorf("ClearAuth should not error when no auth exists: %v", err)
	}
}

func TestStore_EncryptionKeyPersistence(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "keyway-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	configPath := filepath.Join(tmpDir, "config.json")
	keyPath := filepath.Join(tmpDir, ".key")

	store1 := &Store{
		configPath: configPath,
		keyPath:    keyPath,
	}

	// Save auth - this creates the encryption key
	err = store1.SaveAuth("test-token", "user", "")
	if err != nil {
		t.Fatalf("SaveAuth failed: %v", err)
	}

	// Create a new store instance (simulates app restart)
	store2 := &Store{
		configPath: configPath,
		keyPath:    keyPath,
	}

	// Should be able to read the auth with the same key
	retrieved, err := store2.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth with new store failed: %v", err)
	}
	if retrieved.KeywayToken != "test-token" {
		t.Errorf("expected token 'test-token', got '%s'", retrieved.KeywayToken)
	}
}

func TestStore_CorruptedConfig(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Create corrupted config file
	err := os.MkdirAll(filepath.Dir(store.configPath), 0700)
	if err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	err = os.WriteFile(store.configPath, []byte("not valid json"), 0600)
	if err != nil {
		t.Fatalf("failed to write corrupted config: %v", err)
	}

	_, err = store.GetAuth()
	if err == nil {
		t.Error("expected error for corrupted config")
	}
}

func TestStore_EmptyToken(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	err := store.SaveAuth("", "user", "")
	if err != nil {
		t.Fatalf("SaveAuth with empty token failed: %v", err)
	}

	retrieved, err := store.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth failed: %v", err)
	}
	if retrieved.KeywayToken != "" {
		t.Errorf("expected empty token, got '%s'", retrieved.KeywayToken)
	}
}

func TestStore_LongToken(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Create a very long token
	longToken := ""
	for i := 0; i < 1000; i++ {
		longToken += "abcdefghij"
	}

	err := store.SaveAuth(longToken, "user", "")
	if err != nil {
		t.Fatalf("SaveAuth with long token failed: %v", err)
	}

	retrieved, err := store.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth failed: %v", err)
	}
	if retrieved.KeywayToken != longToken {
		t.Error("long token not preserved correctly")
	}
}

func TestStore_SpecialCharactersInToken(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	specialToken := "token-with-special-chars-!@#$%^&*()_+-=[]{}|;':\",./<>?`~"

	err := store.SaveAuth(specialToken, "user-with-dashes", "")
	if err != nil {
		t.Fatalf("SaveAuth with special chars failed: %v", err)
	}

	retrieved, err := store.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth failed: %v", err)
	}
	if retrieved.KeywayToken != specialToken {
		t.Errorf("special chars not preserved: expected '%s', got '%s'", specialToken, retrieved.KeywayToken)
	}
}

func TestStore_UnicodeInLogin(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	err := store.SaveAuth("token123", "用户名", "") // Chinese characters
	if err != nil {
		t.Fatalf("SaveAuth with unicode failed: %v", err)
	}

	retrieved, err := store.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth failed: %v", err)
	}
	if retrieved.GitHubLogin != "用户名" {
		t.Errorf("unicode not preserved: expected '用户名', got '%s'", retrieved.GitHubLogin)
	}
}

func TestStore_OverwriteExistingAuth(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Save first auth
	err := store.SaveAuth("token1", "user1", "")
	if err != nil {
		t.Fatalf("SaveAuth 1 failed: %v", err)
	}

	// Save second auth (overwrite)
	err = store.SaveAuth("token2", "user2", "")
	if err != nil {
		t.Fatalf("SaveAuth 2 failed: %v", err)
	}

	// Should get the second auth
	retrieved, err := store.GetAuth()
	if err != nil {
		t.Fatalf("GetAuth failed: %v", err)
	}
	if retrieved.KeywayToken != "token2" {
		t.Errorf("expected token2, got '%s'", retrieved.KeywayToken)
	}
	if retrieved.GitHubLogin != "user2" {
		t.Errorf("expected user2, got '%s'", retrieved.GitHubLogin)
	}
}

func TestStore_GetConfigPath(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	path := store.GetConfigPath()
	if path == "" {
		t.Error("GetConfigPath returned empty string")
	}
	if path != store.configPath {
		t.Errorf("GetConfigPath returned wrong path: got %s, want %s", path, store.configPath)
	}
}

func TestStore_InvalidIVLength(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// First, save valid auth to create the key
	err := store.SaveAuth("test-token", "user", "")
	if err != nil {
		t.Fatalf("SaveAuth failed: %v", err)
	}

	// Now corrupt the config with invalid IV (too short)
	// Format is iv:authTag:encrypted (all hex encoded)
	corruptedAuth := `{"auth": "0102030405:0102030405060708091011121314151617:0102030405060708"}`
	err = os.WriteFile(store.configPath, []byte(corruptedAuth), 0600)
	if err != nil {
		t.Fatalf("failed to write corrupted config: %v", err)
	}

	// GetAuth should handle this gracefully (not panic)
	auth, err := store.GetAuth()
	if err != nil {
		t.Errorf("GetAuth should not return error, got: %v", err)
	}
	if auth != nil {
		t.Error("expected nil auth for corrupted data")
	}
}

func TestStore_InvalidEncryptedDataFormat(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Create key first
	err := store.SaveAuth("test-token", "user", "")
	if err != nil {
		t.Fatalf("SaveAuth failed: %v", err)
	}

	tests := []struct {
		name string
		auth string
	}{
		{"no colons", `{"auth": "notvalidformat"}`},
		{"one colon", `{"auth": "aa:bb"}`},
		{"invalid hex in iv", `{"auth": "ZZZZ:0102030405060708091011121314151617:0102030405"}`},
		{"invalid hex in tag", `{"auth": "010203040506070809101112:ZZZZ:0102030405"}`},
		{"invalid hex in data", `{"auth": "010203040506070809101112:0102030405060708091011121314151617:ZZZZ"}`},
		{"empty string", `{"auth": ""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err = os.WriteFile(store.configPath, []byte(tt.auth), 0600)
			if err != nil {
				t.Fatalf("failed to write config: %v", err)
			}

			// Should not panic
			auth, err := store.GetAuth()
			if err != nil {
				t.Logf("GetAuth returned error (expected): %v", err)
			}
			if auth != nil {
				t.Error("expected nil auth for invalid data")
			}
		})
	}
}

func TestStore_WrongEncryptionKey(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Save auth with one key
	err := store.SaveAuth("test-token", "user", "")
	if err != nil {
		t.Fatalf("SaveAuth failed: %v", err)
	}

	// Replace the key with a different one
	newKey := "0102030405060708091011121314151617181920212223242526272829303132"
	err = os.WriteFile(store.keyPath, []byte(newKey), 0600)
	if err != nil {
		t.Fatalf("failed to write new key: %v", err)
	}

	// GetAuth should handle decryption failure gracefully
	auth, err := store.GetAuth()
	if err != nil {
		t.Errorf("GetAuth should not return error, got: %v", err)
	}
	if auth != nil {
		t.Error("expected nil auth when key is wrong")
	}
}

func TestStore_CorruptedEncryptionKey(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Save valid auth first
	err := store.SaveAuth("test-token", "user", "")
	if err != nil {
		t.Fatalf("SaveAuth failed: %v", err)
	}

	// Corrupt the key (invalid hex)
	err = os.WriteFile(store.keyPath, []byte("not-valid-hex-key"), 0600)
	if err != nil {
		t.Fatalf("failed to write corrupted key: %v", err)
	}

	// GetAuth should handle this gracefully
	auth, err := store.GetAuth()
	// This might error or return nil, but should not panic
	if auth != nil {
		t.Error("expected nil auth with corrupted key")
	}
}

func TestStore_TruncatedEncryptionKey(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	// Save valid auth first
	err := store.SaveAuth("test-token", "user", "")
	if err != nil {
		t.Fatalf("SaveAuth failed: %v", err)
	}

	// Truncate the key (too short)
	err = os.WriteFile(store.keyPath, []byte("0102030405"), 0600)
	if err != nil {
		t.Fatalf("failed to write truncated key: %v", err)
	}

	// GetAuth should handle this and generate a new key
	auth, err := store.GetAuth()
	// With a new key, decryption will fail
	if auth != nil {
		t.Error("expected nil auth with truncated key")
	}
}
