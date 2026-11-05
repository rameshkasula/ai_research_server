import { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { ragService } from './rag.service';
import {
  DocumentRagParams,
  RagAskQuestionInput,
  WorkspaceRagParams,
} from './rag.schema';

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user.id;
}

export class RagController {
  /**
   * Ask question grounded in a workspace's documents.
   */
  askWorkspace = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { workspaceId } = req.params as unknown as WorkspaceRagParams;
    const body = req.body as RagAskQuestionInput;

    const response = await ragService.askWorkspaceQuestion(userId, workspaceId, body);
    sendSuccess(res, response, 200, 'Grounded answer generated successfully');
  });

  /**
   * Ask question grounded in a single document.
   */
  askDocument = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as DocumentRagParams;
    const body = req.body as RagAskQuestionInput;

    const response = await ragService.askDocumentQuestion(userId, id, body);
    sendSuccess(res, response, 200, 'Grounded answer generated successfully');
  });

  /**
   * Ask question grounded across all user's accessible documents.
   */
  askGlobal = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const body = req.body as RagAskQuestionInput;

    const response = await ragService.askGlobalQuestion(userId, body);
    sendSuccess(res, response, 200, 'Grounded answer generated successfully');
  });
}

export const ragController = new RagController();

