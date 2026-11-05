import { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { searchService } from './search.service';
import {
  DocumentSearchInput,
  SemanticSearchInput,
} from './search.schema';

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user.id;
}

export class SearchController {
  /**
   * Semantic vector search across a workspace (with optional document filters).
   */
  searchWorkspace = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as SemanticSearchInput;

    const result = await searchService.searchWorkspace(userId, workspaceId, body);
    sendSuccess(res, result, 200, 'Semantic retrieval completed successfully');
  });

  /**
   * Semantic vector search scoped strictly to a single document.
   */
  searchDocument = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as DocumentSearchInput;

    const result = await searchService.searchDocument(
      userId,
      id,
      body.query,
      body.topK,
      body.minScore,
    );
    sendSuccess(res, result, 200, 'Document semantic retrieval completed successfully');
  });

  /**
   * Semantic vector search across all accessible documents.
   */
  searchAll = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const body = req.body as SemanticSearchInput;

    const result = await searchService.searchAll(userId, body);
    sendSuccess(res, result, 200, 'Global semantic retrieval completed successfully');
  });

  /**
   * Returns the MongoDB Atlas Vector Search JSON index configuration.
   */
  getAtlasIndexConfig = asyncHandler(async (_req: Request, res: Response) => {
    const config = searchService.getAtlasIndexDefinition();
    sendSuccess(
      res,
      config,
      200,
      'MongoDB Atlas Vector Search index configuration definition retrieved',
    );
  });
}

export const searchController = new SearchController();

