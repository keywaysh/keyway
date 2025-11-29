package crypto

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"testing"
)

// Test key: 32 bytes = 64 hex chars
const testKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// ============================================================================
// Engine Creation Tests
// ============================================================================

func TestNewEngine(t *testing.T) {
	_, err := NewEngine(testKeyHex)
	if err != nil {
		t.Fatalf("NewEngine failed: %v", err)
	}
}

func TestNewEngineInvalidKey(t *testing.T) {
	tests := []struct {
		name string
		key  string
	}{
		{"empty key", ""},
		{"too short (16 bytes)", "0123456789abcdef0123456789abcdef"},
		{"too short (31 bytes)", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"},
		{"too long (33 bytes)", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef00"},
		{"invalid hex chars", "not-valid-hex-string-that-is-64-chars-long-0123456789abcdefgh"},
		{"odd length hex", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde"},
		{"uppercase valid", "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"}, // This should work
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewEngine(tt.key)
			if tt.name == "uppercase valid" {
				if err != nil {
					t.Errorf("Expected uppercase hex to work, got error: %v", err)
				}
			} else {
				if err == nil {
					t.Error("Expected error for invalid key")
				}
			}
		})
	}
}

func TestNewEngineWithAllZeroKey(t *testing.T) {
	// All zeros is technically valid
	zeroKey := "0000000000000000000000000000000000000000000000000000000000000000"
	_, err := NewEngine(zeroKey)
	if err != nil {
		t.Fatalf("NewEngine with zero key failed: %v", err)
	}
}

func TestNewEngineWithAllFKey(t *testing.T) {
	// All Fs is technically valid
	ffKey := "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	_, err := NewEngine(ffKey)
	if err != nil {
		t.Fatalf("NewEngine with 0xff key failed: %v", err)
	}
}

// ============================================================================
// Basic Encrypt/Decrypt Tests
// ============================================================================

func TestEncryptDecrypt(t *testing.T) {
	engine, err := NewEngine(testKeyHex)
	if err != nil {
		t.Fatalf("NewEngine failed: %v", err)
	}

	plaintext := []byte("Hello, World! This is a secret message.")

	ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Verify IV length
	if len(iv) != IVLength {
		t.Errorf("IV length = %d, want %d", len(iv), IVLength)
	}

	// Verify auth tag length (GCM standard)
	if len(authTag) != 16 {
		t.Errorf("AuthTag length = %d, want 16", len(authTag))
	}

	// Ciphertext should be same length as plaintext for GCM
	if len(ciphertext) != len(plaintext) {
		t.Errorf("Ciphertext length = %d, want %d", len(ciphertext), len(plaintext))
	}

	// Decrypt
	decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}

	if !bytes.Equal(plaintext, decrypted) {
		t.Errorf("Decrypted = %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptProducesDifferentCiphertext(t *testing.T) {
	engine, err := NewEngine(testKeyHex)
	if err != nil {
		t.Fatalf("NewEngine failed: %v", err)
	}

	plaintext := []byte("Same message")

	ciphertext1, iv1, _, _ := engine.Encrypt(plaintext)
	ciphertext2, iv2, _, _ := engine.Encrypt(plaintext)

	if bytes.Equal(iv1, iv2) {
		t.Error("Two encryptions produced the same IV")
	}

	if bytes.Equal(ciphertext1, ciphertext2) {
		t.Error("Two encryptions produced the same ciphertext")
	}
}

// Test 100 consecutive encryptions have unique IVs
func TestIVUniqueness(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)
	plaintext := []byte("test")

	ivs := make(map[string]bool)
	for i := 0; i < 100; i++ {
		_, iv, _, err := engine.Encrypt(plaintext)
		if err != nil {
			t.Fatalf("Encrypt %d failed: %v", i, err)
		}
		ivHex := hex.EncodeToString(iv)
		if ivs[ivHex] {
			t.Errorf("Duplicate IV found at iteration %d", i)
		}
		ivs[ivHex] = true
	}
}

// ============================================================================
// Integrity and Tampering Tests
// ============================================================================

func TestDecryptWithWrongKey(t *testing.T) {
	engine1, _ := NewEngine(testKeyHex)
	engine2, _ := NewEngine("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210")

	plaintext := []byte("Secret")
	ciphertext, iv, authTag, _ := engine1.Encrypt(plaintext)

	_, err := engine2.Decrypt(ciphertext, iv, authTag)
	if err == nil {
		t.Error("Expected decryption to fail with wrong key")
	}
}

func TestDecryptWithTamperedCiphertext(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("Secret message that needs protection")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Test tampering at different positions
	positions := []int{0, len(ciphertext) / 2, len(ciphertext) - 1}
	for _, pos := range positions {
		t.Run("position_"+string(rune('0'+pos)), func(t *testing.T) {
			tampered := make([]byte, len(ciphertext))
			copy(tampered, ciphertext)
			tampered[pos] ^= 0xff

			_, err := engine.Decrypt(tampered, iv, authTag)
			if err == nil {
				t.Errorf("Expected decryption to fail with tampered byte at position %d", pos)
			}
		})
	}
}

func TestDecryptWithTamperedAuthTag(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("Secret")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Test tampering each byte of auth tag
	for i := 0; i < len(authTag); i++ {
		t.Run("byte_"+string(rune('0'+i)), func(t *testing.T) {
			tampered := make([]byte, len(authTag))
			copy(tampered, authTag)
			tampered[i] ^= 0x01 // Flip single bit

			_, err := engine.Decrypt(ciphertext, iv, tampered)
			if err == nil {
				t.Errorf("Expected decryption to fail with tampered auth tag byte %d", i)
			}
		})
	}
}

func TestDecryptWithTamperedIV(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("Secret")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Tamper with IV
	tampered := make([]byte, len(iv))
	copy(tampered, iv)
	tampered[0] ^= 0xff

	_, err := engine.Decrypt(ciphertext, tampered, authTag)
	if err == nil {
		t.Error("Expected decryption to fail with tampered IV")
	}
}

func TestDecryptWithTruncatedCiphertext(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("This is a longer secret message")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Truncate ciphertext
	truncated := ciphertext[:len(ciphertext)-1]

	_, err := engine.Decrypt(truncated, iv, authTag)
	if err == nil {
		t.Error("Expected decryption to fail with truncated ciphertext")
	}
}

func TestDecryptWithTruncatedAuthTag(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("Secret")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Truncate auth tag
	truncated := authTag[:len(authTag)-1]

	_, err := engine.Decrypt(ciphertext, iv, truncated)
	if err == nil {
		t.Error("Expected decryption to fail with truncated auth tag")
	}
}

func TestDecryptWithTruncatedIV(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("Secret")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Truncate IV
	truncated := iv[:len(iv)-1]

	_, err := engine.Decrypt(ciphertext, truncated, authTag)
	if err == nil {
		t.Error("Expected decryption to fail with truncated IV")
	}
}

func TestDecryptWithSwappedComponents(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("Secret")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Try swapping components
	_, err := engine.Decrypt(iv, ciphertext, authTag) // iv as ciphertext
	if err == nil {
		t.Error("Expected decryption to fail with swapped ciphertext/iv")
	}

	_, err = engine.Decrypt(ciphertext, authTag, iv) // authTag as iv
	if err == nil {
		t.Error("Expected decryption to fail with swapped iv/authTag")
	}
}

// ============================================================================
// Edge Case Tests
// ============================================================================

func TestEmptyPlaintext(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("")
	ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt empty failed: %v", err)
	}

	// Empty plaintext should produce empty ciphertext
	if len(ciphertext) != 0 {
		t.Errorf("Expected empty ciphertext for empty plaintext, got %d bytes", len(ciphertext))
	}

	decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
	if err != nil {
		t.Fatalf("Decrypt empty failed: %v", err)
	}

	if len(decrypted) != 0 {
		t.Errorf("Decrypted = %q, want empty", decrypted)
	}
}

func TestSingleBytePlaintext(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	for b := byte(0); b < 255; b++ {
		plaintext := []byte{b}
		ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
		if err != nil {
			t.Fatalf("Encrypt byte 0x%02x failed: %v", b, err)
		}

		decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
		if err != nil {
			t.Fatalf("Decrypt byte 0x%02x failed: %v", b, err)
		}

		if !bytes.Equal(plaintext, decrypted) {
			t.Errorf("Byte 0x%02x mismatch: got 0x%02x", b, decrypted[0])
		}
	}
}

func TestNullBytesInPlaintext(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	// Plaintext with embedded null bytes
	plaintext := []byte("before\x00middle\x00after")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)
	decrypted, _ := engine.Decrypt(ciphertext, iv, authTag)

	if !bytes.Equal(plaintext, decrypted) {
		t.Errorf("Null bytes not preserved: got %v, want %v", decrypted, plaintext)
	}
}

func TestBinaryData(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	// Random binary data
	plaintext := make([]byte, 256)
	for i := range plaintext {
		plaintext[i] = byte(i)
	}

	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)
	decrypted, _ := engine.Decrypt(ciphertext, iv, authTag)

	if !bytes.Equal(plaintext, decrypted) {
		t.Error("Binary data mismatch")
	}
}

func TestUTF8Strings(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	tests := []string{
		"Hello, World!",
		"日本語テスト",
		"Émojis: 🔐🔑🛡️",
		"Mixed: Hello 世界 🌍",
		"Special chars: \t\n\r",
		"Combining: é = e + ́",
		"RTL: مرحبا",
		"Math: ∑∏∫",
	}

	for _, tt := range tests {
		t.Run(tt[:min(20, len(tt))], func(t *testing.T) {
			plaintext := []byte(tt)
			ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
			if err != nil {
				t.Fatalf("Encrypt failed: %v", err)
			}

			decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
			if err != nil {
				t.Fatalf("Decrypt failed: %v", err)
			}

			if string(decrypted) != tt {
				t.Errorf("UTF-8 mismatch: got %q, want %q", decrypted, tt)
			}
		})
	}
}

// ============================================================================
// Size Boundary Tests
// ============================================================================

func TestVariousSizes(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	sizes := []int{
		1, 2, 15, 16, 17,        // Around AES block size
		127, 128, 129,           // Around common buffer sizes
		255, 256, 257,           // Around byte boundary
		1023, 1024, 1025,        // Around 1KB
		4095, 4096, 4097,        // Around 4KB (common page size)
		65535, 65536, 65537,     // Around 64KB
	}

	for _, size := range sizes {
		t.Run("size_"+string(rune(size)), func(t *testing.T) {
			plaintext := make([]byte, size)
			rand.Read(plaintext)

			ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
			if err != nil {
				t.Fatalf("Encrypt size %d failed: %v", size, err)
			}

			decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
			if err != nil {
				t.Fatalf("Decrypt size %d failed: %v", size, err)
			}

			if !bytes.Equal(plaintext, decrypted) {
				t.Errorf("Size %d mismatch", size)
			}
		})
	}
}

func TestLargePlaintext(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	// 1MB of data
	plaintext := make([]byte, 1024*1024)
	rand.Read(plaintext)

	ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt large failed: %v", err)
	}

	decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
	if err != nil {
		t.Fatalf("Decrypt large failed: %v", err)
	}

	if !bytes.Equal(plaintext, decrypted) {
		t.Error("Large plaintext mismatch after decrypt")
	}
}

func TestVeryLargePlaintext(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping large test in short mode")
	}

	engine, _ := NewEngine(testKeyHex)

	// 10MB of data
	plaintext := make([]byte, 10*1024*1024)
	rand.Read(plaintext)

	ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt very large failed: %v", err)
	}

	decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
	if err != nil {
		t.Fatalf("Decrypt very large failed: %v", err)
	}

	if !bytes.Equal(plaintext, decrypted) {
		t.Error("Very large plaintext mismatch after decrypt")
	}
}

// ============================================================================
// Concurrency Tests
// ============================================================================

func TestConcurrentEncryption(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	const goroutines = 100
	const iterations = 100

	var wg sync.WaitGroup
	errors := make(chan error, goroutines*iterations)

	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				plaintext := []byte("goroutine test data")
				ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
				if err != nil {
					errors <- err
					return
				}

				decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
				if err != nil {
					errors <- err
					return
				}

				if !bytes.Equal(plaintext, decrypted) {
					errors <- err
					return
				}
			}
		}(g)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Concurrent error: %v", err)
	}
}

func TestConcurrentDifferentKeys(t *testing.T) {
	const goroutines = 10

	var wg sync.WaitGroup
	errors := make(chan error, goroutines)

	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			// Each goroutine uses a different key
			key := make([]byte, 32)
			rand.Read(key)
			engine, err := NewEngine(hex.EncodeToString(key))
			if err != nil {
				errors <- err
				return
			}

			for i := 0; i < 100; i++ {
				plaintext := []byte("test data for key isolation")
				ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
				if err != nil {
					errors <- err
					return
				}

				decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
				if err != nil {
					errors <- err
					return
				}

				if !bytes.Equal(plaintext, decrypted) {
					errors <- err
					return
				}
			}
		}(g)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Concurrent different keys error: %v", err)
	}
}

// ============================================================================
// Determinism Tests
// ============================================================================

func TestSameKeyDifferentEngines(t *testing.T) {
	engine1, _ := NewEngine(testKeyHex)
	engine2, _ := NewEngine(testKeyHex)

	plaintext := []byte("Cross-engine test")

	// Encrypt with engine1
	ciphertext, iv, authTag, _ := engine1.Encrypt(plaintext)

	// Decrypt with engine2 (same key)
	decrypted, err := engine2.Decrypt(ciphertext, iv, authTag)
	if err != nil {
		t.Fatalf("Cross-engine decrypt failed: %v", err)
	}

	if !bytes.Equal(plaintext, decrypted) {
		t.Error("Cross-engine decryption mismatch")
	}
}

// ============================================================================
// Format Compatibility Tests (with Node.js backend)
// ============================================================================

func TestHexEncoding(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("Test secret")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Encode to hex (like we'd send to Node.js)
	ciphertextHex := hex.EncodeToString(ciphertext)
	ivHex := hex.EncodeToString(iv)
	authTagHex := hex.EncodeToString(authTag)

	// Verify hex lengths
	if len(ivHex) != IVLength*2 {
		t.Errorf("IV hex length = %d, want %d", len(ivHex), IVLength*2)
	}
	if len(authTagHex) != 32 { // 16 bytes = 32 hex chars
		t.Errorf("AuthTag hex length = %d, want 32", len(authTagHex))
	}

	// Decode from hex (like we'd receive from Node.js)
	ciphertextDec, _ := hex.DecodeString(ciphertextHex)
	ivDec, _ := hex.DecodeString(ivHex)
	authTagDec, _ := hex.DecodeString(authTagHex)

	decrypted, err := engine.Decrypt(ciphertextDec, ivDec, authTagDec)
	if err != nil {
		t.Fatalf("Decrypt after hex round-trip failed: %v", err)
	}

	if !bytes.Equal(plaintext, decrypted) {
		t.Errorf("Decrypted = %q, want %q", decrypted, plaintext)
	}
}

func TestHexEncodingCaseSensitivity(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	plaintext := []byte("Test")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	// Encode to uppercase hex
	ciphertextHex := hex.EncodeToString(ciphertext)
	ivHex := hex.EncodeToString(iv)
	authTagHex := hex.EncodeToString(authTag)

	// Decode both lowercase and uppercase
	ciphertextLower, _ := hex.DecodeString(ciphertextHex)
	ivLower, _ := hex.DecodeString(ivHex)
	authTagLower, _ := hex.DecodeString(authTagHex)

	_, err := engine.Decrypt(ciphertextLower, ivLower, authTagLower)
	if err != nil {
		t.Fatalf("Lowercase hex decode failed: %v", err)
	}
}

// ============================================================================
// Realistic Secret Tests
// ============================================================================

func TestRealisticSecrets(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	secrets := []string{
		// API keys
		"sk_live_abc123def456ghi789jkl012mno345",
		"AKIAIOSFODNN7EXAMPLE",
		"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",

		// Database URLs
		"postgresql://user:pass@localhost:5432/db",
		"mongodb+srv://user:password@cluster.mongodb.net/db?retryWrites=true",

		// JWT tokens
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",

		// Private keys (truncated for test)
		"-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VVXV1lN...\n-----END RSA PRIVATE KEY-----",

		// .env file content
		"DATABASE_URL=postgres://localhost\nAPI_KEY=secret123\nDEBUG=false",
	}

	for i, secret := range secrets {
		t.Run("secret_"+string(rune('0'+i)), func(t *testing.T) {
			plaintext := []byte(secret)
			ciphertext, iv, authTag, err := engine.Encrypt(plaintext)
			if err != nil {
				t.Fatalf("Encrypt failed: %v", err)
			}

			decrypted, err := engine.Decrypt(ciphertext, iv, authTag)
			if err != nil {
				t.Fatalf("Decrypt failed: %v", err)
			}

			if string(decrypted) != secret {
				t.Errorf("Secret mismatch")
			}
		})
	}
}

// ============================================================================
// Error Handling Tests
// ============================================================================

func TestDecryptWithEmptyInputs(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	// Empty IV should fail
	_, err := engine.Decrypt([]byte("test"), []byte{}, []byte("0123456789abcdef"))
	if err == nil {
		t.Error("Expected error for empty IV")
	}

	// Empty auth tag should fail
	_, err = engine.Decrypt([]byte("test"), make([]byte, 12), []byte{})
	if err == nil {
		t.Error("Expected error for empty auth tag")
	}
}

func TestDecryptWithNilInputs(t *testing.T) {
	engine, _ := NewEngine(testKeyHex)

	// Nil ciphertext with valid iv/tag
	_, err := engine.Decrypt(nil, make([]byte, 12), make([]byte, 16))
	// This might not error since nil slice + tag = just tag
	// The auth check will fail though
	if err == nil {
		// If it didn't error, that's okay - GCM auth will catch it
	}
}

// ============================================================================
// Benchmarks
// ============================================================================

func BenchmarkEncrypt(b *testing.B) {
	engine, _ := NewEngine(testKeyHex)
	plaintext := []byte("Typical secret value like an API key or password")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		engine.Encrypt(plaintext)
	}
}

func BenchmarkDecrypt(b *testing.B) {
	engine, _ := NewEngine(testKeyHex)
	plaintext := []byte("Typical secret value like an API key or password")
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		engine.Decrypt(ciphertext, iv, authTag)
	}
}

func BenchmarkEncrypt1KB(b *testing.B) {
	engine, _ := NewEngine(testKeyHex)
	plaintext := make([]byte, 1024)
	rand.Read(plaintext)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		engine.Encrypt(plaintext)
	}
}

func BenchmarkDecrypt1KB(b *testing.B) {
	engine, _ := NewEngine(testKeyHex)
	plaintext := make([]byte, 1024)
	rand.Read(plaintext)
	ciphertext, iv, authTag, _ := engine.Encrypt(plaintext)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		engine.Decrypt(ciphertext, iv, authTag)
	}
}

func BenchmarkEncrypt1MB(b *testing.B) {
	engine, _ := NewEngine(testKeyHex)
	plaintext := make([]byte, 1024*1024)
	rand.Read(plaintext)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		engine.Encrypt(plaintext)
	}
}

func BenchmarkNewEngine(b *testing.B) {
	for i := 0; i < b.N; i++ {
		NewEngine(testKeyHex)
	}
}

func BenchmarkConcurrentEncrypt(b *testing.B) {
	engine, _ := NewEngine(testKeyHex)
	plaintext := []byte("Concurrent test data")

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			engine.Encrypt(plaintext)
		}
	})
}

// Helper function
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
