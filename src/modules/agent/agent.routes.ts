import { Request, Response, Router } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { aiRateLimiter } from '../../common/middlewares/rateLimiter';
import { agentService } from './agent.service';
import {
  agentRunIdParamsSchema,
  CreateAgentRunInput,
  createAgentRunBodySchema,
  workspaceAgentParamsSchema,
} from './agent.schema';

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

export class AgentController {
  startRun = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);
    const body = req.body as CreateAgentRunInput;

    const agentRun = await agentService.startAgentRun(userId, workspaceId, body);
    sendSuccess(
      res,
      { agentRun },
      201,
      agentRun.status === 'awaiting_approval'
        ? 'Agent research plan created and awaiting human approval'
        : 'AI research agent completed task successfully',
    );
  });

  approveRun = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const agentRun = await agentService.approveAndExecuteAgentRun(userId, id);
    sendSuccess(res, { agentRun }, 200, 'Agent run approved and executed');
  });

  cancelRun = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const agentRun = await agentService.cancelAgentRun(userId, id);
    sendSuccess(res, { agentRun }, 200, 'Agent run cancelled');
  });

  getRun = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const agentRun = await agentService.getAgentRun(userId, id);
    sendSuccess(res, { agentRun }, 200, 'Agent run retrieved successfully');
  });

  listRuns = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);

    const agentRuns = await agentService.listWorkspaceAgentRuns(
      userId,
      workspaceId,
    );
    sendSuccess(res, { agentRuns }, 200, 'Agent runs retrieved successfully');
  });
}

export const agentController = new AgentController();

const router = Router();
router.use(authenticate);

router.post(
  '/agent/runs',
  aiRateLimiter,
  validateRequest({ body: createAgentRunBodySchema }),
  agentController.startRun,
);

router.get('/agent/runs', agentController.listRuns);

router.get(
  '/agent/runs/:id',
  validateRequest({ params: agentRunIdParamsSchema }),
  agentController.getRun,
);

router.post(
  '/agent/runs/:id/approve',
  aiRateLimiter,
  validateRequest({ params: agentRunIdParamsSchema }),
  agentController.approveRun,
);

router.post(
  '/agent/runs/:id/cancel',
  validateRequest({ params: agentRunIdParamsSchema }),
  agentController.cancelRun,
);

router.post(
  '/workspaces/:workspaceId/agent/runs',
  aiRateLimiter,
  validateRequest({
    params: workspaceAgentParamsSchema,
    body: createAgentRunBodySchema,
  }),
  agentController.startRun,
);

router.get(
  '/workspaces/:workspaceId/agent/runs',
  validateRequest({ params: workspaceAgentParamsSchema }),
  agentController.listRuns,
);

export const agentRoutes = router;

