import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import type { IEncryptionService, EncryptedData } from "./encryption";
import { DEFAULT_ENCRYPTION_VERSION } from "./encryption";

interface CryptoClient {
  Encrypt: (
    request: { plaintext: Buffer; version: number },
    callback: (err: Error | null, response: EncryptResponse) => void
  ) => void;
  Decrypt: (
    request: { ciphertext: Buffer; iv: Buffer; authTag: Buffer; version: number },
    callback: (err: Error | null, response: DecryptResponse) => void
  ) => void;
  HealthCheck: (
    request: Record<string, never>,
    callback: (err: Error | null, response: HealthResponse) => void
  ) => void;
}

interface EncryptResponse {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  version: number;
}

interface DecryptResponse {
  plaintext: Buffer;
}

interface HealthResponse {
  healthy: boolean;
  version: string;
}

export class CryptoServiceError extends Error {
  constructor(
    message: string,
    public readonly operation: "encrypt" | "decrypt" | "healthcheck",
    public readonly serviceUrl: string,
    public readonly cause?: Error,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = "CryptoServiceError";
  }
}

// gRPC status codes that are retryable (transient errors)
const RETRYABLE_GRPC_CODES = new Set([
  14, // UNAVAILABLE - service temporarily unavailable
  4, // DEADLINE_EXCEEDED - timeout
  8, // RESOURCE_EXHAUSTED - rate limited
]);

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 100 } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      // Only retry if it's a retryable error
      if (err instanceof CryptoServiceError && !err.isRetryable) {
        throw err;
      }

      // Don't wait after the last attempt
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt); // 100, 200, 400ms
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

function formatGrpcError(
  err: Error & { code?: number; details?: string },
  serviceUrl: string,
  operation: string
): CryptoServiceError {
  const grpcCode = err.code;
  const details = err.details || err.message;
  const isRetryable = grpcCode !== undefined && RETRYABLE_GRPC_CODES.has(grpcCode);

  let userMessage: string;

  switch (grpcCode) {
    case 14: // UNAVAILABLE
      userMessage = `Crypto service unavailable at ${serviceUrl}. Check that the service is running and accessible. Details: ${details}`;
      break;
    case 4: // DEADLINE_EXCEEDED
      userMessage = `Crypto service timeout at ${serviceUrl}. The service is not responding in time.`;
      break;
    case 2: // UNKNOWN
      userMessage = `Crypto service error at ${serviceUrl}. Unknown error: ${details}`;
      break;
    case 13: // INTERNAL
      userMessage = `Crypto service internal error at ${serviceUrl}. Details: ${details}`;
      break;
    default:
      userMessage = `Crypto service error (code ${grpcCode}) at ${serviceUrl}: ${details}`;
  }

  return new CryptoServiceError(
    userMessage,
    operation as "encrypt" | "decrypt" | "healthcheck",
    serviceUrl,
    err,
    isRetryable
  );
}

export class RemoteEncryptionService implements IEncryptionService {
  private client: CryptoClient;
  private serviceUrl: string;

  constructor(address: string = "localhost:50051") {
    this.serviceUrl = address;

    // Security: Only allow insecure gRPC for trusted networks
    // Railway private networking doesn't provide TLS, but traffic is isolated
    // Docker container names are also trusted (internal Docker network)
    // (CRIT-2 fix: Validate address to prevent accidental exposure)
    const isTrustedNetwork =
      address.startsWith("localhost") ||
      address.startsWith("127.0.0.1") ||
      address.includes(".railway.internal") ||
      address.startsWith("crypto:"); // Docker container name for local dev

    if (!isTrustedNetwork) {
      throw new Error(
        `Crypto service address "${address}" is not on a trusted network. ` +
          "Only localhost, 127.0.0.1, *.railway.internal, and crypto:* (Docker) are allowed without TLS."
      );
    }

    const protoPath = path.join(__dirname, "../../proto/crypto.proto");
    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
      keyway: {
        crypto: {
          CryptoService: new (
            address: string,
            credentials: grpc.ChannelCredentials
          ) => CryptoClient;
        };
      };
    };
    this.client = new proto.keyway.crypto.CryptoService(address, grpc.credentials.createInsecure());
  }

  async encrypt(content: string): Promise<EncryptedData> {
    return withRetry(() => this.encryptOnce(content));
  }

  private async encryptOnce(content: string): Promise<EncryptedData> {
    return new Promise((resolve, reject) => {
      this.client.Encrypt(
        { plaintext: Buffer.from(content, "utf-8"), version: 0 }, // 0 = use current version
        (err, response) => {
          if (err) {
            return reject(
              formatGrpcError(
                err as Error & { code?: number; details?: string },
                this.serviceUrl,
                "encrypt"
              )
            );
          }
          resolve({
            encryptedContent: Buffer.from(response.ciphertext).toString("hex"),
            iv: Buffer.from(response.iv).toString("hex"),
            authTag: Buffer.from(response.authTag).toString("hex"),
            version: response.version,
          });
        }
      );
    });
  }

  async decrypt(data: EncryptedData): Promise<string> {
    return withRetry(() => this.decryptOnce(data));
  }

  private async decryptOnce(data: EncryptedData): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.Decrypt(
        {
          ciphertext: Buffer.from(data.encryptedContent, "hex"),
          iv: Buffer.from(data.iv, "hex"),
          authTag: Buffer.from(data.authTag, "hex"),
          version: data.version ?? DEFAULT_ENCRYPTION_VERSION,
        },
        (err, response) => {
          if (err) {
            return reject(
              formatGrpcError(
                err as Error & { code?: number; details?: string },
                this.serviceUrl,
                "decrypt"
              )
            );
          }
          resolve(Buffer.from(response.plaintext).toString("utf-8"));
        }
      );
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; version: string }> {
    return new Promise((resolve, reject) => {
      this.client.HealthCheck({}, (err, response) => {
        if (err) {
          return reject(
            formatGrpcError(
              err as Error & { code?: number; details?: string },
              this.serviceUrl,
              "healthcheck"
            )
          );
        }
        resolve({ healthy: response.healthy, version: response.version });
      });
    });
  }
}

/**
 * Check crypto service connectivity
 * Throws CryptoServiceError with detailed message if not accessible
 */
export async function checkCryptoService(
  serviceUrl: string
): Promise<{ healthy: boolean; version: string }> {
  const service = new RemoteEncryptionService(serviceUrl);
  return service.healthCheck();
}
