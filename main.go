package main

import (
	"context"
	"log"
	"net"
	"os"

	"keyway-crypto/crypto"
	"keyway-crypto/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
)

const version = "1.0.0"

type server struct {
	pb.UnimplementedCryptoServiceServer
	engine *crypto.Engine
}

func (s *server) Encrypt(ctx context.Context, req *pb.EncryptRequest) (*pb.EncryptResponse, error) {
	ciphertext, iv, authTag, err := s.engine.Encrypt(req.Plaintext)
	if err != nil {
		return nil, err
	}
	return &pb.EncryptResponse{
		Ciphertext: ciphertext,
		Iv:         iv,
		AuthTag:    authTag,
		Version:    1,
	}, nil
}

func (s *server) Decrypt(ctx context.Context, req *pb.DecryptRequest) (*pb.DecryptResponse, error) {
	plaintext, err := s.engine.Decrypt(req.Ciphertext, req.Iv, req.AuthTag)
	if err != nil {
		return nil, err
	}
	return &pb.DecryptResponse{Plaintext: plaintext}, nil
}

func (s *server) HealthCheck(ctx context.Context, req *pb.Empty) (*pb.HealthResponse, error) {
	return &pb.HealthResponse{Healthy: true, Version: version}, nil
}

func main() {
	keyHex := os.Getenv("ENCRYPTION_KEY")
	if keyHex == "" {
		log.Fatal("ENCRYPTION_KEY environment variable is required")
	}

	engine, err := crypto.NewEngine(keyHex)
	if err != nil {
		log.Fatalf("Failed to initialize crypto engine: %v", err)
	}

	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	s := grpc.NewServer()
	pb.RegisterCryptoServiceServer(s, &server{engine: engine})

	// Health check for k8s/docker
	grpc_health_v1.RegisterHealthServer(s, health.NewServer())

	log.Printf("Crypto service listening on :50051")
	if err := s.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
