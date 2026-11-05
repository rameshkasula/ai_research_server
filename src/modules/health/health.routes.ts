import { Router } from 'express';
import { healthController } from './health.controller';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { healthQuerySchema } from './health.schema';

const router = Router();

router.get(
  '/',
  validateRequest({ query: healthQuerySchema }),
  healthController.check,
);

export const healthRoutes = router;

