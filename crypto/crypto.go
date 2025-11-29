package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
)

const (
	IVLength  = 12
	KeyLength = 32
)

type Engine struct {
	gcm cipher.AEAD
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
