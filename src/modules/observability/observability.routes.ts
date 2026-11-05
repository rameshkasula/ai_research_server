import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { aiTelemetryService } from '../../common/observability/aiTelemetry.service';
import { cacheService } from '../../common/cache/cache.service';
import { getDBStatus } from '../../config/db';

const evaluateRagBodySchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  retrievalScores: z.array(z.number().min(0).max(1)).default([]),
  sourceCount: z.number().int().nonnegative().default(0),
});

const router = Router();
router.use(authenticate);

router.get(
  '/observability/usage',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.role === 'admin' ? undefined : req.user?.id;
    const summary = aiTelemetryService.getUsageSummary(userId);
    sendSuccess(
      res,
      summary,
      200,
      'AI token usage and cost telemetry retrieved successfully',
    );
  }),
);

router.get(
  '/observability/metrics',
  asyncHandler(async (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    sendSuccess(
      res,
      {
        uptimeSeconds: Math.floor(process.uptime()),
        database: getDBStatus(),
        cache: cacheService.getStats(),
        memory: {
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
        },
        aiTelemetry: aiTelemetryService.getUsageSummary(),
      },
      200,
      'System and AI observability metrics retrieved',
    );
  }),
);

router.post(
  '/observability/evaluate-rag',
  validateRequest({ body: evaluateRagBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { question, answer, retrievalScores, sourceCount } = req.body as z.infer<
      typeof evaluateRagBodySchema
    >;

    const promptCheck = aiTelemetryService.sanitizePromptInput(question);
    const groundedness = aiTelemetryService.evaluateGroundedness({
      answer,
      retrievalScores,
      sourceCount,
    });

    sendSuccess(
      res,
      {
        promptInjectionDetected: promptCheck.injectionDetected,
        sanitizedQuestion: promptCheck.sanitizedText,
        evaluation: groundedness,
      },
      200,
      'RAG groundedness and safety evaluation completed',
    );
  }),
);

export const observabilityRoutes = router;

