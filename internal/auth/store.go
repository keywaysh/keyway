package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// StoredAuth represents the stored authentication data
type StoredAuth struct {
	KeywayToken string `json:"keywayToken"`
	GitHubLogin string `json:"githubLogin,omitempty"`
	ExpiresAt   string `json:"expiresAt,omitempty"`
	CreatedAt   string `json:"createdAt"`
}

// Store handles authentication storage
type Store struct {
	configPath string
	keyPath    string
}

// NewStore creates a new auth store
// Uses the same paths as the Node.js CLI for compatibility
func NewStore() *Store {
	homeDir, _ := os.UserHomeDir()

	// Match Node.js conf package paths for compatibility
	var configDir string
	switch runtime.GOOS {
	case "darwin":
		configDir = filepath.Join(homeDir, "Library", "Preferences", "keyway-nodejs")
	case "windows":
		configDir = filepath.Join(os.Getenv("APPDATA"), "keyway-nodejs", "Config")
	default: // linux and others
		configDir = filepath.Join(homeDir, ".config", "keyway-nodejs")
	}

	return &Store{
		configPath: filepath.Join(configDir, "config.json"),
		keyPath:    filepath.Join(homeDir, ".keyway", ".key"),
	}
}

// GetAuth retrieves stored authentication
func (s *Store) GetAuth() (*StoredAuth, error) {
	// Read config file
	data, err := os.ReadFile(s.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var config map[string]string
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	encryptedAuth, ok := config["auth"]
	if !ok || encryptedAuth == "" {
		return nil, nil
	}

	// Decrypt
	decrypted, err := s.decrypt(encryptedAuth)
	if err != nil {
		// Corrupted data, clear it
		s.ClearAuth()
		return nil, nil
	}

	var auth StoredAuth
	if err := json.Unmarshal([]byte(decrypted), &auth); err != nil {
		return nil, err
	}

	// Check expiration
	if auth.ExpiresAt != "" {
		expires, err := time.Parse(time.RFC3339, auth.ExpiresAt)
		if err == nil && time.Now().After(expires) {
			s.ClearAuth()
			return nil, nil
		}
	}

	return &auth, nil
}

// SaveAuth stores authentication data
func (s *Store) SaveAuth(token, githubLogin, expiresAt string) error {
	auth := StoredAuth{
		KeywayToken: token,
		GitHubLogin: githubLogin,
		ExpiresAt:   expiresAt,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	authJSON, err := json.Marshal(auth)
	if err != nil {
		return err
	}

	encrypted, err := s.encrypt(string(authJSON))
	if err != nil {
		return err
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(s.configPath), 0700); err != nil {
		return err
	}

	config := map[string]string{"auth": encrypted}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.configPath, data, 0600)
}

// ClearAuth removes stored authentication
func (s *Store) ClearAuth() error {
	if _, err := os.Stat(s.configPath); os.IsNotExist(err) {
		return nil
	}

	config := map[string]string{}
	data, _ := json.MarshalIndent(config, "", "  ")
	return os.WriteFile(s.configPath, data, 0600)
}

// GetConfigPath returns the path to the config file
func (s *Store) GetConfigPath() string {
	return s.configPath
}

// getOrCreateKey gets or creates the encryption key
func (s *Store) getOrCreateKey() ([]byte, error) {
	// Try to read existing key
	keyHex, err := os.ReadFile(s.keyPath)
	if err == nil && len(strings.TrimSpace(string(keyHex))) == 64 {
		return hex.DecodeString(strings.TrimSpace(string(keyHex)))
	}

	// Generate new key (32 bytes = 256 bits)
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(s.keyPath), 0700); err != nil {
		return nil, err
	}

	// Save key
	if err := os.WriteFile(s.keyPath, []byte(hex.EncodeToString(key)), 0600); err != nil {
		return nil, err
	}

	return key, nil
}

// encrypt encrypts plaintext using AES-256-GCM
// Format: iv:authTag:encrypted (hex encoded) - compatible with Node.js CLI
func (s *Store) encrypt(plaintext string) (string, error) {
	key, err := s.getOrCreateKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// Generate random IV
	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}

	// Encrypt
	ciphertext := gcm.Seal(nil, iv, []byte(plaintext), nil)

	// GCM appends auth tag to ciphertext, we need to split it
	// for compatibility with Node.js format
	tagSize := gcm.Overhead()
	authTag := ciphertext[len(ciphertext)-tagSize:]
	encrypted := ciphertext[:len(ciphertext)-tagSize]

	return fmt.Sprintf("%s:%s:%s",
		hex.EncodeToString(iv),
		hex.EncodeToString(authTag),
		hex.EncodeToString(encrypted),
	), nil
}

// decrypt decrypts ciphertext using AES-256-GCM
// Expects format: iv:authTag:encrypted (hex encoded)
func (s *Store) decrypt(data string) (string, error) {
	parts := strings.Split(data, ":")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid encrypted data format")
	}

	iv, err := hex.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("invalid IV: %w", err)
	}

	authTag, err := hex.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("invalid auth tag: %w", err)
	}

	encrypted, err := hex.DecodeString(parts[2])
	if err != nil {
		return "", fmt.Errorf("invalid ciphertext: %w", err)
	}

	key, err := s.getOrCreateKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// Validate IV length to prevent panic
	if len(iv) != gcm.NonceSize() {
		return "", fmt.Errorf("invalid IV length: got %d, expected %d", len(iv), gcm.NonceSize())
	}

	// Reconstruct ciphertext with auth tag (GCM expects tag at end)
	ciphertext := append(encrypted, authTag...)

	plaintext, err := gcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed: %w", err)
	}

	return string(plaintext), nil
}
