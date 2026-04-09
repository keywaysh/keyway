FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o keyway-crypto .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && \
    addgroup -S crypto && adduser -S crypto -G crypto && \
    mkdir -p /data/crypto && chown crypto:crypto /data/crypto
COPY --from=builder /app/keyway-crypto /usr/local/bin/
EXPOSE 50051
USER crypto
CMD ["keyway-crypto"]
