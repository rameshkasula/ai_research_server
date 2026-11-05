import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { workspaceDocumentParamsSchema } from '../document/document.schema';
import { documentChunkParamsSchema } from '../chunk/chunk.schema';
import { searchController } from './search.controller';
import {
  documentSearchQuerySchema,
  semanticSearchQuerySchema,
} from './search.schema';

const router = Router();

// All search routes require authentication
router.use(authenticate);

// Global semantic search across user's documents
router.post(
  '/search',
  validateRequest({ body: semanticSearchQuerySchema }),
  searchController.searchAll,
);

// Get MongoDB Atlas Vector Search JSON definition
router.get(
  '/search/atlas-index-config',
  searchController.getAtlasIndexConfig,
);

// Semantic search within a specific workspace
router.post(
  '/workspaces/:workspaceId/search',
  validateRequest({
    params: workspaceDocumentParamsSchema,
    body: semanticSearchQuerySchema,
  }),
  searchController.searchWorkspace,
);

// Semantic search within a single document
router.post(
  '/documents/:id/search',
  validateRequest({
    params: documentChunkParamsSchema,
    body: documentSearchQuerySchema,
  }),
  searchController.searchDocument,
);

export const searchRoutes = router;

