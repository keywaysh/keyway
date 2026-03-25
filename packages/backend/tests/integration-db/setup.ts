// setupFiles: runs before each test file (in the test process)
// Sets env vars so that `src/db/index.ts` connects to the test DB

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ||
  "postgresql://localhost:5432/keyway_test";

process.env.DATABASE_URL = TEST_DB_URL;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.CRYPTO_SERVICE_URL = "localhost:50051";
process.env.GITHUB_APP_ID = "123456";
process.env.GITHUB_APP_CLIENT_ID = "Iv1.test-client-id";
process.env.GITHUB_APP_CLIENT_SECRET = "test-client-secret";
process.env.GITHUB_APP_PRIVATE_KEY = "dGVzdC1rZXk=";
