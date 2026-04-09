package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"log"
	"math/big"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"keyway-crypto/crypto"
	"keyway-crypto/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const version = "1.1.0"

type server struct {
	pb.UnimplementedCryptoServiceServer
	engine *crypto.MultiEngine
}

func (s *server) Encrypt(ctx context.Context, req *pb.EncryptRequest) (*pb.EncryptResponse, error) {
	log.Printf("[Encrypt] Received request, plaintext size: %d bytes", len(req.Plaintext))
	ciphertext, iv, authTag, keyVersion, err := s.engine.Encrypt(req.Plaintext)
	if err != nil {
		log.Printf("[Encrypt] Error: %v", err)
		return nil, err
	}
	log.Printf("[Encrypt] Success, ciphertext size: %d bytes, key version: %d", len(ciphertext), keyVersion)
	return &pb.EncryptResponse{
		Ciphertext: ciphertext,
		Iv:         iv,
		AuthTag:    authTag,
		Version:    keyVersion,
	}, nil
}

func (s *server) Decrypt(ctx context.Context, req *pb.DecryptRequest) (*pb.DecryptResponse, error) {
	keyVersion := req.Version
	// Default to version 1 for backward compatibility with existing data
	if keyVersion == 0 {
		keyVersion = 1
	}
	log.Printf("[Decrypt] Request: ciphertext=%d bytes, iv=%d bytes, authTag=%d bytes, version=%d",
		len(req.Ciphertext), len(req.Iv), len(req.AuthTag), keyVersion)
	log.Printf("[Decrypt] Available versions: %v, has v%d: %v",
		s.engine.AvailableVersions(), keyVersion, s.engine.HasVersion(keyVersion))
	plaintext, err := s.engine.Decrypt(req.Ciphertext, req.Iv, req.AuthTag, keyVersion)
	if err != nil {
		log.Printf("[Decrypt] FAILED for version %d: %v", keyVersion, err)
		return nil, err
	}
	log.Printf("[Decrypt] Success, plaintext size: %d bytes", len(plaintext))
	return &pb.DecryptResponse{Plaintext: plaintext}, nil
}

func (s *server) HealthCheck(ctx context.Context, req *pb.Empty) (*pb.HealthResponse, error) {
	log.Printf("[HealthCheck] Received request")
	return &pb.HealthResponse{Healthy: true, Version: version}, nil
}

// authInterceptor creates a gRPC unary interceptor that validates a shared secret token.
// Uses SHA-256 hashing + constant-time comparison to prevent timing and length-leaking attacks.
// The gRPC health service is exempt so Docker/k8s health probes still work.
func authInterceptor(expectedToken string) grpc.UnaryServerInterceptor {
	expectedHash := sha256.Sum256([]byte(expectedToken))
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		// Allow health probes without auth (used by Docker/k8s)
		if info.FullMethod == "/grpc.health.v1.Health/Check" {
			return handler(ctx, req)
		}
		md, ok := metadata.FromIncomingContext(ctx)
		if !ok {
			return nil, status.Error(codes.Unauthenticated, "missing metadata")
		}
		tokens := md.Get("x-crypto-auth-token")
		if len(tokens) == 0 {
			return nil, status.Error(codes.Unauthenticated, "invalid or missing auth token")
		}
		providedHash := sha256.Sum256([]byte(tokens[0]))
		if subtle.ConstantTimeCompare(expectedHash[:], providedHash[:]) != 1 {
			return nil, status.Error(codes.Unauthenticated, "invalid or missing auth token")
		}
		return handler(ctx, req)
	}
}

// loadOrGenerateTLS loads an existing TLS certificate or generates a self-signed one.
// Returns the certificate, its SHA-256 fingerprint (hex), and any error.
func loadOrGenerateTLS(certPath, keyPath string) (tls.Certificate, string, error) {
	// Check for mismatched cert/key files (one exists, other missing)
	_, certErr := os.Stat(certPath)
	_, keyErr := os.Stat(keyPath)
	certExists := certErr == nil
	keyExists := keyErr == nil
	if certExists != keyExists {
		return tls.Certificate{}, "", fmt.Errorf("mismatched TLS files: cert exists=%v, key exists=%v -- delete both to regenerate", certExists, keyExists)
	}

	// Try to load existing cert+key pair
	if certExists {
		cert, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return tls.Certificate{}, "", fmt.Errorf("failed to load TLS cert: %w", err)
		}
		// Validate cert is not expired
		x509Cert, err := x509.ParseCertificate(cert.Certificate[0])
		if err != nil {
			return tls.Certificate{}, "", fmt.Errorf("failed to parse TLS cert: %w", err)
		}
		now := time.Now()
		if now.Before(x509Cert.NotBefore) || now.After(x509Cert.NotAfter) {
			log.Printf("TLS cert expired (valid %s to %s), regenerating...", x509Cert.NotBefore.Format(time.RFC3339), x509Cert.NotAfter.Format(time.RFC3339))
			os.Remove(certPath)
			os.Remove(keyPath)
			return loadOrGenerateTLS(certPath, keyPath)
		}
		// Warn if cert expires within 30 days
		if time.Until(x509Cert.NotAfter) < 30*24*time.Hour {
			log.Printf("WARNING: TLS cert expires in %d days (%s)", int(time.Until(x509Cert.NotAfter).Hours()/24), x509Cert.NotAfter.Format(time.RFC3339))
		}
		hash := sha256.Sum256(cert.Certificate[0])
		return cert, hex.EncodeToString(hash[:]), nil
	}

	// Generate self-signed ECDSA P-256 cert
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("failed to generate key: %w", err)
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("failed to generate serial: %w", err)
	}

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject:      pkix.Name{CommonName: "keyway-crypto"},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost", "crypto", "*.railway.internal"},
		IPAddresses:  []net.IP{net.IPv4(127, 0, 0, 1)},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("failed to create certificate: %w", err)
	}

	// Write cert and key atomically using temp files + rename to avoid partial writes
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyDER, err := x509.MarshalECPrivateKey(privateKey)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("failed to marshal key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	tmpCert := certPath + ".tmp"
	tmpKey := keyPath + ".tmp"
	// Clean up temp files on any error
	cleanup := func() {
		os.Remove(tmpCert)
		os.Remove(tmpKey)
	}

	if err := os.WriteFile(tmpCert, certPEM, 0644); err != nil {
		cleanup()
		return tls.Certificate{}, "", fmt.Errorf("failed to write cert: %w", err)
	}
	if err := os.WriteFile(tmpKey, keyPEM, 0600); err != nil {
		cleanup()
		return tls.Certificate{}, "", fmt.Errorf("failed to write key: %w", err)
	}
	if err := os.Rename(tmpCert, certPath); err != nil {
		cleanup()
		return tls.Certificate{}, "", fmt.Errorf("failed to rename cert: %w", err)
	}
	if err := os.Rename(tmpKey, keyPath); err != nil {
		// Cert already renamed, try to clean up
		os.Remove(certPath)
		return tls.Certificate{}, "", fmt.Errorf("failed to rename key: %w", err)
	}

	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("failed to load generated cert: %w", err)
	}
	hash := sha256.Sum256(certDER)
	return cert, hex.EncodeToString(hash[:]), nil
}

// parseEncryptionKeys parses ENCRYPTION_KEYS format: "1:hex_key_1,2:hex_key_2"
// Falls back to ENCRYPTION_KEY (single key as version 1) for backward compatibility
func parseEncryptionKeys() (map[uint32]string, error) {
	keys := make(map[uint32]string)

	// Try new multi-key format first
	multiKeys := os.Getenv("ENCRYPTION_KEYS")
	if multiKeys != "" {
		pairs := strings.Split(multiKeys, ",")
		for _, pair := range pairs {
			parts := strings.SplitN(strings.TrimSpace(pair), ":", 2)
			if len(parts) != 2 {
				return nil, fmt.Errorf("invalid key format: %s (expected version:key)", pair)
			}
			version, err := strconv.ParseUint(strings.TrimSpace(parts[0]), 10, 32)
			if err != nil {
				return nil, fmt.Errorf("invalid version number: %s", parts[0])
			}
			if version == 0 {
				return nil, fmt.Errorf("version 0 is reserved, use version >= 1")
			}
			keys[uint32(version)] = strings.TrimSpace(parts[1])
		}
		return keys, nil
	}

	// Fall back to single key format for backward compatibility
	singleKey := os.Getenv("ENCRYPTION_KEY")
	if singleKey != "" {
		keys[1] = singleKey
		return keys, nil
	}

	return nil, fmt.Errorf("ENCRYPTION_KEYS or ENCRYPTION_KEY environment variable is required")
}

func main() {
	keys, err := parseEncryptionKeys()
	if err != nil {
		log.Fatalf("Failed to parse encryption keys: %v", err)
	}

	engine, err := crypto.NewMultiEngine(keys)
	if err != nil {
		log.Fatalf("Failed to initialize crypto engine: %v", err)
	}

	log.Printf("Loaded %d encryption key(s), current version: %d, available versions: %v",
		len(keys), engine.CurrentVersion(), engine.AvailableVersions())

	port := os.Getenv("GRPC_PORT")
	if port == "" {
		port = "50051"
	}

	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	// Build gRPC server options (auth + TLS)
	var opts []grpc.ServerOption

	// Auth interceptor (shared secret)
	authToken := os.Getenv("CRYPTO_AUTH_TOKEN")
	if authToken != "" {
		opts = append(opts, grpc.UnaryInterceptor(authInterceptor(authToken)))
		log.Printf("Auth token interceptor enabled")
	} else {
		log.Printf("WARNING: No CRYPTO_AUTH_TOKEN set -- running without authentication")
	}

	// TLS (self-signed cert, auto-generated if needed)
	tlsCertPath := os.Getenv("CRYPTO_TLS_CERT_PATH")
	tlsKeyPath := os.Getenv("CRYPTO_TLS_KEY_PATH")
	if tlsCertPath == "" {
		tlsCertPath = "/data/crypto/tls.crt"
	}
	if tlsKeyPath == "" {
		tlsKeyPath = "/data/crypto/tls.key"
	}

	tlsRequired := os.Getenv("CRYPTO_TLS_REQUIRED") == "true"

	if tlsCertPath != "none" {
		cert, fingerprint, tlsErr := loadOrGenerateTLS(tlsCertPath, tlsKeyPath)
		if tlsErr != nil {
			if tlsRequired {
				log.Fatalf("TLS setup failed and CRYPTO_TLS_REQUIRED=true: %v", tlsErr)
			}
			log.Printf("WARNING: TLS setup failed (%v) -- running without TLS", tlsErr)
		} else {
			creds := credentials.NewServerTLSFromCert(&cert)
			opts = append(opts, grpc.Creds(creds))
			log.Printf("TLS enabled, cert SHA-256: %s", fingerprint)
		}
	} else {
		log.Printf("TLS disabled (CRYPTO_TLS_CERT_PATH=none)")
	}

	s := grpc.NewServer(opts...)
	pb.RegisterCryptoServiceServer(s, &server{engine: engine})

	// Health check for k8s/docker
	grpc_health_v1.RegisterHealthServer(s, health.NewServer())

	log.Printf("Crypto service listening on :%s", port)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
