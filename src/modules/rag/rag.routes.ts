import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { ragController } from './rag.controller';
import {
  documentRagParamsSchema,
  ragAskQuestionSchema,
  workspaceRagParamsSchema,
} from './rag.schema';

const router = Router();

// All RAG endpoints require authentication
router.use(authenticate);

// Global RAG question answering across user's documents
router.post(
  '/rag/ask',
  validateRequest({ body: ragAskQuestionSchema }),
  ragController.askGlobal,
);

// Workspace-level RAG question answering
router.post(
  '/workspaces/:workspaceId/ask',
  validateRequest({
    params: workspaceRagParamsSchema,
    body: ragAskQuestionSchema,
  }),
  ragController.askWorkspace,
);

router.post(
  '/workspaces/:workspaceId/rag/ask',
  validateRequest({
    params: workspaceRagParamsSchema,
    body: ragAskQuestionSchema,
  }),
  ragController.askWorkspace,
);

// Single-document RAG question answering
router.post(
  '/documents/:id/ask',
  validateRequest({
    params: documentRagParamsSchema,
    body: ragAskQuestionSchema,
  }),
  ragController.askDocument,
);

router.post(
  '/documents/:id/rag/ask',
  validateRequest({
    params: documentRagParamsSchema,
    body: ragAskQuestionSchema,
  }),
  ragController.askDocument,
);

export const ragRoutes = router;

