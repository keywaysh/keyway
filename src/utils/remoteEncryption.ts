import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import type { IEncryptionService, EncryptedData } from './encryption';

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

export class RemoteEncryptionService implements IEncryptionService {
  private client: CryptoClient;

  constructor(address: string = 'localhost:50051') {
    const protoPath = path.join(__dirname, '../../proto/crypto.proto');
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
    this.client = new proto.keyway.crypto.CryptoService(
      address,
      grpc.credentials.createInsecure()
    );
  }

  async encrypt(content: string): Promise<EncryptedData> {
    return new Promise((resolve, reject) => {
      this.client.Encrypt(
        { plaintext: Buffer.from(content, 'utf-8'), version: 1 },
        (err, response) => {
          if (err) return reject(err);
          resolve({
            encryptedContent: Buffer.from(response.ciphertext).toString('hex'),
            iv: Buffer.from(response.iv).toString('hex'),
            authTag: Buffer.from(response.authTag).toString('hex'),
          });
        }
      );
    });
  }

  async decrypt(data: EncryptedData): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.Decrypt(
        {
          ciphertext: Buffer.from(data.encryptedContent, 'hex'),
          iv: Buffer.from(data.iv, 'hex'),
          authTag: Buffer.from(data.authTag, 'hex'),
          version: 1,
        },
        (err, response) => {
          if (err) return reject(err);
          resolve(Buffer.from(response.plaintext).toString('utf-8'));
        }
      );
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; version: string }> {
    return new Promise((resolve, reject) => {
      this.client.HealthCheck({}, (err, response) => {
        if (err) return reject(err);
        resolve({ healthy: response.healthy, version: response.version });
      });
    });
  }
}
