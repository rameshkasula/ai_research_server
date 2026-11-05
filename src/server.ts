import http from 'http';
import { validateEnv } from './config/env';
import { createApp } from './app';
import { connectDB, disconnectDB } from './config/db';
import { logger } from './common/utils/logger';

let server: http.Server;

async function bootstrap(): Promise<void> {
  try {
    // 1. Validate environment variables before starting anything
    const env = validateEnv();
    logger.info('Environment variables validated successfully');

    // 2. Connect to MongoDB
    await connectDB();

    // 3. Initialize and start Express app
    const app = createApp();
    server = app.listen(env.PORT, () => {
      logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
      logger.info(`Server running on http://localhost:${env.PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');
      await disconnectDB();
      process.exit(0);
    });
  } else {
    await disconnectDB();
    process.exit(0);
  }
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
  });
  void gracefulShutdown('uncaughtException');
});

void bootstrap();
