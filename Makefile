.PHONY: proto build run docker test clean

proto:
	protoc --go_out=. --go-grpc_out=. proto/crypto.proto

build:
	go build -o bin/keyway-crypto .

run:
	ENCRYPTION_KEY=$(ENCRYPTION_KEY) go run .

docker:
	docker build -t keyway-crypto .

docker-run:
	docker run -p 50051:50051 -e ENCRYPTION_KEY=$(ENCRYPTION_KEY) keyway-crypto

test:
	go test ./...

test-verbose:
	go test -v ./...

clean:
	rm -rf bin/
