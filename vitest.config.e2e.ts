import { defineConfig } from 'vitest/config';

/**
 * Integration tests against the real MongoDB and RabbitMQ (`docker compose up -d mongo rabbitmq`).
 * They run in their own vhost / database and with short delays so failures and crashes are quick to provoke.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      MONGODB_URI: 'mongodb://localhost:27017/ingest-e2e',
      RABBITMQ_URL: 'amqp://guest:guest@localhost:5672/ingest-e2e',
      PARTITIONS: '8',
      RETRY_DELAYS_MS: '200,400',
      LEASE_MS: '1500',
      EXTERNAL_TIMEOUT_MS: '1000',
    },
  },
});
