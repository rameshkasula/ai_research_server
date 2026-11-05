import { Request, Response } from 'express';
import { Router } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { aiRateLimiter } from '../../common/middlewares/rateLimiter';
import { webResearchService } from './webResearch.service';
import {
  FetchUrlsBodyInput,
   fetchUrlsBodySchema,
  HybridResearchBodyInput,
  hybridResearchBodySchema,
  WebSearchBodyInput,
  webSearchBodySchema,
  webSourceIdParamsSchema,
  workspaceWebParamsSchema,
} from './webResearch.schema';

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user.id;
}

function resolveWorkspaceId(req: Request): string {
  const wsId =
    (req.params as { workspaceId?: string }).workspaceId ||
    (req.body as { workspaceId?: string } | undefined)?.workspaceId ||
    (req.query as { workspaceId?: string } | undefined)?.workspaceId;

  if (!wsId || !/^[0-9a-fA-F]{24}$/.test(wsId)) {
    throw AppError.badRequest('A valid workspaceId is required');
  }
  return wsId;
}

export class WebResearchController {
  search = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);
    const body = req.body as WebSearchBodyInput;

    const result = await webResearchService.searchAndExtractWeb(
      userId,
      workspaceId,
      body,
    );
    sendSuccess(res, result, 200, 'Web research completed successfully');
  });

  fetchUrls = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);
    const body = req.body as FetchUrlsBodyInput;

    const sources = await webResearchService.fetchUrls(userId, workspaceId, body);
    sendSuccess(
      res,
      { sources },
      200,
      'Web pages fetched and extracted successfully',
    );
  });

  hybridAsk = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);
    const body = req.body as HybridResearchBodyInput;

    const result = await webResearchService.hybridResearchAsk(
      userId,
      workspaceId,
      body,
    );
    sendSuccess(
      res,
      result,
      200,
      'Hybrid document + web research completed successfully',
    );
  });

  listSources = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);

    const sources = await webResearchService.listWorkspaceWebSources(
      userId,
      workspaceId,
    );
    sendSuccess(res, { sources }, 200, 'Web sources retrieved successfully');
  });

  deleteSource = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    await webResearchService.deleteWebSource(userId, id);
    sendSuccess(res, null, 200, 'Web source deleted successfully');
  });
}

export const webResearchController = new WebResearchController();

const router = Router();
router.use(authenticate);

router.post(
  '/web-research/search',
  aiRateLimiter,
  validateRequest({ body: webSearchBodySchema }),
  webResearchController.search,
);

router.post(
  '/web-research/fetch',
  aiRateLimiter,
  validateRequest({ body: fetchUrlsBodySchema }),
  webResearchController.fetchUrls,
);

router.post(
  '/web-research/ask',
  aiRateLimiter,
  validateRequest({ body: hybridResearchBodySchema }),
  webResearchController.hybridAsk,
);

router.get('/web-research/sources', webResearchController.listSources);

router.delete(
  '/web-research/sources/:id',
  validateRequest({ params: webSourceIdParamsSchema }),
  webResearchController.deleteSource,
);

router.post(
  '/workspaces/:workspaceId/web-research/search',
  aiRateLimiter,
  validateRequest({
    params: workspaceWebParamsSchema,
    body: webSearchBodySchema,
  }),
  webResearchController.search,
);

router.post(
  '/workspaces/:workspaceId/web-research/fetch',
  aiRateLimiter,
  validateRequest({
    params: workspaceWebParamsSchema,
    body: fetchUrlsBodySchema,
  }),
  webResearchController.fetchUrls,
);

router.post(
  '/workspaces/:workspaceId/web-research/ask',
  aiRateLimiter,
  validateRequest({
    params: workspaceWebParamsSchema,
    body: hybridResearchBodySchema,
  }),
  webResearchController.hybridAsk,
);

router.get(
  '/workspaces/:workspaceId/web-research/sources',
  validateRequest({ params: workspaceWebParamsSchema }),
  webResearchController.listSources,
);

export const webResearchRoutes = router;

