package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"testing"

	"keyway-crypto/crypto"
	"keyway-crypto/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

// Valid test key (64 hex chars = 32 bytes)
const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const testKey2 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

// =============================================================================
// parseEncryptionKeys Tests
// =============================================================================

func TestParseEncryptionKeys_SingleKeyFormat(t *testing.T) {
	// Clean up env vars
	os.Unsetenv("ENCRYPTION_KEYS")
	os.Unsetenv("ENCRYPTION_KEY")
	defer func() {
		os.Unsetenv("ENCRYPTION_KEY")
		os.Unsetenv("ENCRYPTION_KEYS")
	}()

	os.Setenv("ENCRYPTION_KEY", testKey)

	keys, err := parseEncryptionKeys()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(keys) != 1 {
		t.Errorf("expected 1 key, got %d", len(keys))
	}

	if keys[1] != testKey {
		t.Errorf("expected key at version 1, got %s", keys[1])
	}
}

func TestParseEncryptionKeys_MultiKeyFormat(t *testing.T) {
	os.Unsetenv("ENCRYPTION_KEY")
	defer os.Unsetenv("ENCRYPTION_KEYS")

	os.Setenv("ENCRYPTION_KEYS", "1:"+testKey+",2:"+testKey2)

	keys, err := parseEncryptionKeys()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(keys) != 2 {
		t.Errorf("expected 2 keys, got %d", len(keys))
	}

	if keys[1] != testKey {
		t.Errorf("expected testKey at version 1")
	}

	if keys[2] != testKey2 {
		t.Errorf("expected testKey2 at version 2")
	}
}

func TestParseEncryptionKeys_MultiKeyPriority(t *testing.T) {
	// ENCRYPTION_KEYS should take priority over ENCRYPTION_KEY
	defer func() {
		os.Unsetenv("ENCRYPTION_KEY")
		os.Unsetenv("ENCRYPTION_KEYS")
	}()

	os.Setenv("ENCRYPTION_KEY", testKey)
	os.Setenv("ENCRYPTION_KEYS", "5:"+testKey2)

	keys, err := parseEncryptionKeys()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should use ENCRYPTION_KEYS, not ENCRYPTION_KEY
	if len(keys) != 1 {
		t.Errorf("expected 1 key from ENCRYPTION_KEYS, got %d", len(keys))
	}

	if _, ok := keys[5]; !ok {
		t.Error("expected key at version 5 from ENCRYPTION_KEYS")
	}

	if _, ok := keys[1]; ok {
		t.Error("should not have key at version 1 from ENCRYPTION_KEY")
	}
}

func TestParseEncryptionKeys_NoKeysError(t *testing.T) {
	os.Unsetenv("ENCRYPTION_KEY")
	os.Unsetenv("ENCRYPTION_KEYS")

	_, err := parseEncryptionKeys()
	if err == nil {
		t.Fatal("expected error when no keys provided")
	}

	expectedMsg := "ENCRYPTION_KEYS or ENCRYPTION_KEY environment variable is required"
	if err.Error() != expectedMsg {
		t.Errorf("expected error message %q, got %q", expectedMsg, err.Error())
	}
}

func TestParseEncryptionKeys_InvalidFormats(t *testing.T) {
	defer os.Unsetenv("ENCRYPTION_KEYS")
	os.Unsetenv("ENCRYPTION_KEY")

	tests := []struct {
		name     string
		value    string
		errMatch string
	}{
		{
			name:     "missing colon separator",
			value:    "1" + testKey,
			errMatch: "invalid key format",
		},
		{
			name:     "invalid version number",
			value:    "abc:" + testKey,
			errMatch: "invalid version number",
		},
		{
			name:     "negative version",
			value:    "-1:" + testKey,
			errMatch: "invalid version number",
		},
		{
			name:     "version zero reserved",
			value:    "0:" + testKey,
			errMatch: "version 0 is reserved",
		},
		{
			name:     "empty version",
			value:    ":" + testKey,
			errMatch: "invalid version number",
		},
		{
			name:     "floating point version",
			value:    "1.5:" + testKey,
			errMatch: "invalid version number",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Setenv("ENCRYPTION_KEYS", tt.value)

			_, err := parseEncryptionKeys()
			if err == nil {
				t.Fatal("expected error")
			}

			if !strings.Contains(err.Error(), tt.errMatch) {
				t.Errorf("expected error containing %q, got %q", tt.errMatch, err.Error())
			}
		})
	}
}

func TestParseEncryptionKeys_WhitespaceHandling(t *testing.T) {
	defer os.Unsetenv("ENCRYPTION_KEYS")
	os.Unsetenv("ENCRYPTION_KEY")

	// Test with whitespace around pairs and parts
	os.Setenv("ENCRYPTION_KEYS", " 1 : "+testKey+" , 2 : "+testKey2+" ")

	keys, err := parseEncryptionKeys()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(keys) != 2 {
		t.Errorf("expected 2 keys, got %d", len(keys))
	}

	if keys[1] != testKey {
		t.Errorf("whitespace not trimmed correctly for version 1")
	}

	if keys[2] != testKey2 {
		t.Errorf("whitespace not trimmed correctly for version 2")
	}
}

func TestParseEncryptionKeys_LargeVersionNumbers(t *testing.T) {
	defer os.Unsetenv("ENCRYPTION_KEYS")
	os.Unsetenv("ENCRYPTION_KEY")

	// Test with large but valid version numbers
	os.Setenv("ENCRYPTION_KEYS", "4294967295:"+testKey) // Max uint32

	keys, err := parseEncryptionKeys()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, ok := keys[4294967295]; !ok {
		t.Error("expected key at max uint32 version")
	}
}

func TestParseEncryptionKeys_OverflowVersion(t *testing.T) {
	defer os.Unsetenv("ENCRYPTION_KEYS")
	os.Unsetenv("ENCRYPTION_KEY")

	// Test with version number that overflows uint32
	os.Setenv("ENCRYPTION_KEYS", "4294967296:"+testKey) // Max uint32 + 1

	_, err := parseEncryptionKeys()
	if err == nil {
		t.Fatal("expected error for overflow version")
	}
}

func TestParseEncryptionKeys_DuplicateVersions(t *testing.T) {
	defer os.Unsetenv("ENCRYPTION_KEYS")
	os.Unsetenv("ENCRYPTION_KEY")

	// Last value wins (map behavior)
	os.Setenv("ENCRYPTION_KEYS", "1:"+testKey+",1:"+testKey2)

	keys, err := parseEncryptionKeys()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(keys) != 1 {
		t.Errorf("expected 1 key (last wins), got %d", len(keys))
	}

	if keys[1] != testKey2 {
		t.Error("expected last duplicate to win")
	}
}

// =============================================================================
// gRPC Integration Tests
// =============================================================================

const bufSize = 1024 * 1024

func setupTestServer(t *testing.T, keys map[uint32]string) (pb.CryptoServiceClient, func()) {
	t.Helper()

	engine, err := crypto.NewMultiEngine(keys)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	lis := bufconn.Listen(bufSize)
	s := grpc.NewServer()
	pb.RegisterCryptoServiceServer(s, &server{engine: engine})

	go func() {
		if err := s.Serve(lis); err != nil {
			// Server stopped, this is expected during cleanup
		}
	}()

	dialer := func(context.Context, string) (net.Conn, error) {
		return lis.Dial()
	}

	conn, err := grpc.NewClient("passthrough://bufnet",
		grpc.WithContextDialer(dialer),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("failed to dial: %v", err)
	}

	client := pb.NewCryptoServiceClient(conn)

	cleanup := func() {
		conn.Close()
		s.Stop()
	}

	return client, cleanup
}

func TestGRPC_HealthCheck(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	resp, err := client.HealthCheck(context.Background(), &pb.Empty{})
	if err != nil {
		t.Fatalf("HealthCheck failed: %v", err)
	}

	if !resp.Healthy {
		t.Error("expected healthy=true")
	}

	if resp.Version == "" {
		t.Error("expected non-empty version")
	}

	if resp.Version != version {
		t.Errorf("expected version %q, got %q", version, resp.Version)
	}
}

func TestGRPC_EncryptDecrypt_RoundTrip(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	plaintext := []byte("Hello, Keyway!")

	// Encrypt
	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	if len(encResp.Ciphertext) == 0 {
		t.Error("expected non-empty ciphertext")
	}

	if len(encResp.Iv) != 12 {
		t.Errorf("expected 12-byte IV, got %d", len(encResp.Iv))
	}

	if len(encResp.AuthTag) != 16 {
		t.Errorf("expected 16-byte auth tag, got %d", len(encResp.AuthTag))
	}

	if encResp.Version != 1 {
		t.Errorf("expected version 1, got %d", encResp.Version)
	}

	// Decrypt
	decResp, err := client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    encResp.Version,
	})
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}

	if string(decResp.Plaintext) != string(plaintext) {
		t.Errorf("expected plaintext %q, got %q", plaintext, decResp.Plaintext)
	}
}

func TestGRPC_EncryptDecrypt_EmptyPlaintext(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	plaintext := []byte{}

	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt empty plaintext failed: %v", err)
	}

	decResp, err := client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    encResp.Version,
	})
	if err != nil {
		t.Fatalf("Decrypt empty plaintext failed: %v", err)
	}

	if len(decResp.Plaintext) != 0 {
		t.Errorf("expected empty plaintext, got %d bytes", len(decResp.Plaintext))
	}
}

func TestGRPC_EncryptDecrypt_LargePlaintext(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	// 100KB of data
	plaintext := make([]byte, 100*1024)
	for i := range plaintext {
		plaintext[i] = byte(i % 256)
	}

	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt large plaintext failed: %v", err)
	}

	decResp, err := client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    encResp.Version,
	})
	if err != nil {
		t.Fatalf("Decrypt large plaintext failed: %v", err)
	}

	if len(decResp.Plaintext) != len(plaintext) {
		t.Errorf("expected %d bytes, got %d", len(plaintext), len(decResp.Plaintext))
	}

	for i := range plaintext {
		if decResp.Plaintext[i] != plaintext[i] {
			t.Errorf("mismatch at byte %d", i)
			break
		}
	}
}

func TestGRPC_Decrypt_VersionZeroFallback(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	plaintext := []byte("test secret")

	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Decrypt with version 0 (should fallback to version 1)
	decResp, err := client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    0, // Should fallback to 1
	})
	if err != nil {
		t.Fatalf("Decrypt with version 0 failed: %v", err)
	}

	if string(decResp.Plaintext) != string(plaintext) {
		t.Errorf("expected plaintext %q, got %q", plaintext, decResp.Plaintext)
	}
}

func TestGRPC_Decrypt_WrongVersion(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	plaintext := []byte("test secret")

	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Try to decrypt with non-existent version
	_, err = client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    99, // Non-existent version
	})
	if err == nil {
		t.Fatal("expected error for non-existent version")
	}
}

func TestGRPC_Decrypt_TamperedCiphertext(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	plaintext := []byte("test secret")

	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Tamper with ciphertext
	tampered := make([]byte, len(encResp.Ciphertext))
	copy(tampered, encResp.Ciphertext)
	tampered[0] ^= 0xFF

	_, err = client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: tampered,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    encResp.Version,
	})
	if err == nil {
		t.Fatal("expected error for tampered ciphertext")
	}
}

func TestGRPC_Decrypt_InvalidIV(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	plaintext := []byte("test secret")

	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Wrong IV length
	_, err = client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         []byte("short"),
		AuthTag:    encResp.AuthTag,
		Version:    encResp.Version,
	})
	if err == nil {
		t.Fatal("expected error for invalid IV length")
	}
}

func TestGRPC_Decrypt_EmptyAuthTag(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	plaintext := []byte("test secret")

	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Empty auth tag
	_, err = client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    []byte{},
		Version:    encResp.Version,
	})
	if err == nil {
		t.Fatal("expected error for empty auth tag")
	}
}

// =============================================================================
// Multi-Key gRPC Tests
// =============================================================================

func TestGRPC_MultiKey_EncryptWithCurrentVersion(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{
		1: testKey,
		2: testKey2,
	})
	defer cleanup()

	plaintext := []byte("multi-key test")

	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Should use version 2 (highest)
	if encResp.Version != 2 {
		t.Errorf("expected version 2, got %d", encResp.Version)
	}

	// Should decrypt successfully
	decResp, err := client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    encResp.Version,
	})
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}

	if string(decResp.Plaintext) != string(plaintext) {
		t.Errorf("plaintext mismatch")
	}
}

func TestGRPC_MultiKey_DecryptOldVersion(t *testing.T) {
	// First, encrypt with version 1 only
	client1, cleanup1 := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup1()

	plaintext := []byte("old version data")

	encResp, err := client1.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt with v1 failed: %v", err)
	}

	cleanup1()

	// Now create server with both keys
	client2, cleanup2 := setupTestServer(t, map[uint32]string{
		1: testKey,
		2: testKey2,
	})
	defer cleanup2()

	// Should be able to decrypt v1 data
	decResp, err := client2.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    1,
	})
	if err != nil {
		t.Fatalf("Decrypt v1 data with multi-key server failed: %v", err)
	}

	if string(decResp.Plaintext) != string(plaintext) {
		t.Errorf("plaintext mismatch")
	}
}

func TestGRPC_MultiKey_CrossVersionDecryptFails(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{
		1: testKey,
		2: testKey2,
	})
	defer cleanup()

	plaintext := []byte("test data")

	// Encrypt (will use v2)
	encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: plaintext,
	})
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	if encResp.Version != 2 {
		t.Fatalf("expected v2, got v%d", encResp.Version)
	}

	// Try to decrypt with v1 (wrong key)
	_, err = client.Decrypt(context.Background(), &pb.DecryptRequest{
		Ciphertext: encResp.Ciphertext,
		Iv:         encResp.Iv,
		AuthTag:    encResp.AuthTag,
		Version:    1, // Wrong version
	})
	if err == nil {
		t.Fatal("expected error when decrypting with wrong version key")
	}
}

// =============================================================================
// Concurrent gRPC Tests
// =============================================================================

func TestGRPC_ConcurrentRequests(t *testing.T) {
	client, cleanup := setupTestServer(t, map[uint32]string{1: testKey})
	defer cleanup()

	const numGoroutines = 50
	const opsPerGoroutine = 20

	errChan := make(chan error, numGoroutines*opsPerGoroutine)
	var wg sync.WaitGroup

	for g := 0; g < numGoroutines; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < opsPerGoroutine; i++ {
				plaintext := []byte("goroutine test data " + string(rune(id)) + string(rune(i)))

				encResp, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
					Plaintext: plaintext,
				})
				if err != nil {
					errChan <- err
					continue
				}

				decResp, err := client.Decrypt(context.Background(), &pb.DecryptRequest{
					Ciphertext: encResp.Ciphertext,
					Iv:         encResp.Iv,
					AuthTag:    encResp.AuthTag,
					Version:    encResp.Version,
				})
				if err != nil {
					errChan <- err
					continue
				}

				if string(decResp.Plaintext) != string(plaintext) {
					errChan <- fmt.Errorf("plaintext mismatch for goroutine %d, iteration %d", id, i)
				}
			}
		}(g)
	}

	// Wait for all goroutines to complete before closing channel
	wg.Wait()
	close(errChan)

	// Collect errors
	var errors []error
	for err := range errChan {
		if err != nil {
			errors = append(errors, err)
		}
	}

	if len(errors) > 0 {
		t.Errorf("got %d errors during concurrent requests", len(errors))
		for i, err := range errors {
			if i < 5 {
				t.Errorf("error %d: %v", i, err)
			}
		}
	}
}
