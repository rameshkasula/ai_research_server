import { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { healthService } from './health.service';
import { HealthQuery } from './health.schema';

export class HealthController {
  check = asyncHandler(async (req: Request, res: Response) => {
    const { detailed } = req.query as unknown as HealthQuery;
    const isDetailed = detailed === 'true';

    const health = healthService.getHealthStatus(isDetailed);
    const statusCode = health.status === 'ok' ? 200 : 503;

    sendSuccess(res, health, statusCode, 'Health check completed');
  });
}

export const healthController = new HealthController();

