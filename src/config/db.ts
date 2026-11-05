import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../common/utils/logger';

let isListenersAttached = false;

function attachConnectionListeners(): void {
  if (isListenersAttached) return;
  isListenersAttached = true;

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connection established');
  });

  mongoose.connection.on('error', (error) => {
    logger.error('MongoDB connection error', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
}

export async function connectDB(): Promise<void> {
  attachConnectionListeners();

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
  } catch (error) {
    logger.error('Failed to connect to MongoDB', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed gracefully');
  }
}

export function getDBStatus(): {
  status: 'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'uninitialized';
  readyState: number;
} {
  const states: Record<
    number,
    'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'uninitialized'
  > = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
    99: 'uninitialized',
  };

  const readyState = mongoose.connection.readyState;
  return {
    status: states[readyState] ?? 'uninitialized',
    readyState,
  };
}

