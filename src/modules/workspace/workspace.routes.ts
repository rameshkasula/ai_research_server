import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { workspaceDocumentRoutes } from '../document/document.routes';
import { workspaceController } from './workspace.controller';
import {
  createWorkspaceBodySchema,
  listWorkspacesQuerySchema,
  updateWorkspaceBodySchema,
  workspaceIdParamsSchema,
} from './workspace.schema';

const router = Router();

// Nested workspace document routes (/api/workspaces/:workspaceId/documents)
router.use('/:workspaceId/documents', workspaceDocumentRoutes);

// All workspace routes require authentication
router.use(authenticate);

router.post(
  '/',
  validateRequest({ body: createWorkspaceBodySchema }),
  workspaceController.create,
);

router.get(
  '/',
  validateRequest({ query: listWorkspacesQuerySchema }),
  workspaceController.list,
);

router.get(
  '/:id',
  validateRequest({ params: workspaceIdParamsSchema }),
  workspaceController.getById,
);

router.get(
  '/:id/dashboard',
  validateRequest({ params: workspaceIdParamsSchema }),
  workspaceController.getDashboard,
);

router.patch(
  '/:id',
  validateRequest({
    params: workspaceIdParamsSchema,
    body: updateWorkspaceBodySchema,
  }),
  workspaceController.update,
);

router.delete(
  '/:id',
  validateRequest({ params: workspaceIdParamsSchema }),
  workspaceController.remove,
);

export const workspaceRoutes = router;
