package main

import (
	"context"
	"net"
	"testing"

	"keyway-crypto/crypto"
	"keyway-crypto/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

const testAuthToken = "test-secret-token-for-auth-interceptor"

func setupAuthTestServer(t *testing.T, token string, keys map[uint32]string) (pb.CryptoServiceClient, func()) {
	t.Helper()

	engine, err := crypto.NewMultiEngine(keys)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	lis := bufconn.Listen(bufSize)
	s := grpc.NewServer(grpc.UnaryInterceptor(authInterceptor(token)))
	pb.RegisterCryptoServiceServer(s, &server{engine: engine})

	go func() {
		if err := s.Serve(lis); err != nil {
			// Server stopped, expected during cleanup
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

func ctxWithToken(token string) context.Context {
	md := metadata.New(map[string]string{"x-crypto-auth-token": token})
	return metadata.NewOutgoingContext(context.Background(), md)
}

func TestAuthInterceptor_ValidToken(t *testing.T) {
	client, cleanup := setupAuthTestServer(t, testAuthToken, map[uint32]string{1: testKey})
	defer cleanup()

	ctx := ctxWithToken(testAuthToken)

	// Encrypt should succeed
	resp, err := client.Encrypt(ctx, &pb.EncryptRequest{
		Plaintext: []byte("hello"),
		Version:   0,
	})
	if err != nil {
		t.Fatalf("Encrypt with valid token failed: %v", err)
	}
	if len(resp.Ciphertext) == 0 {
		t.Fatal("expected non-empty ciphertext")
	}

	// Decrypt should succeed
	decResp, err := client.Decrypt(ctx, &pb.DecryptRequest{
		Ciphertext: resp.Ciphertext,
		Iv:         resp.Iv,
		AuthTag:    resp.AuthTag,
		Version:    resp.Version,
	})
	if err != nil {
		t.Fatalf("Decrypt with valid token failed: %v", err)
	}
	if string(decResp.Plaintext) != "hello" {
		t.Fatalf("expected 'hello', got '%s'", string(decResp.Plaintext))
	}
}

func TestAuthInterceptor_InvalidToken(t *testing.T) {
	client, cleanup := setupAuthTestServer(t, testAuthToken, map[uint32]string{1: testKey})
	defer cleanup()

	ctx := ctxWithToken("wrong-token")

	_, err := client.Encrypt(ctx, &pb.EncryptRequest{
		Plaintext: []byte("hello"),
		Version:   0,
	})
	if err == nil {
		t.Fatal("expected error with invalid token")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got: %v", st.Code())
	}
}

func TestAuthInterceptor_MissingMetadata(t *testing.T) {
	client, cleanup := setupAuthTestServer(t, testAuthToken, map[uint32]string{1: testKey})
	defer cleanup()

	// No metadata at all
	_, err := client.Encrypt(context.Background(), &pb.EncryptRequest{
		Plaintext: []byte("hello"),
		Version:   0,
	})
	if err == nil {
		t.Fatal("expected error without metadata")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got: %v", st.Code())
	}
}

func TestAuthInterceptor_EmptyToken(t *testing.T) {
	client, cleanup := setupAuthTestServer(t, testAuthToken, map[uint32]string{1: testKey})
	defer cleanup()

	ctx := ctxWithToken("")

	_, err := client.Encrypt(ctx, &pb.EncryptRequest{
		Plaintext: []byte("hello"),
		Version:   0,
	})
	if err == nil {
		t.Fatal("expected error with empty token")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got: %v", st.Code())
	}
}

func TestAuthInterceptor_AllCryptoMethodsProtected(t *testing.T) {
	client, cleanup := setupAuthTestServer(t, testAuthToken, map[uint32]string{1: testKey})
	defer cleanup()

	wrongCtx := ctxWithToken("wrong-token")

	// Encrypt
	_, err := client.Encrypt(wrongCtx, &pb.EncryptRequest{Plaintext: []byte("test"), Version: 0})
	if st, ok := status.FromError(err); !ok || st.Code() != codes.Unauthenticated {
		t.Fatalf("Encrypt: expected Unauthenticated, got: %v", err)
	}

	// Decrypt
	_, err = client.Decrypt(wrongCtx, &pb.DecryptRequest{Ciphertext: []byte("x"), Iv: []byte("x"), AuthTag: []byte("x"), Version: 1})
	if st, ok := status.FromError(err); !ok || st.Code() != codes.Unauthenticated {
		t.Fatalf("Decrypt: expected Unauthenticated, got: %v", err)
	}

	// Keyway HealthCheck (custom RPC, should be protected)
	_, err = client.HealthCheck(wrongCtx, &pb.Empty{})
	if st, ok := status.FromError(err); !ok || st.Code() != codes.Unauthenticated {
		t.Fatalf("HealthCheck: expected Unauthenticated, got: %v", err)
	}
}

func TestAuthInterceptor_GrpcHealthExempt(t *testing.T) {
	// The gRPC standard health service should be accessible without auth
	// so Docker/k8s health probes work even when auth is enabled.
	engine, err := crypto.NewMultiEngine(map[uint32]string{1: testKey})
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	lis := bufconn.Listen(bufSize)
	s := grpc.NewServer(grpc.UnaryInterceptor(authInterceptor(testAuthToken)))
	pb.RegisterCryptoServiceServer(s, &server{engine: engine})
	grpc_health_v1.RegisterHealthServer(s, health.NewServer())

	go func() {
		if err := s.Serve(lis); err != nil {
			// expected during cleanup
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
	defer func() {
		conn.Close()
		s.Stop()
	}()

	// Call gRPC health check WITHOUT auth token -- should succeed
	healthClient := grpc_health_v1.NewHealthClient(conn)
	resp, err := healthClient.Check(context.Background(), &grpc_health_v1.HealthCheckRequest{})
	if err != nil {
		t.Fatalf("gRPC health check should not require auth, got: %v", err)
	}
	if resp.Status != grpc_health_v1.HealthCheckResponse_SERVING {
		t.Fatalf("expected SERVING, got: %v", resp.Status)
	}
}
