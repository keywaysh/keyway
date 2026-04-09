package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadOrGenerateTLS_GeneratesCert(t *testing.T) {
	tmpDir := t.TempDir()
	certPath := filepath.Join(tmpDir, "tls.crt")
	keyPath := filepath.Join(tmpDir, "tls.key")

	cert, hash, err := loadOrGenerateTLS(certPath, keyPath)
	if err != nil {
		t.Fatalf("loadOrGenerateTLS failed: %v", err)
	}

	// Verify files were created
	if _, err := os.Stat(certPath); os.IsNotExist(err) {
		t.Fatal("cert file was not created")
	}
	if _, err := os.Stat(keyPath); os.IsNotExist(err) {
		t.Fatal("key file was not created")
	}

	// Verify key file permissions (0600)
	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("failed to stat key file: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Fatalf("expected key file permissions 0600, got %o", perm)
	}

	// Verify hash is 64 hex chars
	if len(hash) != 64 {
		t.Fatalf("expected 64-char hash, got %d chars: %s", len(hash), hash)
	}

	// Verify cert is valid
	if len(cert.Certificate) == 0 {
		t.Fatal("expected at least one certificate in chain")
	}
}

func TestLoadOrGenerateTLS_LoadsExisting(t *testing.T) {
	tmpDir := t.TempDir()
	certPath := filepath.Join(tmpDir, "tls.crt")
	keyPath := filepath.Join(tmpDir, "tls.key")

	// Generate first
	_, hash1, err := loadOrGenerateTLS(certPath, keyPath)
	if err != nil {
		t.Fatalf("first call failed: %v", err)
	}

	// Load existing -- should return the same hash
	_, hash2, err := loadOrGenerateTLS(certPath, keyPath)
	if err != nil {
		t.Fatalf("second call failed: %v", err)
	}

	if hash1 != hash2 {
		t.Fatalf("hashes differ: %s vs %s", hash1, hash2)
	}
}

func TestLoadOrGenerateTLS_CertHasCorrectSANs(t *testing.T) {
	tmpDir := t.TempDir()
	certPath := filepath.Join(tmpDir, "tls.crt")
	keyPath := filepath.Join(tmpDir, "tls.key")

	_, _, err := loadOrGenerateTLS(certPath, keyPath)
	if err != nil {
		t.Fatalf("loadOrGenerateTLS failed: %v", err)
	}

	// Parse the cert to check SANs
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		t.Fatalf("failed to read cert: %v", err)
	}

	block, _ := pem.Decode(certPEM)
	if block == nil {
		t.Fatal("failed to decode PEM")
	}

	x509Cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatalf("failed to parse certificate: %v", err)
	}

	// Check DNS SANs
	expectedDNS := map[string]bool{
		"localhost":          false,
		"crypto":            false,
		"*.railway.internal": false,
	}
	for _, name := range x509Cert.DNSNames {
		if _, ok := expectedDNS[name]; ok {
			expectedDNS[name] = true
		}
	}
	for name, found := range expectedDNS {
		if !found {
			t.Errorf("missing DNS SAN: %s (found: %v)", name, x509Cert.DNSNames)
		}
	}

	// Check IP SANs
	foundLoopback := false
	for _, ip := range x509Cert.IPAddresses {
		if ip.String() == "127.0.0.1" {
			foundLoopback = true
		}
	}
	if !foundLoopback {
		t.Error("missing IP SAN: 127.0.0.1")
	}
}

func TestLoadOrGenerateTLS_MismatchedFiles(t *testing.T) {
	tmpDir := t.TempDir()
	certPath := filepath.Join(tmpDir, "tls.crt")
	keyPath := filepath.Join(tmpDir, "tls.key")

	// Create cert file but not key file
	os.WriteFile(certPath, []byte("dummy"), 0644)

	_, _, err := loadOrGenerateTLS(certPath, keyPath)
	if err == nil {
		t.Fatal("expected error when cert exists but key doesn't")
	}
	if !strings.Contains(err.Error(), "mismatched TLS files") {
		t.Fatalf("expected mismatched error, got: %v", err)
	}

	// Clean up and test the reverse: key exists but cert doesn't
	os.Remove(certPath)
	os.WriteFile(keyPath, []byte("dummy"), 0600)

	_, _, err = loadOrGenerateTLS(certPath, keyPath)
	if err == nil {
		t.Fatal("expected error when key exists but cert doesn't")
	}
	if !strings.Contains(err.Error(), "mismatched TLS files") {
		t.Fatalf("expected mismatched error, got: %v", err)
	}
}

func TestLoadOrGenerateTLS_CertIsECDSAP256(t *testing.T) {
	tmpDir := t.TempDir()
	certPath := filepath.Join(tmpDir, "tls.crt")
	keyPath := filepath.Join(tmpDir, "tls.key")

	_, _, err := loadOrGenerateTLS(certPath, keyPath)
	if err != nil {
		t.Fatalf("loadOrGenerateTLS failed: %v", err)
	}

	// Parse cert
	certPEM, _ := os.ReadFile(certPath)
	block, _ := pem.Decode(certPEM)
	x509Cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatalf("failed to parse certificate: %v", err)
	}

	// Check algorithm
	pubKey, ok := x509Cert.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		t.Fatalf("expected ECDSA public key, got %T", x509Cert.PublicKey)
	}
	if pubKey.Curve != elliptic.P256() {
		t.Fatalf("expected P-256 curve, got %v", pubKey.Curve.Params().Name)
	}
}
