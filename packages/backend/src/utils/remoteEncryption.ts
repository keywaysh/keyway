import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as fs from "fs";
import path from "path";
import type { IEncryptionService, EncryptedData } from "./encryption";
import { DEFAULT_ENCRYPTION_VERSION } from "./encryption";

type RpcCallback<T> = (err: Error | null, response: T) => void;

interface CryptoClient {
  Encrypt: (
    request: { plaintext: Buffer; version: number },
    metadataOrCallback: grpc.Metadata | RpcCallback<EncryptResponse>,
    callback?: RpcCallback<EncryptResponse>
  ) => void;
  Decrypt: (
    request: { ciphertext: Buffer; iv: Buffer; authTag: Buffer; version: number },
    metadataOrCallback: grpc.Metadata | RpcCallback<DecryptResponse>,
    callback?: RpcCallback<DecryptResponse>
  ) => void;
  HealthCheck: (
    request: Record<string, never>,
    metadataOrCallback: grpc.Metadata | RpcCallback<HealthResponse>,
    callback?: RpcCallback<HealthResponse>
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

export interface CryptoServiceOptions {
  authToken?: string;
  /** PEM-encoded CA cert for TLS, base64-encoded (same pattern as GITHUB_APP_PRIVATE_KEY) */
  tlsCa?: string;
  /** Path to CA cert PEM file (alternative to tlsCa, for Docker shared volumes) */
  tlsCaPath?: string;
}

export class RemoteEncryptionService implements IEncryptionService {
  private client: CryptoClient;
  private serviceUrl: string;
  private metadata: grpc.Metadata | null = null;

  constructor(address: string = "localhost:50051", options?: CryptoServiceOptions) {
    this.serviceUrl = address;

    // Set up auth metadata if token provided
    if (options?.authToken) {
      this.metadata = new grpc.Metadata();
      this.metadata.set("x-crypto-auth-token", options.authToken);
    }

    // Determine channel credentials (TLS or insecure)
    let channelCreds: grpc.ChannelCredentials;
    const tlsCaPem = this.loadTlsCa(options);

    if (tlsCaPem) {
      // TLS mode: use the CA cert to verify the server
      channelCreds = grpc.credentials.createSsl(tlsCaPem);
    } else {
      // Insecure mode: only allow trusted networks
      this.validateTrustedNetwork(address);
      channelCreds = grpc.credentials.createInsecure();
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
    this.client = new proto.keyway.crypto.CryptoService(address, channelCreds);
  }

  private loadTlsCa(options?: CryptoServiceOptions): Buffer | null {
    if (options?.tlsCa) {
      return Buffer.from(options.tlsCa, "base64");
    }
    if (options?.tlsCaPath) {
      // Path was explicitly configured -- fail loudly if unreadable
      return fs.readFileSync(options.tlsCaPath);
    }
    return null;
  }

  private validateTrustedNetwork(address: string): void {
    // Security: Only allow insecure gRPC for trusted networks
    // Railway private networking doesn't provide TLS, but traffic is isolated
    // Docker container names are also trusted (internal Docker network)
    const isTrustedNetwork =
      address.startsWith("localhost") ||
      address.startsWith("127.0.0.1") ||
      address.includes(".railway.internal") ||
      address.startsWith("crypto:"); // Docker container name for local dev

    if (!isTrustedNetwork) {
      throw new Error(
        `Crypto service address "${address}" is not on a trusted network. ` +
          "Provide TLS CA cert (CRYPTO_TLS_CA or CRYPTO_TLS_CA_PATH) or use a trusted network."
      );
    }
  }

  async encrypt(content: string): Promise<EncryptedData> {
    return withRetry(() => this.encryptOnce(content));
  }

  private callRpc<TReq, TRes>(
    method: CryptoClient[keyof CryptoClient],
    request: TReq
  ): Promise<TRes> {
    return new Promise((resolve, reject) => {
      const cb = (err: Error | null, response: TRes) => {
        if (err) {
          return reject(err);
        }
        resolve(response);
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- proto-loaded gRPC clients have dynamic signatures that can't be statically typed
      const fn = method as unknown as (...args: unknown[]) => void;
      if (this.metadata) {
        fn.call(this.client, request, this.metadata, cb);
      } else {
        fn.call(this.client, request, cb);
      }
    });
  }

  private async encryptOnce(content: string): Promise<EncryptedData> {
    try {
      const response = await this.callRpc<{ plaintext: Buffer; version: number }, EncryptResponse>(
        this.client.Encrypt,
        { plaintext: Buffer.from(content, "utf-8"), version: 0 }
      );
      return {
        encryptedContent: Buffer.from(response.ciphertext).toString("hex"),
        iv: Buffer.from(response.iv).toString("hex"),
        authTag: Buffer.from(response.authTag).toString("hex"),
        version: response.version,
      };
    } catch (err) {
      throw formatGrpcError(
        err as Error & { code?: number; details?: string },
        this.serviceUrl,
        "encrypt"
      );
    }
  }

  async decrypt(data: EncryptedData): Promise<string> {
    return withRetry(() => this.decryptOnce(data));
  }

  private async decryptOnce(data: EncryptedData): Promise<string> {
    try {
      const response = await this.callRpc<
        { ciphertext: Buffer; iv: Buffer; authTag: Buffer; version: number },
        DecryptResponse
      >(this.client.Decrypt, {
        ciphertext: Buffer.from(data.encryptedContent, "hex"),
        iv: Buffer.from(data.iv, "hex"),
        authTag: Buffer.from(data.authTag, "hex"),
        version: data.version ?? DEFAULT_ENCRYPTION_VERSION,
      });
      return Buffer.from(response.plaintext).toString("utf-8");
    } catch (err) {
      throw formatGrpcError(
        err as Error & { code?: number; details?: string },
        this.serviceUrl,
        "decrypt"
      );
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; version: string }> {
    try {
      const response = await this.callRpc<Record<string, never>, HealthResponse>(
        this.client.HealthCheck,
        {}
      );
      return { healthy: response.healthy, version: response.version };
    } catch (err) {
      throw formatGrpcError(
        err as Error & { code?: number; details?: string },
        this.serviceUrl,
        "healthcheck"
      );
    }
  }
}

/**
 * Check crypto service connectivity
 * Throws CryptoServiceError with detailed message if not accessible
 */
export async function checkCryptoService(
  serviceUrl: string,
  options?: CryptoServiceOptions
): Promise<{ healthy: boolean; version: string }> {
  const service = new RemoteEncryptionService(serviceUrl, options);
  return service.healthCheck();
}
