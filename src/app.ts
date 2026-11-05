import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { validateEnv } from './config/env';
import { requestLogger } from './common/middlewares/requestLogger';
import { errorHandler, notFoundHandler } from './common/middlewares/errorHandler';
import { apiRouter } from './routes';
import { healthRoutes } from './modules/health/health.routes';

export function createApp(): Application {
  // Validate environment variables before initializing the Express app
  const env = validateEnv();

  const app = express();

  // Security & CORS middlewares
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
      credentials: true,
    }),
  );

  // Body & Cookie parsing middlewares
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // Request logging
  app.use(requestLogger);

  // Health-check endpoint
  app.use('/health', healthRoutes);

  // Modular API routes
  app.use('/api', apiRouter);
  app.use('/api/v1', apiRouter);

  // 404 & Centralized error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
