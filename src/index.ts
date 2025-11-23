import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as dotenv from 'dotenv';
import { authRoutes } from './routes/auth';
import { vaultRoutes } from './routes/vaults';
import { initAnalytics, shutdownAnalytics } from './utils/analytics';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Register CORS
fastify.register(cors, {
  origin: true, // Allow all origins for MVP
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register routes
fastify.register(authRoutes, { prefix: '/auth' });
fastify.register(vaultRoutes, { prefix: '/vaults' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);

  const statusCode = error.statusCode || 500;

  reply.status(statusCode).send({
    error: error.name || 'InternalServerError',
    message: error.message || 'An unexpected error occurred',
    statusCode,
  });
});

// Start server
const start = async () => {
  try {
    // Initialize analytics
    initAnalytics();

    // Start server
    await fastify.listen({ port: PORT, host: HOST });

    console.log(`
╔═══════════════════════════════════════╗
║                                       ║
║   🔐 Keyway API Server                ║
║                                       ║
║   Server running on: ${HOST}:${PORT}     ║
║   Environment: ${process.env.NODE_ENV || 'development'}            ║
║                                       ║
╚═══════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down gracefully...');

  await shutdownAnalytics();
  await fastify.close();

  console.log('Server shut down successfully');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
