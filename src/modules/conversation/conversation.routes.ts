import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { conversationController } from './conversation.controller';
import {
  conversationIdParamsSchema,
  createConversationSchema,
  sendMessageSchema,
  updateConversationSchema,
  workspaceConversationParamsSchema,
} from './conversation.schema';

const router = Router();

// All conversation endpoints require authentication
router.use(authenticate);

// Top-level conversation routes
router.post(
  '/',
  validateRequest({ body: createConversationSchema }),
  conversationController.create,
);

router.get(
  '/',
  conversationController.list,
);

router.get(
  '/:id',
  validateRequest({ params: conversationIdParamsSchema }),
  conversationController.getById,
);

router.patch(
  '/:id',
  validateRequest({
    params: conversationIdParamsSchema,
    body: updateConversationSchema,
  }),
  conversationController.update,
);

router.delete(
  '/:id',
  validateRequest({ params: conversationIdParamsSchema }),
  conversationController.remove,
);

// Messages endpoints
router.get(
  '/:id/messages',
  validateRequest({ params: conversationIdParamsSchema }),
  conversationController.getMessages,
);

router.post(
  '/:id/messages',
  validateRequest({
    params: conversationIdParamsSchema,
    body: sendMessageSchema,
  }),
  conversationController.sendMessage,
);

/**
 * Workspace-scoped nested conversations router
 */
const workspaceConversationRouter = Router({ mergeParams: true });
workspaceConversationRouter.use(authenticate);

workspaceConversationRouter.post(
  '/',
  validateRequest({
    params: workspaceConversationParamsSchema,
    body: createConversationSchema,
  }),
  conversationController.create,
);

workspaceConversationRouter.get(
  '/',
  validateRequest({ params: workspaceConversationParamsSchema }),
  conversationController.list,
);

export const conversationRoutes = router;
export const workspaceConversationRoutes = workspaceConversationRouter;

