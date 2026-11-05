import { getDBStatus } from '../../config/db';
import { env } from '../../config/env';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  database: {
    status: string;
    readyState: number;
  };
  memory?: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
  };
}

export class HealthService {
  getHealthStatus(detailed = false): HealthStatus {
    const dbStatus = getDBStatus();
    const isDbConnected = dbStatus.readyState === 1;

    const status: HealthStatus = {
      status: isDbConnected ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.NODE_ENV,
      database: dbStatus,
    };

    if (detailed) {
      const mem = process.memoryUsage();
      status.memory = {
        rssBytes: mem.rss,
        heapTotalBytes: mem.heapTotal,
        heapUsedBytes: mem.heapUsed,
      };
    }

    return status;
  }
}

export const healthService = new HealthService();

