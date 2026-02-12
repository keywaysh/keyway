package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

const (
	IVLength  = 12
	KeyLength = 32
)

type Engine struct {
	gcm cipher.AEAD
}

// MultiEngine supports multiple encryption keys for key rotation
type MultiEngine struct {
	engines    map[uint32]*Engine
	currentVer uint32
}

// NewMultiEngine creates a multi-key engine from a map of version -> hex key
func NewMultiEngine(keys map[uint32]string) (*MultiEngine, error) {
	if len(keys) == 0 {
		return nil, errors.New("at least one key is required")
	}

	engines := make(map[uint32]*Engine)
	var maxVersion uint32 = 0

	for version, keyHex := range keys {
		engine, err := NewEngine(keyHex)
		if err != nil {
			return nil, fmt.Errorf("failed to create engine for version %d: %w", version, err)
		}
		engines[version] = engine
		if version > maxVersion {
			maxVersion = version
		}
	}

	return &MultiEngine{
		engines:    engines,
		currentVer: maxVersion, // Always encrypt with the highest version
	}, nil
}

// Encrypt encrypts data with the current (highest version) key
func (m *MultiEngine) Encrypt(plaintext []byte) (ciphertext, iv, authTag []byte, version uint32, err error) {
	engine, ok := m.engines[m.currentVer]
	if !ok {
		return nil, nil, nil, 0, fmt.Errorf("no engine for version %d", m.currentVer)
	}

	ciphertext, iv, authTag, err = engine.Encrypt(plaintext)
	if err != nil {
		return nil, nil, nil, 0, err
	}

	return ciphertext, iv, authTag, m.currentVer, nil
}

// Decrypt decrypts data using the specified key version
func (m *MultiEngine) Decrypt(ciphertext, iv, authTag []byte, version uint32) ([]byte, error) {
	engine, ok := m.engines[version]
	if !ok {
		return nil, fmt.Errorf("no key found for version %d", version)
	}

	return engine.Decrypt(ciphertext, iv, authTag)
}

// CurrentVersion returns the current encryption version
func (m *MultiEngine) CurrentVersion() uint32 {
	return m.currentVer
}

// HasVersion checks if a key version is available
func (m *MultiEngine) HasVersion(version uint32) bool {
	_, ok := m.engines[version]
	return ok
}

// AvailableVersions returns all available key versions
func (m *MultiEngine) AvailableVersions() []uint32 {
	versions := make([]uint32, 0, len(m.engines))
	for v := range m.engines {
		versions = append(versions, v)
	}
	return versions
}

func NewEngine(keyHex string) (*Engine, error) {
	keyBytes, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, err
	}
	if len(keyBytes) != KeyLength {
		return nil, errors.New("key must be 32 bytes (64 hex chars)")
	}

	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	return &Engine{gcm: gcm}, nil
}

func (e *Engine) Encrypt(plaintext []byte) (ciphertext, iv, authTag []byte, err error) {
	iv = make([]byte, IVLength)
	if _, err = io.ReadFull(rand.Reader, iv); err != nil {
		return nil, nil, nil, err
	}

	sealed := e.gcm.Seal(nil, iv, plaintext, nil)

	// GCM appends auth tag (16 bytes) to ciphertext
	tagStart := len(sealed) - 16
	ciphertext = sealed[:tagStart]
	authTag = sealed[tagStart:]

	return ciphertext, iv, authTag, nil
}

func (e *Engine) Decrypt(ciphertext, iv, authTag []byte) ([]byte, error) {
	// Validate IV length to prevent panic
	if len(iv) != IVLength {
		return nil, errors.New("invalid IV length")
	}

	// Validate auth tag length
	if len(authTag) == 0 {
		return nil, errors.New("auth tag is required")
	}

	// Reconstruct sealed data (ciphertext + authTag)
	sealed := append(ciphertext, authTag...)

	plaintext, err := e.gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}
