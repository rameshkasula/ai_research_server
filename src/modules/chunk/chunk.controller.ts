import { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { chunkService } from './chunk.service';
import {
  ChunkIdParams,
  DocumentChunkParams,
  ListChunksQuery,
  ProcessDocumentBody,
  SearchChunksBody,
} from './chunk.schema';

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user.id;
}

export class ChunkController {
  /**
   * Triggers text extraction, chunking, and Gemini embedding generation for a document.
   */
  process = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as DocumentChunkParams;
    const body = req.body as ProcessDocumentBody;

    const result = await chunkService.processDocument(userId, id, body);
    sendSuccess(res, result, 200, result.message);
  });

  /**
   * Retrieves paginated chunks for a document.
   */
  listByDocument = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as DocumentChunkParams;
    const query = req.query as unknown as ListChunksQuery;

    const result = await chunkService.getChunksByDocument(userId, id, query);
    sendSuccess(res, result, 200, 'Document chunks retrieved successfully');
  });

  /**
   * Retrieves a single chunk by ID.
   */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as ChunkIdParams;

    const chunk = await chunkService.getChunkById(userId, id);
    sendSuccess(res, { chunk }, 200, 'Chunk details retrieved successfully');
  });

  /**
   * Performs semantic vector similarity search within a workspace.
   */
  searchWorkspace = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { workspaceId } = req.params as { workspaceId: string };
    const { query, topK } = req.body as SearchChunksBody;

    const results = await chunkService.searchWorkspaceChunks(
      userId,
      workspaceId,
      query,
      topK,
    );

    sendSuccess(
      res,
      {
        query,
        count: results.length,
        results,
      },
      200,
      'Semantic vector search completed successfully',
    );
  });
}

export const chunkController = new ChunkController();

