FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o keyway-crypto .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/keyway-crypto /usr/local/bin/
ENV ENCRYPTION_KEY=""
EXPOSE 50051
CMD ["keyway-crypto"]
