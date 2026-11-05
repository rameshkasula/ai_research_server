import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { workspaceDocumentParamsSchema } from '../document/document.schema';
import { chunkController } from './chunk.controller';
import {
  chunkIdParamsSchema,
  documentChunkParamsSchema,
  listChunksQuerySchema,
  processDocumentBodySchema,
  searchChunksBodySchema,
} from './chunk.schema';

const router = Router();

// All chunk endpoints require authentication
router.use(authenticate);

// Process document into chunks with embeddings
router.post(
  '/documents/:id/process',
  validateRequest({
    params: documentChunkParamsSchema,
    body: processDocumentBodySchema,
  }),
  chunkController.process,
);

// List chunks for a specific document
router.get(
  '/documents/:id/chunks',
  validateRequest({
    params: documentChunkParamsSchema,
    query: listChunksQuerySchema,
  }),
  chunkController.listByDocument,
);

// Get single chunk by ID
router.get(
  '/chunks/:id',
  validateRequest({
    params: chunkIdParamsSchema,
  }),
  chunkController.getById,
);

// Workspace semantic vector search
router.post(
  '/workspaces/:workspaceId/chunks/search',
  validateRequest({
    params: workspaceDocumentParamsSchema,
    body: searchChunksBodySchema,
  }),
  chunkController.searchWorkspace,
);

export const chunkRoutes = router;

